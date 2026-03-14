import path from "node:path";
import { CapabilityProvider, Plugin } from "@openintern/kernel";
import type { AgentChannelMessage } from "../../agent/src/types.js";
import {
  WecomPullMessagesCapabilityProvider,
  WecomSendMessageCapabilityProvider,
  WecomStartCapabilityProvider,
  WecomStatusCapabilityProvider,
  WecomStopCapabilityProvider,
} from "./capabilities.js";
import { WecomEngine } from "./engine.js";
import type { WecomConfig, WecomInboundMessage } from "./types.js";

function parseAllowFrom(raw: string | undefined, fallbackToAll = true): string[] {
  if (!raw || !raw.trim()) {
    return fallbackToAll ? ["*"] : [];
  }

  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

export default class WecomPlugin extends Plugin {
  constructor() {
    super({
      name: "wecom",
      version: "0.0.0",
      namespaces: ["wecom", "channel"],
    });
  }

  public override async init(): Promise<void> {
    this.state.inner = new WecomEngine(
      this.configFromEnv(),
      async (message: WecomInboundMessage) => {
        const payload: AgentChannelMessage = {
          channel: "wecom",
          senderId: message.senderId,
          chatId: message.chatId,
          content: message.content,
          timestamp: message.timestamp,
          media: message.media,
          metadata: {
            msgType: message.msgType,
            event: message.event,
            raw: message.metadata,
          },
        };
        this.eventBus?.emit<AgentChannelMessage>(this, "message.received", payload);
      },
      this.logger(),
    );
  }

  public override capabilities(): CapabilityProvider[] {
    return [
      new WecomStartCapabilityProvider(this),
      new WecomStopCapabilityProvider(this),
      new WecomStatusCapabilityProvider(this),
      new WecomSendMessageCapabilityProvider(this),
      new WecomPullMessagesCapabilityProvider(this),
    ];
  }

  public inner(): WecomEngine {
    const inner = this.state.inner;
    if (!(inner instanceof WecomEngine)) {
      throw new Error("WeCom inner is not initialized.");
    }
    return inner;
  }

  public async start(): Promise<void> {
    if (this.status().started) {
      this.logger().info("skip start because wecom is already started");
      return;
    }

    await this.inner().start();
  }

  public async stop(): Promise<void> {
    await this.inner().stop();
  }

  public status() {
    return this.inner().status();
  }

  public async sendMessage(to: string, text: string) {
    return this.inner().sendMessage(to, text);
  }

  public pullMessages(limit?: number) {
    return this.inner().pullMessages(limit);
  }

  private configFromEnv(): WecomConfig {
    const baseDir = path.join(process.cwd(), "plugins", "wecom");
    return {
      enabled: process.env.WECOM_ENABLED === "true",
      botId: process.env.WECOM_BOT_ID ?? "",
      secret: process.env.WECOM_SECRET ?? "",
      websocketUrl: process.env.WECOM_WEBSOCKET_URL ?? "wss://openws.work.weixin.qq.com",
      requestTimeoutMs: this.parseRequestTimeout(process.env.WECOM_REQUEST_TIMEOUT_MS),
      allowFrom: parseAllowFrom(process.env.WECOM_ALLOW_FROM),
      groupAllowFrom: parseAllowFrom(process.env.WECOM_GROUP_ALLOW_FROM, false),
      mediaDir: process.env.WECOM_MEDIA_DIR ?? path.join(baseDir, "media"),
    };
  }

  private parseRequestTimeout(raw: string | undefined): number {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      return 60_000;
    }
    return Math.trunc(value);
  }
}
