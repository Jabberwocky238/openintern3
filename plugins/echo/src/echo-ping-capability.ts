import {
  CapabilityProvider,
  type CapabilityContext,
  type CapabilityResult,
} from "@openintern/kernel/capability";

interface EchoPingPluginLike {
  readonly name: string;
  readonly version: string;
  readonly isInitialized: boolean;
  ping(args: unknown[]): string;
}

export class EchoPingCapabilityProvider extends CapabilityProvider {
  constructor(private readonly plugin: EchoPingPluginLike) {
    super({
      id: "echo.ping",
      description: "Log any provided arguments and return pong.",
      pluginName: plugin.name,
      version: plugin.version,
      tags: ["echo", "ping"],
      input: {
        type: "object",
        properties: {
          args: {
            type: "array",
            description: "Arguments forwarded to echo.ping.",
            items: {
              type: "string",
              description: "A single echo argument.",
            },
          },
        },
        required: ["args"],
        additionalProperties: false,
      },
      output: {
        type: "string",
        description: "The ping result.",
      },
    });
  }

  public override isAvailable(): boolean {
    return this.plugin.isInitialized;
  }

  public override async invoke(
    input: unknown,
    _context?: CapabilityContext,
  ): Promise<CapabilityResult> {
    const args =
      typeof input === "object" &&
      input !== null &&
      "args" in input &&
      Array.isArray((input as { args?: unknown }).args)
        ? (input as { args: unknown[] }).args
        : [];

    return {
      ok: true,
      value: this.plugin.ping(args),
    };
  }
}
