import {
  CapabilityProvider,
  type CapabilityContext,
  type CapabilityDescriptor,
  type CapabilityResult,
} from "@openintern/kernel/capability";
import type { WebSearchEngine } from "./engine.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface WebSearchPluginLike {
  readonly name: string;
  readonly version: string;
  readonly isInitialized: boolean;
  engine(): WebSearchEngine;
}

abstract class WebSearchCapabilityProvider extends CapabilityProvider {
  constructor(
    descriptor: CapabilityDescriptor,
    protected readonly plugin: WebSearchPluginLike,
  ) {
    super(descriptor);
  }

  public override isAvailable(): boolean {
    return this.plugin.isInitialized;
  }
}

export class WebSearchSearchCapabilityProvider extends WebSearchCapabilityProvider {
  constructor(plugin: WebSearchPluginLike) {
    super(
      {
        id: "web_search.search",
        description: "Search the web and return a short list of relevant results with titles, URLs, and snippets.",
        pluginName: plugin.name,
        version: plugin.version,
        tags: ["web-search", "search", "read"],
        input: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query.",
            },
            max_results: {
              type: "integer",
              description: "Maximum number of results to return.",
            },
          },
          required: ["query"],
          additionalProperties: false,
        },
        output: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              url: { type: "string" },
              snippet: { type: "string" },
            },
            required: ["title", "url", "snippet"],
            additionalProperties: false,
          },
        },
      },
      plugin,
    );
  }

  public override async invoke(
    input: unknown,
    _context?: CapabilityContext,
  ): Promise<CapabilityResult> {
    if (!isRecord(input) || typeof input.query !== "string" || input.query.trim().length === 0) {
      return { ok: false, error: "query must be a non-empty string." };
    }

    const maxResults =
      typeof input.max_results === "number" && Number.isInteger(input.max_results)
        ? input.max_results
        : 5;

    try {
      return {
        ok: true,
        value: await this.plugin.engine().search(input.query, maxResults),
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
