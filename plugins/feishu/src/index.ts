import path from "node:path";
import { CapabilityProvider, Plugin } from "@openintern/kernel";
import type { AgentChannelMessage } from "../../agent/src/types.js";
import {
  FeishuPullMessagesCapabilityProvider,
  FeishuSendMessageCapabilityProvider,
  FeishuStartCapabilityProvider,
  FeishuStatusCapabilityProvider,
  FeishuStopCapabilityProvider,
} from "./capabilities.js";
import { FeishuInner, type FeishuConfig, type FeishuInboundMessage } from "./inner.js";

function parseAllowFrom(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) {
    return ["*"];
  }

  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

export default class FeishuPlugin extends Plugin {
  constructor() {
    super({
      name: "feishu",
      version: "0.0.0",
      namespaces: ["feishu", "channel"],
    });
  }

  public override async init(): Promise<void> {
    this.state.inner = new FeishuInner(
      this.configFromEnv(),
      async (message: FeishuInboundMessage) => {
        const payload: AgentChannelMessage = {
          channel: "feishu",
          senderId: message.senderId,
          chatId: message.chatId,
          content: message.content,
          timestamp: message.timestamp,
          media: message.media,
          metadata: message.metadata,
        };

        this.eventBus?.emit(this, "message.received", payload);
      },
    );
  }

  public override capabilities(): CapabilityProvider[] {
    return [
      new FeishuStartCapabilityProvider(this),
      new FeishuStopCapabilityProvider(this),
      new FeishuStatusCapabilityProvider(this),
      new FeishuSendMessageCapabilityProvider(this),
      new FeishuPullMessagesCapabilityProvider(this),
    ];
  }

  public inner(): FeishuInner {
    const inner = this.state.inner;
    if (!(inner instanceof FeishuInner)) {
      throw new Error("Feishu inner is not initialized.");
    }
    return inner;
  }

  public async start(): Promise<void> {
    await this.inner().start();
  }

  public async stop(): Promise<void> {
    await this.inner().stop();
  }

  public status() {
    return this.inner().status();
  }

  public async sendMessage(chatId: string, content: string) {
    return this.inner().sendMessage(chatId, content);
  }

  public pullMessages(limit?: number) {
    return this.inner().pullMessages(limit);
  }

  private configFromEnv(): FeishuConfig {
    return {
      enabled: process.env.FEISHU_ENABLED === "true",
      appId: process.env.FEISHU_APP_ID ?? "",
      appSecret: process.env.FEISHU_APP_SECRET ?? "",
      verificationToken: process.env.FEISHU_VERIFICATION_TOKEN ?? "",
      encryptKey: process.env.FEISHU_ENCRYPT_KEY ?? "",
      allowFrom: parseAllowFrom(process.env.FEISHU_ALLOW_FROM),
      mediaDir: process.env.FEISHU_MEDIA_DIR ?? path.join(process.cwd(), "plugins", "feishu", "media"),
    };
  }
}
