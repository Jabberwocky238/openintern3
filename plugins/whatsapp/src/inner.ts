import { randomBytes, webcrypto } from "node:crypto";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  extractMessageContent,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import type { Logger } from "@openintern/kernel";

const MESSAGE_CACHE_LIMIT = 200;

export interface WhatsAppConfig {
  enabled: boolean;
  authDir: string;
  mediaDir: string;
}

export interface WhatsAppInboundMessage {
  id: string;
  sender: string;
  pn: string;
  content: string;
  timestamp: number;
  isGroup: boolean;
  media: string[];
}

export interface WhatsAppInnerOptions {
  onMessage?: (message: WhatsAppInboundMessage) => void | Promise<void>;
  logger?: Logger;
}

export class WhatsAppInner {
  private sock: ReturnType<typeof makeWASocket> | null = null;
  private reconnecting = false;
  private readonly inboundQueue: WhatsAppInboundMessage[] = [];
  private qrPath: string | null = null;
  private qrUpdatedAt: string | null = null;

  constructor(
    private readonly config: WhatsAppConfig,
    private readonly options: WhatsAppInnerOptions = {},
  ) {}

  public status(): {
    enabled: boolean;
    started: boolean;
    authDir: string;
    mediaDir: string;
    queueSize: number;
    qrPending: boolean;
    qrPath: string | null;
    qrUpdatedAt: string | null;
  } {
    return {
      enabled: this.config.enabled,
      started: this.sock !== null,
      authDir: this.config.authDir,
      mediaDir: this.config.mediaDir,
      queueSize: this.inboundQueue.length,
      qrPending: this.qrPath !== null,
      qrPath: this.qrPath,
      qrUpdatedAt: this.qrUpdatedAt,
    };
  }

  public async start(): Promise<void> {
    if (!this.config.enabled || this.sock) {
      return;
    }

    if (!globalThis.crypto) {
      Object.assign(globalThis, {
        crypto: webcrypto,
      });
    }

    const logger = pino({ level: "silent" });
    const { state, saveCreds } = await useMultiFileAuthState(this.config.authDir);
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      version,
      logger,
      printQRInTerminal: false,
      browser: ["openintern3", "cli", "0.0.0"],
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });
    this.sock = socket;

    socket.ev.on("connection.update", async (payload: unknown) => {
      const update = this.asObject(payload);
      const connection = typeof update.connection === "string" ? update.connection : "";
      const qr = typeof update.qr === "string" ? update.qr : "";
      const lastDisconnect = this.asObject(update.lastDisconnect);
      const error = this.asObject(lastDisconnect.error);
      const output = this.asObject(error.output);

      if (qr) {
        await this.writeQrCode(qr);
      }

      if (connection === "open") {
        await this.clearQrCode();
      }

      if (connection === "close") {
        const statusCode = typeof output.statusCode === "number" ? output.statusCode : undefined;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        this.sock = null;

        if (shouldReconnect && !this.reconnecting) {
          this.reconnecting = true;
          setTimeout(() => {
            this.reconnecting = false;
            void this.start();
          }, 5000);
        }
      }
    });

    socket.ev.on("creds.update", saveCreds);

    socket.ev.on("messages.upsert", async (payload: unknown) => {
      const record = this.asObject(payload);
      const type = typeof record.type === "string" ? record.type : "";
      const messages = Array.isArray(record.messages) ? record.messages : [];

      if (type !== "notify") {
        return;
      }

      for (const message of messages) {
        await this.handleMessage(message);
      }
    });
  }

  public async stop(): Promise<void> {
    this.sock?.end(undefined);
    this.sock = null;
    await this.clearQrCode();
  }

  public async sendMessage(to: string, text: string): Promise<{
    to: string;
    sent: true;
  }> {
    if (!this.config.enabled) {
      throw new Error("WhatsApp is disabled.");
    }
    if (!this.sock) {
      throw new Error("WhatsApp is not connected.");
    }
    if (!to.trim() || !text.trim()) {
      throw new TypeError("to and text must be non-empty strings.");
    }

    await this.sock.sendMessage(to, { text });
    return { to, sent: true };
  }

  public pullMessages(limit = 50): WhatsAppInboundMessage[] {
    const count = Math.max(0, Math.min(limit, this.inboundQueue.length));
    return this.inboundQueue.splice(0, count);
  }

  private async handleMessage(rawMessage: unknown): Promise<void> {
    const msg = this.asObject(rawMessage);
    const key = this.asObject(msg.key);
    if (key.fromMe === true || key.remoteJid === "status@broadcast") {
      return;
    }

    const unwrapped = extractMessageContent(msg.message);
    if (!unwrapped) {
      return;
    }

    const content = this.getTextContent(unwrapped);
    let fallbackContent: string | null = null;
    const mediaPaths: string[] = [];

    if (unwrapped.imageMessage) {
      fallbackContent = "[Image]";
      const mediaPath = await this.downloadMedia(
        rawMessage,
        typeof unwrapped.imageMessage.mimetype === "string" ? unwrapped.imageMessage.mimetype : undefined,
      );
      if (mediaPath) {
        mediaPaths.push(mediaPath);
      }
    } else if (unwrapped.documentMessage) {
      fallbackContent = "[Document]";
      const mediaPath = await this.downloadMedia(
        rawMessage,
        typeof unwrapped.documentMessage.mimetype === "string"
          ? unwrapped.documentMessage.mimetype
          : undefined,
        typeof unwrapped.documentMessage.fileName === "string"
          ? unwrapped.documentMessage.fileName
          : undefined,
      );
      if (mediaPath) {
        mediaPaths.push(mediaPath);
      }
    } else if (unwrapped.videoMessage) {
      fallbackContent = "[Video]";
      const mediaPath = await this.downloadMedia(
        rawMessage,
        typeof unwrapped.videoMessage.mimetype === "string" ? unwrapped.videoMessage.mimetype : undefined,
      );
      if (mediaPath) {
        mediaPaths.push(mediaPath);
      }
    }

    const finalContent =
      content || (mediaPaths.length === 0 ? fallbackContent : "") || "";
    if (!finalContent && mediaPaths.length === 0) {
      return;
    }

    const inboundMessage: WhatsAppInboundMessage = {
      id: typeof key.id === "string" ? key.id : "",
      sender: typeof key.remoteJid === "string" ? key.remoteJid : "",
      pn: typeof key.remoteJidAlt === "string" ? key.remoteJidAlt : "",
      content: finalContent,
      timestamp: typeof msg.messageTimestamp === "number" ? msg.messageTimestamp : Date.now(),
      isGroup: typeof key.remoteJid === "string" ? key.remoteJid.endsWith("@g.us") : false,
      media: mediaPaths,
    };

    this.inboundQueue.push(inboundMessage);

    if (this.inboundQueue.length > MESSAGE_CACHE_LIMIT) {
      this.inboundQueue.splice(0, this.inboundQueue.length - MESSAGE_CACHE_LIMIT);
    }

    await this.options.onMessage?.(inboundMessage);
  }

  private async downloadMedia(
    rawMessage: unknown,
    mimeType?: string,
    fileName?: string,
  ): Promise<string | null> {
    try {
      await mkdir(this.config.mediaDir, { recursive: true });
      const buffer = await downloadMediaMessage(rawMessage as any, "buffer", {});

      const outputName = await this.allocateMediaFileName(fileName, mimeType);

      const filePath = path.join(this.config.mediaDir, outputName);
      await writeFile(filePath, buffer);
      return filePath;
    } catch {
      return null;
    }
  }

  private getTextContent(message: Record<string, any>): string | null {
    if (typeof message.conversation === "string") {
      return message.conversation;
    }
    if (typeof message.extendedTextMessage?.text === "string") {
      return message.extendedTextMessage.text;
    }
    if (typeof message.imageMessage?.caption === "string") {
      return message.imageMessage.caption;
    }
    if (typeof message.videoMessage?.caption === "string") {
      return message.videoMessage.caption;
    }
    if (typeof message.documentMessage?.caption === "string") {
      return message.documentMessage.caption;
    }
    if (message.audioMessage) {
      return "[Voice Message]";
    }
    return null;
  }

  private async allocateMediaFileName(
    originalFileName?: string,
    mimeType?: string,
  ): Promise<string> {
    const desiredName = this.normalizeMediaFileName(originalFileName, mimeType);
    return this.ensureUniqueMediaFileName(desiredName);
  }

  private normalizeMediaFileName(originalFileName?: string, mimeType?: string): string {
    if (originalFileName && originalFileName.trim()) {
      return this.sanitizeFileName(originalFileName);
    }

    const mime = mimeType || "application/octet-stream";
    const ext = `.${mime.split("/").pop()?.split(";")[0] || "bin"}`;
    return this.sanitizeFileName(`media${ext}`);
  }

  private sanitizeFileName(fileName: string): string {
    const trimmed = path.basename(fileName.trim());
    const sanitized = trimmed.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
    return sanitized || `media_${randomBytes(4).toString("hex")}.bin`;
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

  private asObject(value: unknown): Record<string, any> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, any>)
      : {};
  }

  private async writeQrCode(qrText: string): Promise<void> {
    const qrDir = path.join(path.dirname(this.config.authDir), "qr");
    await mkdir(qrDir, { recursive: true });
    const qrPath = path.join(qrDir, "latest.png");
    await QRCode.toFile(qrPath, qrText, {
      type: "png",
      margin: 2,
      width: 512,
    });
    const terminalQr = await QRCode.toString(qrText, {
      type: "terminal",
      small: true,
    });
    this.qrPath = qrPath;
    this.qrUpdatedAt = new Date().toISOString();
    this.options.logger?.info("scan this QR code with WhatsApp Linked Devices");
    this.options.logger?.info(`\n${terminalQr}`);
    this.options.logger?.info(`QR code image saved: ${qrPath}`);
  }

  private async clearQrCode(): Promise<void> {
    if (!this.qrPath) {
      return;
    }
    try {
      await rm(this.qrPath, { force: true });
    } catch {
      // ignore cleanup failure
    }
    this.qrPath = null;
    this.qrUpdatedAt = null;
  }

}
