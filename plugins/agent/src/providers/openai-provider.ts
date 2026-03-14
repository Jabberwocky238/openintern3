import { access, readFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import type {
  ChatCompletionMessageToolCall,
  ChatCompletionMessageParam,
  ChatCompletionReasoningEffort,
  ChatCompletionTool,
} from "openai/resources/chat/completions/completions";
import type {
  AgentMessage,
  AgentProvider,
  AgentRunRequest,
  AgentRunResult,
  AgentToolCallRequest,
} from "../types.js";
import type {
  OpenAIChatCompletionContentPart,
  OpenAICompatibleProviderOptions,
} from "./openai-compatible-provider-types.js";

export class OpenAIProvider implements AgentProvider {
  private readonly client: OpenAI;
  private readonly defaultModel: string;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.defaultModel = options.defaultModel;
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.apiBase,
      defaultHeaders: options.extraHeaders,
    });
  }

  public getDefaultModel(): string {
    return this.defaultModel;
  }

  public async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const model = request.model ?? this.defaultModel;
    const reasoningEffort = this.toReasoningEffort(request.reasoningEffort);

    try {
      const stream = await this.client.chat.completions.create(
        {
          model,
          messages: await this.toProviderMessages(request.messages),
          tools: this.toChatCompletionTools(request.tools),
          tool_choice: request.tools && request.tools.length > 0 ? "auto" : undefined,
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: Math.max(1, request.maxTokens ?? 4096),
          temperature: request.temperature ?? 0.7,
          reasoning_effort: reasoningEffort,
        },
        {
          signal: request.signal,
        },
      );

      let finalContent = "";
      let finishReason: string | undefined;
      let usage: Record<string, number> | undefined;
      type ToolCallInfo = { id: string; name: string; argumentsText: string };
      const toolCallsByIndex = new Map<number, ToolCallInfo>();

      for await (const chunk of stream) {
        const choice = chunk.choices[0];

        if (choice?.delta?.content) {
          finalContent += choice.delta.content;
        }

        if (typeof choice?.finish_reason === "string") {
          finishReason = choice.finish_reason;
        }

        const deltaToolCalls = choice?.delta?.tool_calls ?? [];
        for (const toolCall of deltaToolCalls) {
          const index = toolCall.index ?? 0;
          const current = toolCallsByIndex.get(index) ?? {
            id: toolCall.id ?? "",
            name: "",
            argumentsText: "",
          };

          if (typeof toolCall.id === "string" && toolCall.id.length > 0) {
            current.id = toolCall.id;
          }

          if (typeof toolCall.function?.name === "string" && toolCall.function.name.length > 0) {
            current.name = toolCall.function.name;
          }

          if (typeof toolCall.function?.arguments === "string") {
            current.argumentsText += toolCall.function.arguments;
          }

          toolCallsByIndex.set(index, current);
        }

        if (chunk.usage) {
          usage = {
            prompt_tokens: chunk.usage.prompt_tokens ?? 0,
            completion_tokens: chunk.usage.completion_tokens ?? 0,
            total_tokens: chunk.usage.total_tokens ?? 0,
          };
        }
      }

      return {
        finalContent: finalContent || null,
        toolCalls: this.finalizeToolCalls(toolCallsByIndex),
        finishReason: finishReason ?? "stop",
        usage,
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

  private finalizeToolCalls(
    toolCallsByIndex: Map<number, { id: string; name: string; argumentsText: string }>,
  ): AgentToolCallRequest[] {
    return [...toolCallsByIndex.values()]
      .filter((toolCall) => toolCall.name.trim().length > 0)
      .map((toolCall, index) => {
        let parsedArguments: Record<string, unknown> = {};

        if (toolCall.argumentsText.trim()) {
          try {
            const parsed = JSON.parse(toolCall.argumentsText) as unknown;
            if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
              parsedArguments = parsed as Record<string, unknown>;
            }
          } catch {
            parsedArguments = {};
          }
        }

        return {
          id: toolCall.id || `${toolCall.name}_${index + 1}`,
          name: toolCall.name,
          arguments: parsedArguments,
        };
      });
  }

  private async toProviderMessages(messages: AgentMessage[]): Promise<ChatCompletionMessageParam[]> {
    const out: ChatCompletionMessageParam[] = [];

    for (const message of messages) {
      const mapped = await this.toProviderMessage(message);
      if (mapped) {
        out.push(mapped);
      }
    }

    return out;
  }

  private async toProviderMessage(message: AgentMessage): Promise<ChatCompletionMessageParam | null> {
    if (message.role === "system") {
      return {
        role: "system",
        content: message.content ?? "",
        ...(typeof message.name === "string" ? { name: message.name } : {}),
      };
    }

    if (message.role === "user") {
      return {
        role: "user",
        content:
          typeof message.content === "string"
            ? await this.toUserContentParts(message.content)
            : "",
        ...(typeof message.name === "string" ? { name: message.name } : {}),
      };
    }

    if (message.role === "assistant") {
      return {
        role: "assistant",
        content: message.content,
        ...(Array.isArray(message.tool_calls)
          ? { tool_calls: message.tool_calls as unknown as ChatCompletionMessageToolCall[] }
          : {}),
        ...(typeof message.name === "string" ? { name: message.name } : {}),
      };
    }

    if (message.role === "tool" && typeof message.tool_call_id === "string") {
      return {
        role: "tool",
        tool_call_id: message.tool_call_id,
        content: message.content ?? "",
      };
    }

    return null;
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

  private toChatCompletionTools(
    tools: AgentRunRequest["tools"],
  ): ChatCompletionTool[] | undefined {
    if (!tools || tools.length === 0) {
      return undefined;
    }

    return tools as unknown as ChatCompletionTool[];
  }

  private toReasoningEffort(
    reasoningEffort: string | null | undefined,
  ): ChatCompletionReasoningEffort | undefined {
    if (
      reasoningEffort === "low" ||
      reasoningEffort === "medium" ||
      reasoningEffort === "high"
    ) {
      return reasoningEffort;
    }

    return undefined;
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
