import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { WSClient, type WsFrame } from "@wecom/aibot-node-sdk";
import type { Logger } from "@openintern/kernel";
import type {
  WecomConfig,
  WecomEngineStatus,
  WecomInboundMessage,
  WecomMessageBody,
} from "./types.js";

const MESSAGE_CACHE_LIMIT = 200;
const DEFAULT_WS_URL = "wss://openws.work.weixin.qq.com";

export class WecomEngine {
  private client: WSClient | null = null;
  private connected = false;
  private authenticated = false;
  private reconnectAttempts = 0;
  private lastError: string | null = null;
  private readonly inboundQueue: WecomInboundMessage[] = [];

  constructor(
    private readonly config: WecomConfig,
    private readonly onMessage?: (message: WecomInboundMessage) => void | Promise<void>,
    private readonly logger?: Logger,
  ) {}

  private log(level: "debug" | "info" | "warn" | "error", message: string, detail?: unknown): void {
    if (!this.logger) {
      return;
    }

    if (detail === undefined) {
      this.logger[level](message);
      return;
    }

    this.logger[level](message, detail);
  }

  public status(): WecomEngineStatus {
    return {
      enabled: this.config.enabled,
      started: this.client !== null,
      connected: this.connected,
      authenticated: this.authenticated,
      websocketUrl: this.config.websocketUrl,
      botId: this.config.botId,
      mediaDir: this.config.mediaDir,
      queueSize: this.inboundQueue.length,
      allowFrom: [...this.config.allowFrom],
      groupAllowFrom: [...this.config.groupAllowFrom],
      reconnectAttempts: this.reconnectAttempts,
      lastError: this.lastError,
    };
  }

  public async start(): Promise<void> {
    if (!this.config.enabled) {
      this.log("info", "skip start because plugin is disabled");
      return;
    }

    if (this.client) {
      this.log("info", "skip start because client is already initialized");
      return;
    }

    this.assertRequiredConfig();
    this.log("info", "starting wecom engine", {
      websocketUrl: this.config.websocketUrl || DEFAULT_WS_URL,
      botId: this.config.botId,
      mediaDir: this.config.mediaDir,
      allowFrom: this.config.allowFrom,
      groupAllowFrom: this.config.groupAllowFrom,
    });
    await mkdir(this.config.mediaDir, { recursive: true });
    this.log("debug", "ensured media directory exists", {
      mediaDir: this.config.mediaDir,
    });

    const client = new WSClient({
      botId: this.config.botId,
      secret: this.config.secret,
      wsUrl: this.config.websocketUrl || DEFAULT_WS_URL,
      heartbeatInterval: 30_000,
      maxReconnectAttempts: 100,
      logger: {
        debug: (message: string) => {
          this.log("debug", `sdk ${message}`);
        },
        info: (message: string) => {
          this.log("info", `sdk ${message}`);
        },
        warn: (message: string) => {
          this.lastError = message;
          this.log("warn", `sdk ${message}`);
        },
        error: (message: string) => {
          this.lastError = message;
          this.log("error", `sdk ${message}`);
        },
      },
    });

    client.on("connected", () => {
      this.connected = true;
      this.lastError = null;
      this.log("info", "websocket connected");
    });

    client.on("authenticated", () => {
      this.authenticated = true;
      this.reconnectAttempts = 0;
      this.lastError = null;
      this.log("info", "wecom client authenticated");
    });

    client.on("disconnected", (reason: string) => {
      this.connected = false;
      this.authenticated = false;
      this.lastError = reason;
      this.log("warn", "websocket disconnected", { reason });
    });

    client.on("reconnecting", (attempt: number) => {
      this.reconnectAttempts = attempt;
      this.log("warn", "websocket reconnecting", { attempt });
    });

    client.on("error", (error: Error) => {
      this.lastError = error.message;
      this.log("error", "client error", {
        message: error.message,
        stack: error.stack,
      });
    });

    client.on("message", async (frame: WsFrame<WecomMessageBody>) => {
      this.log("debug", "received raw frame", {
        msgid: frame.body?.msgid,
        msgtype: frame.body?.msgtype,
        chatid: frame.body?.chatid,
        chattype: frame.body?.chattype,
        senderId: frame.body?.from?.userid,
      });
      await this.handleMessage(frame);
    });

    this.client = client;
    this.log("info", "connecting websocket");
    client.connect();
  }

  public async stop(): Promise<void> {
    this.log("info", "stopping wecom engine");
    this.client?.disconnect();
    this.client = null;
    this.connected = false;
    this.authenticated = false;
    this.reconnectAttempts = 0;
  }

  public async sendMessage(to: string, text: string): Promise<{ to: string; sent: true }> {
    if (!this.config.enabled) {
      throw new Error("WeCom is disabled.");
    }
    if (!this.client || !this.client.isConnected) {
      throw new Error("WeCom is not connected.");
    }
    if (!to.trim() || !text.trim()) {
      throw new TypeError("to and text must be non-empty strings.");
    }

    this.log("info", "sending message", {
      to,
      textPreview: text.slice(0, 120),
      length: text.length,
    });
    await this.client.sendMessage(to, {
      msgtype: "markdown",
      markdown: { content: text },
    });
    this.log("info", "message sent", { to });

    return { to, sent: true };
  }

  public pullMessages(limit = 50): WecomInboundMessage[] {
    const count = Math.max(0, Math.min(limit, this.inboundQueue.length));
    const messages = this.inboundQueue.splice(0, count);
    this.log("debug", "pulled messages from queue", {
      requestedLimit: limit,
      returned: messages.length,
      remaining: this.inboundQueue.length,
    });
    return messages;
  }

  private async handleMessage(frame: WsFrame<WecomMessageBody>): Promise<void> {
    const body = this.asMessageBody(frame.body);
    const senderId = body.from?.userid ?? "";
    const chatType = body.chattype ?? "single";
    const chatId = body.chatid || senderId;

    if (!senderId || !chatId) {
      this.log("warn", "dropped message because sender or chat is missing", {
        msgid: body.msgid,
        senderId,
        chatId,
        msgType: body.msgtype,
      });
      return;
    }

    if (!this.isAllowedSender(senderId, chatType, chatId)) {
      this.log("debug", "dropped message because sender is not allowed", {
        msgid: body.msgid,
        senderId,
        chatId,
        chatType,
      });
      return;
    }

    const parsed = await this.parseIncomingContent(body);
    if (!parsed.content && parsed.media.length === 0) {
      this.log("debug", "dropped message because parsed content is empty", {
        msgid: body.msgid,
        senderId,
        chatId,
        msgType: body.msgtype,
      });
      return;
    }

    const inboundMessage: WecomInboundMessage = {
      id: body.msgid || `${chatId}:${Date.now()}`,
      senderId,
      chatId,
      content: parsed.content,
      timestamp: this.parseTimestamp(body.create_time),
      msgType: body.msgtype || "unknown",
      media: parsed.media,
      metadata: {
        aibotid: body.aibotid,
        chattype: chatType,
        response_url: body.response_url,
        raw: body,
      },
    };

    this.inboundQueue.push(inboundMessage);
    if (this.inboundQueue.length > MESSAGE_CACHE_LIMIT) {
      this.inboundQueue.splice(0, this.inboundQueue.length - MESSAGE_CACHE_LIMIT);
    }

    this.log("info", "accepted inbound message", {
      id: inboundMessage.id,
      senderId: inboundMessage.senderId,
      chatId: inboundMessage.chatId,
      msgType: inboundMessage.msgType,
      contentPreview: inboundMessage.content.slice(0, 120),
      mediaCount: inboundMessage.media.length,
      queueSize: this.inboundQueue.length,
    });

    await this.onMessage?.(inboundMessage);
  }

  private async parseIncomingContent(
    body: WecomMessageBody,
  ): Promise<{ content: string; media: string[] }> {
    const textParts: string[] = [];
    const media: string[] = [];

    if (body.msgtype === "mixed" && body.mixed?.msg_item) {
      this.log("debug", "parsing mixed message", {
        msgid: body.msgid,
        itemCount: body.mixed.msg_item.length,
      });
      for (const item of body.mixed.msg_item) {
        if (item.msgtype === "text" && item.text?.content) {
          textParts.push(item.text.content);
        }
        if (item.msgtype === "image" && item.image?.url) {
          media.push(await this.downloadMedia(item.image.url, item.image.aeskey));
        }
      }
    } else {
      if (body.text?.content) {
        textParts.push(body.text.content);
      }
      if (body.msgtype === "voice" && body.voice?.content) {
        textParts.push(body.voice.content);
      }
      if (body.msgtype === "image" && body.image?.url) {
        media.push(await this.downloadMedia(body.image.url, body.image.aeskey));
      }
      if (body.msgtype === "file" && body.file?.url) {
        media.push(await this.downloadMedia(body.file.url, body.file.aeskey));
      }
    }

    const quoteText = this.extractQuoteContent(body);
    if (quoteText && textParts.length === 0) {
      textParts.push(quoteText);
    }

    const content =
      textParts.join("\n").replace(/@\S+/g, "").trim()
      || this.fallbackContent(body.msgtype, media.length);

    return {
      content,
      media: media.filter(Boolean),
    };
  }

  private extractQuoteContent(body: WecomMessageBody): string {
    if (body.quote?.msgtype === "text" && body.quote.text?.content) {
      return body.quote.text.content;
    }
    if (body.quote?.msgtype === "voice" && body.quote.voice?.content) {
      return body.quote.voice.content;
    }
    return "";
  }

  private fallbackContent(msgType: string, mediaCount: number): string {
    if (mediaCount > 0 && msgType === "image") {
      return "[image]";
    }
    if (mediaCount > 0 && msgType === "file") {
      return "[file]";
    }
    if (msgType === "voice") {
      return "[voice]";
    }
    if (msgType === "mixed") {
      return mediaCount > 0 ? "[mixed]" : "";
    }
    return msgType ? `[${msgType}]` : "";
  }

  private async downloadMedia(url: string, aesKey?: string): Promise<string> {
    if (!this.client) {
      this.log("warn", "skip media download because client is not initialized", { url });
      return url;
    }

    try {
      this.log("info", "downloading media", { url });
      const result = await this.client.downloadFile(url, aesKey);
      const filePath = path.join(
        this.config.mediaDir,
        await this.allocateMediaFileName(url, result.filename),
      );
      await writeFile(filePath, result.buffer);
      this.log("info", "media downloaded", {
        url,
        filePath,
        bytes: result.buffer.length,
      });
      return filePath;
    } catch (error) {
      this.log("warn", "media download failed, using original url", {
        url,
        error: error instanceof Error ? error.message : String(error),
      });
      return url;
    }
  }

  private async allocateMediaFileName(sourceUrl: string, originalFileName?: string): Promise<string> {
    return this.ensureUniqueMediaFileName(this.resolveFileName(sourceUrl, originalFileName));
  }

  private resolveFileName(sourceUrl: string, originalFileName?: string): string {
    if (originalFileName && originalFileName.trim()) {
      return this.sanitizeFileName(originalFileName);
    }

    try {
      const url = new URL(sourceUrl);
      const pathname = url.pathname.split("/").filter(Boolean).pop() ?? "media.bin";
      return this.sanitizeFileName(pathname);
    } catch {
      return "media.bin";
    }
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

  private isAllowedSender(senderId: string, chatType: "single" | "group", chatId: string): boolean {
    if (chatType === "group") {
      return this.config.groupAllowFrom.length === 0
        || this.config.groupAllowFrom.includes("*")
        || this.config.groupAllowFrom.includes(chatId);
    }

    return this.config.allowFrom.includes("*") || this.config.allowFrom.includes(senderId);
  }

  private parseTimestamp(raw: number | undefined): string {
    if (typeof raw !== "number" || Number.isNaN(raw)) {
      return new Date().toISOString();
    }
    return new Date(raw).toISOString();
  }

  private assertRequiredConfig(): void {
    if (!this.config.botId.trim()) {
      this.log("error", "missing required config", { key: "WECOM_BOT_ID" });
      throw new Error("WECOM_BOT_ID is required.");
    }
    if (!this.config.secret.trim()) {
      this.log("error", "missing required config", { key: "WECOM_SECRET" });
      throw new Error("WECOM_SECRET is required.");
    }
  }

  private asMessageBody(value: unknown): WecomMessageBody {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as WecomMessageBody)
      : {
        msgid: "",
        chattype: "single",
        from: { userid: "" },
        msgtype: "unknown",
      };
  }
}
