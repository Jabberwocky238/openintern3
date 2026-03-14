import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AgentProvider,
  AgentRunRequest,
  AgentRunResult,
} from "../types.js";
import type {
  OpenAIChatCompletionContentPart,
  OpenAIChatCompletionMessage,
  OpenAIChatCompletionRequestBody,
  OpenAICompatibleProviderOptions,
} from "./openai-compatible-provider-types.js";
import {
  parseSsePayload,
  parseToolCalls,
  sanitizeMessages,
  summarizeResponseBody,
} from "../response-parser.js";

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
      const body = await this.buildChatCompletionRequestBody(request, model);
      const response = await this.sendChatCompletionRequest(body, request.signal);

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

  private async buildChatCompletionRequestBody(
    request: AgentRunRequest,
    model: string,
  ): Promise<OpenAIChatCompletionRequestBody> {
    return {
      model,
      messages: await this.toProviderMessages(request.messages),
      tools: request.tools && request.tools.length > 0 ? request.tools : undefined,
      tool_choice: request.tools && request.tools.length > 0 ? "auto" : undefined,
      stream: true,
      max_tokens: Math.max(1, request.maxTokens ?? 4096),
      temperature: request.temperature ?? 0.7,
      reasoning_effort: request.reasoningEffort ?? undefined,
    };
  }

  private async sendChatCompletionRequest(
    body: OpenAIChatCompletionRequestBody,
    signal?: AbortSignal,
  ): Promise<Response> {
    return fetch(`${this.apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
        ...this.extraHeaders,
      },
      body: JSON.stringify(body),
      signal,
    });
  }

  private async toProviderMessages(messages: AgentRunRequest["messages"]): Promise<OpenAIChatCompletionMessage[]> {
    const sanitized = sanitizeMessages(messages);
    const out: OpenAIChatCompletionMessage[] = [];

    for (const message of sanitized) {
      const normalizedRole = message.role === "tool" ? "user" : message.role;
      const rawContent = typeof message.content === "string" || message.content === null
        ? message.content
        : null;
      const normalizedContent = this.normalizeToolContent(message, rawContent);
      const content =
        normalizedRole === "user" && typeof normalizedContent === "string"
          ? await this.toUserContentParts(normalizedContent)
          : normalizedContent;

      out.push({
        role: normalizedRole as OpenAIChatCompletionMessage["role"],
        content,
        ...(Array.isArray(message.tool_calls) ? { tool_calls: message.tool_calls } : {}),
        ...(typeof message.name === "string" ? { name: message.name } : {}),
        ...(typeof message.reasoning_content === "string" || message.reasoning_content === null
          ? { reasoning_content: message.reasoning_content }
          : {}),
        ...(Array.isArray(message.thinking_blocks)
          ? { thinking_blocks: message.thinking_blocks }
          : {}),
      });
    }

    return out;
  }

  private normalizeToolContent(
    message: Record<string, unknown>,
    rawContent: string | null,
  ): string | null {
    if (message.role !== "tool") {
      return rawContent;
    }

    const toolName = typeof message.name === "string" ? message.name : "tool";
    const toolCallId =
      typeof message.tool_call_id === "string" && message.tool_call_id.trim().length > 0
        ? ` (${message.tool_call_id})`
        : "";
    const content = rawContent ?? "";

    return `Tool result from ${toolName}${toolCallId}:\n${content}`.trim();
  }

  private async toUserContentParts(content: string): Promise<string | OpenAIChatCompletionContentPart[]> {
    const mediaPaths = this.extractReferencedMediaPaths(content);
    if (mediaPaths.length === 0) {
      return content;
    }

    const parts: OpenAIChatCompletionContentPart[] = [];
    if (content.trim()) {
      parts.push({
        type: "text",
        text: content,
      });
    }

    for (const mediaPath of mediaPaths) {
      const imageDataUrl = await this.toImageDataUrl(mediaPath);
      if (!imageDataUrl) {
        continue;
      }

      parts.push({
        type: "image_url",
        image_url: {
          url: imageDataUrl,
        },
      });
    }

    return parts.length > 0 ? parts : content;
  }

  private extractReferencedMediaPaths(content: string): string[] {
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim())
      .filter((line) => this.isSupportedImagePath(line));
  }

  private isSupportedImagePath(filePath: string): boolean {
    const extension = path.extname(filePath).toLowerCase();
    return [".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(extension);
  }

  private async toImageDataUrl(filePath: string): Promise<string | null> {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);

    try {
      await access(absolutePath);
      const buffer = await readFile(absolutePath);
      const mimeType = this.mimeTypeFromExtension(path.extname(absolutePath));
      return `data:${mimeType};base64,${buffer.toString("base64")}`;
    } catch {
      return null;
    }
  }

  private mimeTypeFromExtension(extension: string): string {
    const normalized = extension.toLowerCase();
    if (normalized === ".png") {
      return "image/png";
    }
    if (normalized === ".jpg" || normalized === ".jpeg") {
      return "image/jpeg";
    }
    if (normalized === ".gif") {
      return "image/gif";
    }
    if (normalized === ".webp") {
      return "image/webp";
    }
    return "application/octet-stream";
  }
}
