import type {
  AgentProvider,
  AgentRunRequest,
  AgentRunResult,
} from "./provider.js";
import {
  parseSsePayload,
  parseToolCalls,
  sanitizeMessages,
  summarizeResponseBody,
} from "./response-parser.js";

export interface OpenAICompatibleProviderOptions {
  apiKey: string;
  apiBase: string;
  defaultModel: string;
  extraHeaders?: Record<string, string>;
}

export class OpenAICompatibleProvider implements AgentProvider {
  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly defaultModel: string;
  private readonly extraHeaders: Record<string, string>;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.apiKey = options.apiKey;
    this.apiBase = options.apiBase.replace(/\/+$/, "");
    this.defaultModel = options.defaultModel;
    this.extraHeaders = options.extraHeaders ?? {};
  }

  public getDefaultModel(): string {
    return this.defaultModel;
  }

  public async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const model = request.model ?? this.defaultModel;

    try {
      const response = await fetch(`${this.apiBase}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
          ...this.extraHeaders,
        },
        body: JSON.stringify({
          model,
          messages: sanitizeMessages(request.messages),
          tools: request.tools && request.tools.length > 0 ? request.tools : undefined,
          tool_choice: request.tools && request.tools.length > 0 ? "auto" : undefined,
          stream: false,
          max_tokens: Math.max(1, request.maxTokens ?? 4096),
          temperature: request.temperature ?? 0.7,
          reasoning_effort: request.reasoningEffort ?? undefined,
        }),
        signal: request.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
      return {
        finalContent: `Error calling agent provider: HTTP ${response.status} ${response.statusText}. ${errorText}`,
        toolCalls: [],
        finishReason: "error",
      };
      }

      const rawText = await response.text();
      let payload: Record<string, unknown>;

      try {
        payload = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        const ssePayload = parseSsePayload(rawText);

        if (ssePayload) {
          payload = ssePayload;
        } else {
          return {
            finalContent: `Error calling agent provider: Response was not valid JSON. ${summarizeResponseBody(rawText)}`,
            toolCalls: [],
            finishReason: "error",
          };
        }
      }

      const choices = Array.isArray(payload.choices) ? payload.choices : [];
      const firstChoice =
        choices.length > 0 && typeof choices[0] === "object" && choices[0] !== null
          ? (choices[0] as Record<string, unknown>)
          : {};
      const message =
        typeof firstChoice.message === "object" && firstChoice.message !== null
          ? (firstChoice.message as Record<string, unknown>)
          : {};

      return {
        finalContent: typeof message.content === "string" ? message.content : null,
        toolCalls: parseToolCalls(message.tool_calls),
        finishReason:
          typeof firstChoice.finish_reason === "string" ? firstChoice.finish_reason : "stop",
        usage:
          typeof payload.usage === "object" && payload.usage !== null
            ? (payload.usage as Record<string, number>)
            : {},
        reasoningContent:
          typeof message.reasoning_content === "string" ? message.reasoning_content : null,
        thinkingBlocks: Array.isArray(message.thinking_blocks)
          ? (message.thinking_blocks as Array<Record<string, unknown>>)
          : undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        finalContent: `Error calling agent provider: ${message}`,
        toolCalls: [],
        finishReason: "error",
      };
    }
  }
}
