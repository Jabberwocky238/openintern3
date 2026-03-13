import {
  CapabilityProvider,
  type CapabilityContext,
  type CapabilityResult,
} from "@openintern/kernel/capability";

interface CronPluginLike {
  readonly name: string;
  readonly version: string;
  readonly isInitialized: boolean;
  addCron(eventType: string, intervalMs: number): string;
  deleteCron(id: string): void;
  listCron(): Array<{
    id: string;
    eventType: string;
    intervalMs: number;
  }>;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class CronAddCapabilityProvider extends CapabilityProvider {
  constructor(private readonly plugin: CronPluginLike) {
    super({
      id: "cron.add",
      description: "Create a repeating cron job.",
      pluginName: plugin.name,
      version: plugin.version,
      tags: ["cron", "schedule", "write"],
      input: {
        type: "object",
        properties: {
          eventType: {
            type: "string",
            description: "Event type emitted by the cron job.",
          },
          intervalMs: {
            type: "number",
            description: "Cron interval in milliseconds.",
          },
        },
        required: ["eventType", "intervalMs"],
        additionalProperties: false,
      },
      output: {
        type: "string",
        description: "The created cron job id.",
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
    if (!isObjectRecord(input)) {
      return {
        ok: false,
        error: "cron.add expects an object input.",
      };
    }

    const eventType = input.eventType;
    const intervalMs = input.intervalMs;

    if (typeof eventType !== "string" || eventType.trim().length === 0) {
      return {
        ok: false,
        error: "eventType must be a non-empty string.",
      };
    }

    if (typeof intervalMs !== "number" || !Number.isInteger(intervalMs) || intervalMs <= 0) {
      return {
        ok: false,
        error: "intervalMs must be a positive integer.",
      };
    }

    return {
      ok: true,
      value: this.plugin.addCron(eventType, intervalMs),
    };
  }
}

export class CronDeleteCapabilityProvider extends CapabilityProvider {
  constructor(private readonly plugin: CronPluginLike) {
    super({
      id: "cron.delete",
      description: "Delete an existing cron job by id.",
      pluginName: plugin.name,
      version: plugin.version,
      tags: ["cron", "schedule", "write"],
      input: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Cron job id.",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        description: "Deletion result.",
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
    if (!isObjectRecord(input)) {
      return {
        ok: false,
        error: "cron.delete expects an object input.",
      };
    }

    const id = input.id;

    if (typeof id !== "string" || id.trim().length === 0) {
      return {
        ok: false,
        error: "id must be a non-empty string.",
      };
    }

    this.plugin.deleteCron(id);

    return {
      ok: true,
      value: {
        deleted: true,
        id,
      },
    };
  }
}

export class CronListCapabilityProvider extends CapabilityProvider {
  constructor(private readonly plugin: CronPluginLike) {
    super({
      id: "cron.list",
      description: "List all active cron jobs.",
      pluginName: plugin.name,
      version: plugin.version,
      tags: ["cron", "schedule", "read"],
      input: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      output: {
        type: "array",
        description: "Active cron jobs.",
      },
    });
  }

  public override isAvailable(): boolean {
    return this.plugin.isInitialized;
  }

  public override async invoke(
    _input: unknown,
    _context?: CapabilityContext,
  ): Promise<CapabilityResult> {
    return {
      ok: true,
      value: this.plugin.listCron(),
    };
  }
}
