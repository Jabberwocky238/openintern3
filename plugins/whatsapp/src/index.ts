import path from "node:path";
import { CapabilityProvider, Plugin } from "@openintern/kernel";
import type { AgentChannelMessage } from "../../agent/src/types.js";
import {
  WhatsAppPullMessagesCapabilityProvider,
  WhatsAppSendMessageCapabilityProvider,
  WhatsAppStartCapabilityProvider,
  WhatsAppStatusCapabilityProvider,
  WhatsAppStopCapabilityProvider,
} from "./capabilities.js";
import {
  WhatsAppInner,
  type WhatsAppConfig,
  type WhatsAppInboundMessage,
} from "./inner.js";


export const WhatsAppRuntimeBaseDir = path.join(process.cwd(), ".openintern3", "whatsapp");

export default class WhatsAppPlugin extends Plugin {
  constructor() {
    super({
      name: "whatsapp",
      version: "0.0.0",
      namespaces: ["whatsapp", "channel"],
    });
  }

  public override async init(): Promise<void> {
    this.state.inner = new WhatsAppInner(this.configFromEnv(), {
      logger: this.logger(),
      onMessage: async (message: WhatsAppInboundMessage) => {
        const payload: AgentChannelMessage = {
          channel: "whatsapp",
          senderId: message.sender,
          chatId: message.sender,
          content: message.content,
          timestamp: new Date(message.timestamp * 1000).toISOString(),
          media: message.media,
          metadata: {
            pn: message.pn,
            isGroup: message.isGroup,
          },
        };

        this.eventBus?.emit(this, "message.received", payload);
      },
    });
  }

  public override capabilities(): CapabilityProvider[] {
    return [
      new WhatsAppStartCapabilityProvider(this),
      new WhatsAppStopCapabilityProvider(this),
      new WhatsAppStatusCapabilityProvider(this),
      new WhatsAppSendMessageCapabilityProvider(this),
      new WhatsAppPullMessagesCapabilityProvider(this),
    ];
  }

  public inner(): WhatsAppInner {
    const inner = this.state.inner;
    if (!(inner instanceof WhatsAppInner)) {
      throw new Error("WhatsApp inner is not initialized.");
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

  public async sendMessage(to: string, text: string) {
    return this.inner().sendMessage(to, text);
  }

  public pullMessages(limit?: number) {
    return this.inner().pullMessages(limit);
  }

  private configFromEnv(): WhatsAppConfig {
    return {
      enabled: process.env.WHATSAPP_ENABLED === "true",
      authDir: process.env.WHATSAPP_AUTH_DIR ?? path.join(WhatsAppRuntimeBaseDir, "auth"),
      mediaDir: process.env.WHATSAPP_MEDIA_DIR ?? path.join(WhatsAppRuntimeBaseDir, "media"),
    };
  }
}
