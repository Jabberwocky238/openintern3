import { randomUUID } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import * as Lark from "@larksuiteoapi/node-sdk";

const TOKEN_REFRESH_SKEW_MS = 60_000;
const MESSAGE_CACHE_LIMIT = 200;

export interface FeishuConfig {
  enabled: boolean;
  appId: string;
  appSecret: string;
  verificationToken: string;
  encryptKey: string;
  allowFrom: string[];
  mediaDir: string;
}

export interface FeishuInnerOptions {
  config: FeishuConfig;
  onMessage?: (message: FeishuInboundMessage) => void | Promise<void>;
}

export interface FeishuInboundMessage {
  id: string;
  senderId: string;
  chatId: string;
  content: string;
  timestamp: string;
  media: string[];
  metadata: Record<string, unknown>;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

interface FeishuMessageEvent {
  sender?: {
    sender_type?: string;
    sender_id?: {
      open_id?: string;
    };
  };
  message?: {
    message_id?: string;
    chat_id?: string;
    chat_type?: string;
    message_type?: string;
    content?: string;
  };
  event?: {
    sender?: {
      sender_type?: string;
      sender_id?: {
        open_id?: string;
      };
    };
    message?: {
      message_id?: string;
      chat_id?: string;
      chat_type?: string;
      message_type?: string;
      content?: string;
    };
  };
}

export class FeishuInner {
  private wsClient: Lark.WSClient | null = null;
  private cachedToken: CachedToken | null = null;
  private readonly processedMessageIds = new Map<string, number>();
  private readonly inboundQueue: FeishuInboundMessage[] = [];

  constructor(
    private readonly config: FeishuConfig,
    private readonly onMessage?: (message: FeishuInboundMessage) => void | Promise<void>,
  ) {}

  public status(): {
    enabled: boolean;
    started: boolean;
    queueSize: number;
    allowFrom: string[];
    mediaDir: string;
  } {
    return {
      enabled: this.config.enabled,
      started: this.wsClient !== null,
      queueSize: this.inboundQueue.length,
      allowFrom: [...this.config.allowFrom],
      mediaDir: this.config.mediaDir,
    };
  }

  public async start(): Promise<void> {
    if (!this.config.enabled || this.wsClient) {
      return;
    }

    if (!this.config.appId || !this.config.appSecret) {
      throw new Error("Feishu is enabled but appId/appSecret is missing.");
    }

    const eventDispatcher = new Lark.EventDispatcher({
      verificationToken: this.config.verificationToken || undefined,
      encryptKey: this.config.encryptKey || undefined,
      loggerLevel: Lark.LoggerLevel.error,
    }).register({
      "im.message.receive_v1": async (payload: unknown) => {
        await this.handleMessageEvent(payload);
      },
    });

    this.wsClient = new Lark.WSClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      autoReconnect: true,
      loggerLevel: Lark.LoggerLevel.error,
    });

    await this.wsClient.start({ eventDispatcher });
  }

  public async stop(): Promise<void> {
    this.wsClient?.close({ force: true });
    this.wsClient = null;
  }

  public async sendMessage(chatId: string, content: string): Promise<{
    chatId: string;
    sent: true;
  }> {
    if (!this.config.enabled) {
      throw new Error("Feishu is disabled.");
    }

    if (!chatId.trim() || !content.trim()) {
      throw new TypeError("chatId and content must be non-empty strings.");
    }

    const receiveIdType = chatId.startsWith("oc_") ? "chat_id" : "open_id";
    const payload = {
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text: content }),
      uuid: randomUUID(),
    };
    const url =
      `https://open.feishu.cn/open-apis/im/v1/messages?` +
      `receive_id_type=${encodeURIComponent(receiveIdType)}`;

    await this.withAuthRetry(async (token) => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const raw = (await response.json()) as unknown;
      const body = this.asObject(raw);
      const code = typeof body.code === "number" ? body.code : -1;
      if (!response.ok || code !== 0) {
        const message =
          typeof body.msg === "string" ? body.msg : response.statusText;
        throw new Error(
          `Feishu send failed (code=${code}, status=${response.status}): ${message}`,
        );
      }
    });

    return { chatId, sent: true };
  }

  public pullMessages(limit = 50): FeishuInboundMessage[] {
    const count = Math.max(0, Math.min(limit, this.inboundQueue.length));
    return this.inboundQueue.splice(0, count);
  }

  private async handleMessageEvent(payload: unknown): Promise<void> {
    const top = this.asObject(payload) as FeishuMessageEvent;
    const event =
      top.message || top.sender
        ? top
        : (this.asObject(top.event) as FeishuMessageEvent);
    const message = event.message;
    const sender = event.sender;
    const senderId = sender?.sender_id?.open_id ?? "";

    if (!senderId || sender?.sender_type === "bot" || !this.isAllowed(senderId)) {
      return;
    }

    const messageId = message?.message_id ?? "";
    if (!messageId || this.isDuplicateMessage(messageId)) {
      return;
    }

    const msgType = message?.message_type ?? "unknown";
    const parsed = await this.parseIncomingContent(
      messageId,
      msgType,
      message?.content ?? "",
    );
    if (!parsed.content.trim()) {
      return;
    }

    const chatType = message?.chat_type ?? "";
    const chatId = chatType === "p2p" ? senderId : (message?.chat_id ?? senderId);
    const inboundMessage: FeishuInboundMessage = {
      id: messageId,
      senderId,
      chatId,
      content: parsed.content,
      timestamp: new Date().toISOString(),
      media: parsed.media,
      metadata: {
        chat_type: chatType,
        msg_type: msgType,
        source_chat_id: message?.chat_id ?? "",
      },
    };

    this.inboundQueue.push(inboundMessage);

    if (this.inboundQueue.length > MESSAGE_CACHE_LIMIT) {
      this.inboundQueue.splice(0, this.inboundQueue.length - MESSAGE_CACHE_LIMIT);
    }

    await this.onMessage?.(inboundMessage);
  }

  private isAllowed(senderId: string): boolean {
    return this.config.allowFrom.includes("*") || this.config.allowFrom.includes(senderId);
  }

  private isDuplicateMessage(messageId: string): boolean {
    if (this.processedMessageIds.has(messageId)) {
      return true;
    }

    this.processedMessageIds.set(messageId, Date.now());
    while (this.processedMessageIds.size > 1000) {
      const first = this.processedMessageIds.keys().next();
      if (first.done) {
        break;
      }
      this.processedMessageIds.delete(first.value);
    }

    return false;
  }

  private parseIncomingContent(
    messageId: string,
    msgType: string,
    rawContent: string,
  ): Promise<{ content: string; media: string[] }> {
    let contentJson: Record<string, unknown> = {};

    try {
      contentJson = this.asObject(JSON.parse(rawContent) as unknown);
    } catch {
      contentJson = {};
    }

    if (msgType === "text") {
      return Promise.resolve({
        content: typeof contentJson.text === "string" ? contentJson.text : "",
        media: [],
      });
    }

    if (msgType === "post") {
      return Promise.resolve({
        content: this.extractPostText(contentJson) || "[post]",
        media: [],
      });
    }

    return this.parseMediaContent(messageId, msgType, contentJson);
  }

  private extractPostText(contentJson: Record<string, unknown>): string {
    const stack: unknown[] = [contentJson];
    const parts: string[] = [];

    while (stack.length > 0) {
      const current = stack.pop();
      if (typeof current === "string") {
        if (current.trim()) {
          parts.push(current);
        }
        continue;
      }

      if (Array.isArray(current)) {
        for (const item of current) {
          stack.push(item);
        }
        continue;
      }

      if (typeof current === "object" && current !== null) {
        const obj = current as Record<string, unknown>;
        if (typeof obj.text === "string" && obj.text.trim()) {
          parts.push(obj.text);
        }
        if (typeof obj.title === "string" && obj.title.trim()) {
          parts.push(obj.title);
        }
        for (const value of Object.values(obj)) {
          stack.push(value);
        }
      }
    }

    return parts.join(" ").trim();
  }

  private async withAuthRetry(task: (token: string) => Promise<void>): Promise<void> {
    try {
      await task(await this.getTenantAccessToken());
    } catch {
      this.cachedToken = null;
      await task(await this.getTenantAccessToken());
    }
  }

  private async getTenantAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now) {
      return this.cachedToken.value;
    }

    const response = await fetch(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: this.config.appId,
          app_secret: this.config.appSecret,
        }),
      },
    );

    const raw = (await response.json()) as unknown;
    const body = this.asObject(raw);
    const code = typeof body.code === "number" ? body.code : -1;
    if (!response.ok || code !== 0) {
      const message =
        typeof body.msg === "string" ? body.msg : response.statusText;
      throw new Error(
        `Feishu token request failed (code=${code}, status=${response.status}): ${message}`,
      );
    }

    const token =
      typeof body.tenant_access_token === "string" ? body.tenant_access_token : "";
    const expireSeconds = typeof body.expire === "number" ? body.expire : 0;
    if (!token || expireSeconds <= 0) {
      throw new Error("Feishu token response missing tenant_access_token/expire.");
    }

    this.cachedToken = {
      value: token,
      expiresAt: Date.now() + expireSeconds * 1000 - TOKEN_REFRESH_SKEW_MS,
    };

    return token;
  }

  private asObject(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private async parseMediaContent(
    messageId: string,
    msgType: string,
    contentJson: Record<string, unknown>,
  ): Promise<{ content: string; media: string[] }> {
    const resourceKey = this.extractResourceKey(msgType, contentJson);

    if (!resourceKey) {
      return { content: `[${msgType}]`, media: [] };
    }

    const mediaPath = await this.downloadMessageResource(messageId, resourceKey, msgType);
    return {
      content: `[${msgType}]`,
      media: mediaPath ? [mediaPath] : [],
    };
  }

  private extractResourceKey(
    msgType: string,
    contentJson: Record<string, unknown>,
  ): string | null {
    if (msgType === "image" && typeof contentJson.image_key === "string") {
      return contentJson.image_key;
    }

    if (
      (msgType === "file" || msgType === "audio" || msgType === "media" || msgType === "video")
      && typeof contentJson.file_key === "string"
    ) {
      return contentJson.file_key;
    }

    return null;
  }

  private async downloadMessageResource(
    messageId: string,
    resourceKey: string,
    resourceType: string,
  ): Promise<string | null> {
    try {
      await mkdir(this.config.mediaDir, { recursive: true });

      const token = await this.getTenantAccessToken();
      const response = await fetch(
        `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(resourceKey)}?type=${encodeURIComponent(resourceType)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const fileName = await this.allocateMediaFileName(
        this.extractFileNameFromHeaders(response.headers.get("content-disposition")),
        resourceKey,
        response.headers.get("content-type") ?? undefined,
      );
      const filePath = path.join(this.config.mediaDir, fileName);
      await writeFile(filePath, buffer);
      return filePath;
    } catch {
      return null;
    }
  }

  private extractFileNameFromHeaders(contentDisposition: string | null): string | undefined {
    if (!contentDisposition) {
      return undefined;
    }

    const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match) {
      return decodeURIComponent(utf8Match[1]);
    }

    const simpleMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
    return simpleMatch?.[1];
  }

  private async allocateMediaFileName(
    originalFileName: string | undefined,
    fallbackKey: string,
    contentType?: string,
  ): Promise<string> {
    const desiredName = this.normalizeMediaFileName(originalFileName, fallbackKey, contentType);
    return this.ensureUniqueMediaFileName(desiredName);
  }

  private normalizeMediaFileName(
    originalFileName: string | undefined,
    fallbackKey: string,
    contentType?: string,
  ): string {
    if (originalFileName && originalFileName.trim()) {
      return this.sanitizeFileName(originalFileName);
    }

    const extension = this.extensionFromContentType(contentType);
    return this.sanitizeFileName(`${fallbackKey}${extension}`);
  }

  private extensionFromContentType(contentType?: string): string {
    if (!contentType) {
      return "";
    }

    const normalized = contentType.split(";")[0].trim().toLowerCase();
    const directMap: Record<string, string> = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/gif": ".gif",
      "video/mp4": ".mp4",
      "audio/mpeg": ".mp3",
      "audio/mp4": ".m4a",
      "application/pdf": ".pdf",
    };

    if (directMap[normalized]) {
      return directMap[normalized];
    }

    const subtype = normalized.split("/")[1];
    return subtype ? `.${subtype}` : "";
  }

  private sanitizeFileName(fileName: string): string {
    const trimmed = path.basename(fileName.trim());
    const sanitized = trimmed.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
    return sanitized || "media.bin";
  }

  private async ensureUniqueMediaFileName(fileName: string): Promise<string> {
    const parsed = path.parse(fileName);
    const baseName = parsed.name || "media";
    const extension = parsed.ext;

    for (let index = 0; index < 10_000; index += 1) {
      const candidate = index === 0 ? `${baseName}${extension}` : `${baseName}(${index})${extension}`;
      try {
        await access(path.join(this.config.mediaDir, candidate));
      } catch {
        return candidate;
      }
    }

    return `${baseName}_${Date.now()}${extension}`;
  }
}
