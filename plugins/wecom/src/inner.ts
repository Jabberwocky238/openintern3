import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { WSClient, type WsFrame } from "@wecom/aibot-node-sdk";
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
  ) {}

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
    if (!this.config.enabled || this.client) {
      return;
    }

    this.assertRequiredConfig();
    await mkdir(this.config.mediaDir, { recursive: true });

    const client = new WSClient({
      botId: this.config.botId,
      secret: this.config.secret,
      wsUrl: this.config.websocketUrl || DEFAULT_WS_URL,
      heartbeatInterval: 30_000,
      maxReconnectAttempts: 100,
      logger: {
        debug: () => {},
        info: () => {},
        warn: (message: string) => {
          this.lastError = message;
        },
        error: (message: string) => {
          this.lastError = message;
        },
      },
    });

    client.on("connected", () => {
      this.connected = true;
      this.lastError = null;
    });

    client.on("authenticated", () => {
      this.authenticated = true;
      this.reconnectAttempts = 0;
      this.lastError = null;
    });

    client.on("disconnected", (reason: string) => {
      this.connected = false;
      this.authenticated = false;
      this.lastError = reason;
    });

    client.on("reconnecting", (attempt: number) => {
      this.reconnectAttempts = attempt;
    });

    client.on("error", (error: Error) => {
      this.lastError = error.message;
    });

    client.on("message", async (frame: WsFrame<WecomMessageBody>) => {
      await this.handleMessage(frame);
    });

    this.client = client;
    client.connect();
  }

  public async stop(): Promise<void> {
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

    await this.client.sendMessage(to, {
      msgtype: "markdown",
      markdown: { content: text },
    });

    return { to, sent: true };
  }

  public pullMessages(limit = 50): WecomInboundMessage[] {
    const count = Math.max(0, Math.min(limit, this.inboundQueue.length));
    return this.inboundQueue.splice(0, count);
  }

  private async handleMessage(frame: WsFrame<WecomMessageBody>): Promise<void> {
    const body = this.asMessageBody(frame.body);
    const senderId = body.from?.userid ?? "";
    const chatType = body.chattype ?? "single";
    const chatId = body.chatid || senderId;

    if (!senderId || !chatId || !this.isAllowedSender(senderId, chatType, chatId)) {
      return;
    }

    const parsed = await this.parseIncomingContent(body);
    if (!parsed.content && parsed.media.length === 0) {
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

    await this.onMessage?.(inboundMessage);
  }

  private async parseIncomingContent(
    body: WecomMessageBody,
  ): Promise<{ content: string; media: string[] }> {
    const textParts: string[] = [];
    const media: string[] = [];

    if (body.msgtype === "mixed" && body.mixed?.msg_item) {
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
      return url;
    }

    try {
      const result = await this.client.downloadFile(url, aesKey);
      const filePath = path.join(this.config.mediaDir, this.resolveFileName(url, result.filename));
      await writeFile(filePath, result.buffer);
      return filePath;
    } catch {
      return url;
    }
  }

  private resolveFileName(sourceUrl: string, originalFileName?: string): string {
    if (originalFileName && originalFileName.trim()) {
      return `wecom_${Date.now()}_${originalFileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    }

    try {
      const url = new URL(sourceUrl);
      const pathname = url.pathname.split("/").filter(Boolean).pop() ?? "media.bin";
      return `wecom_${Date.now()}_${pathname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    } catch {
      return `wecom_${Date.now()}_media.bin`;
    }
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
      throw new Error("WECOM_BOT_ID is required.");
    }
    if (!this.config.secret.trim()) {
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
