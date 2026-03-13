import {
  CapabilityProvider,
  type CapabilityContext,
  type CapabilityDescriptor,
  type CapabilityResult,
} from "@openintern/kernel/capability";
import type { WhatsAppInner } from "./inner.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface WhatsAppPluginLike {
  readonly name: string;
  readonly version: string;
  readonly isInitialized: boolean;
  inner(): WhatsAppInner;
}

abstract class WhatsAppCapabilityProvider extends CapabilityProvider {
  constructor(descriptor: CapabilityDescriptor, protected readonly plugin: WhatsAppPluginLike) {
    super(descriptor);
  }

  public override isAvailable(): boolean {
    return this.plugin.isInitialized;
  }
}

export class WhatsAppStartCapabilityProvider extends WhatsAppCapabilityProvider {
  constructor(plugin: WhatsAppPluginLike) {
    super({
      id: "whatsapp.start",
      description: "Start the WhatsApp client.",
      pluginName: plugin.name,
      version: plugin.version,
      tags: ["whatsapp", "channel", "control"],
      input: { type: "object", properties: {}, required: [], additionalProperties: false },
      output: {
        type: "object",
        properties: { started: { type: "boolean" } },
        required: ["started"],
        additionalProperties: false,
      },
    }, plugin);
  }

  public override async invoke(
    _input: unknown,
    _context?: CapabilityContext,
  ): Promise<CapabilityResult> {
    try {
      await this.plugin.inner().start();
      return { ok: true, value: { started: true } };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export class WhatsAppStopCapabilityProvider extends WhatsAppCapabilityProvider {
  constructor(plugin: WhatsAppPluginLike) {
    super({
      id: "whatsapp.stop",
      description: "Stop the WhatsApp client.",
      pluginName: plugin.name,
      version: plugin.version,
      tags: ["whatsapp", "channel", "control"],
      input: { type: "object", properties: {}, required: [], additionalProperties: false },
      output: {
        type: "object",
        properties: { stopped: { type: "boolean" } },
        required: ["stopped"],
        additionalProperties: false,
      },
    }, plugin);
  }

  public override async invoke(): Promise<CapabilityResult> {
    try {
      await this.plugin.inner().stop();
      return { ok: true, value: { stopped: true } };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export class WhatsAppStatusCapabilityProvider extends WhatsAppCapabilityProvider {
  constructor(plugin: WhatsAppPluginLike) {
    super({
      id: "whatsapp.status",
      description: "Get current WhatsApp plugin status.",
      pluginName: plugin.name,
      version: plugin.version,
      tags: ["whatsapp", "channel", "read"],
      input: { type: "object", properties: {}, required: [], additionalProperties: false },
      output: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          started: { type: "boolean" },
          authDir: { type: "string" },
          mediaDir: { type: "string" },
          queueSize: { type: "integer" },
          qrPending: { type: "boolean" },
          qrPath: { type: "string" },
          qrUpdatedAt: { type: "string" },
        },
        required: ["enabled", "started", "authDir", "mediaDir", "queueSize", "qrPending"],
        additionalProperties: true,
      },
    }, plugin);
  }

  public override async invoke(): Promise<CapabilityResult> {
    return { ok: true, value: this.plugin.inner().status() };
  }
}

export class WhatsAppSendMessageCapabilityProvider extends WhatsAppCapabilityProvider {
  constructor(plugin: WhatsAppPluginLike) {
    super({
      id: "whatsapp.send_message",
      description: "Send a text message to WhatsApp.",
      pluginName: plugin.name,
      version: plugin.version,
      tags: ["whatsapp", "channel", "write"],
      input: {
        type: "object",
        properties: {
          to: { type: "string" },
          text: { type: "string" },
        },
        required: ["to", "text"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          to: { type: "string" },
          sent: { type: "boolean" },
        },
        required: ["to", "sent"],
        additionalProperties: false,
      },
    }, plugin);
  }

  public override async invoke(input: unknown): Promise<CapabilityResult> {
    if (!isRecord(input) || typeof input.to !== "string" || typeof input.text !== "string") {
      return { ok: false, error: "to and text are required." };
    }
    try {
      return { ok: true, value: await this.plugin.inner().sendMessage(input.to, input.text) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export class WhatsAppPullMessagesCapabilityProvider extends WhatsAppCapabilityProvider {
  constructor(plugin: WhatsAppPluginLike) {
    super({
      id: "whatsapp.pull_messages",
      description: "Pull buffered inbound WhatsApp messages.",
      pluginName: plugin.name,
      version: plugin.version,
      tags: ["whatsapp", "channel", "read"],
      input: {
        type: "object",
        properties: {
          limit: { type: "integer" },
        },
        required: [],
        additionalProperties: false,
      },
      output: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            sender: { type: "string" },
            content: { type: "string" },
            timestamp: { type: "number" },
            isGroup: { type: "boolean" },
          },
          required: ["id", "sender", "content", "timestamp", "isGroup"],
          additionalProperties: true,
        },
      },
    }, plugin);
  }

  public override async invoke(input: unknown): Promise<CapabilityResult> {
    const limit =
      isRecord(input) && typeof input.limit === "number" && Number.isInteger(input.limit)
        ? input.limit
        : 50;
    return { ok: true, value: this.plugin.inner().pullMessages(limit) };
  }
}
