import {
  CapabilityProvider,
  type CapabilityContext,
  type CapabilityDescriptor,
  type CapabilityResult,
} from "@openintern/kernel/capability";
import type { WecomEngine } from "./engine.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface WecomPluginLike {
  readonly name: string;
  readonly version: string;
  readonly isInitialized: boolean;
  inner(): WecomEngine;
}

abstract class WecomCapabilityProvider extends CapabilityProvider {
  constructor(descriptor: CapabilityDescriptor, protected readonly plugin: WecomPluginLike) {
    super(descriptor);
  }

  public override isAvailable(): boolean {
    return this.plugin.isInitialized;
  }
}

export class WecomStartCapabilityProvider extends WecomCapabilityProvider {
  constructor(plugin: WecomPluginLike) {
    super({
      id: "wecom.start",
      description: "Start the WeCom WebSocket client.",
      pluginName: plugin.name,
      version: plugin.version,
      tags: ["wecom", "channel", "control"],
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

export class WecomStopCapabilityProvider extends WecomCapabilityProvider {
  constructor(plugin: WecomPluginLike) {
    super({
      id: "wecom.stop",
      description: "Stop the WeCom WebSocket client.",
      pluginName: plugin.name,
      version: plugin.version,
      tags: ["wecom", "channel", "control"],
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

export class WecomStatusCapabilityProvider extends WecomCapabilityProvider {
  constructor(plugin: WecomPluginLike) {
    super({
      id: "wecom.status",
      description: "Get current WeCom plugin status.",
      pluginName: plugin.name,
      version: plugin.version,
      tags: ["wecom", "channel", "read"],
      input: { type: "object", properties: {}, required: [], additionalProperties: false },
      output: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          started: { type: "boolean" },
          connected: { type: "boolean" },
          authenticated: { type: "boolean" },
          websocketUrl: { type: "string" },
          botId: { type: "string" },
          mediaDir: { type: "string" },
          queueSize: { type: "integer" },
          reconnectAttempts: { type: "integer" },
          lastError: { type: "string" },
          allowFrom: { type: "array", items: { type: "string" } },
          groupAllowFrom: { type: "array", items: { type: "string" } },
        },
        required: [
          "enabled",
          "started",
          "connected",
          "authenticated",
          "websocketUrl",
          "botId",
          "mediaDir",
          "queueSize",
          "reconnectAttempts",
          "allowFrom",
          "groupAllowFrom",
        ],
        additionalProperties: true,
      },
    }, plugin);
  }

  public override async invoke(): Promise<CapabilityResult> {
    return { ok: true, value: this.plugin.inner().status() };
  }
}

export class WecomSendMessageCapabilityProvider extends WecomCapabilityProvider {
  constructor(plugin: WecomPluginLike) {
    super({
      id: "wecom.send_message",
      description: "Send a markdown message to WeCom users or groups.",
      pluginName: plugin.name,
      version: plugin.version,
      tags: ["wecom", "channel", "write"],
      input: {
        type: "object",
        properties: {
          to: { type: "string", description: "A userid for DM or a chatid for group." },
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

export class WecomPullMessagesCapabilityProvider extends WecomCapabilityProvider {
  constructor(plugin: WecomPluginLike) {
    super({
      id: "wecom.pull_messages",
      description: "Pull buffered inbound WeCom messages.",
      pluginName: plugin.name,
      version: plugin.version,
      tags: ["wecom", "channel", "read"],
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
            senderId: { type: "string" },
            chatId: { type: "string" },
            content: { type: "string" },
            timestamp: { type: "string" },
            msgType: { type: "string" },
          },
          required: ["id", "senderId", "chatId", "content", "timestamp", "msgType"],
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
