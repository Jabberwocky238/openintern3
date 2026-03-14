import type { AgentMessageRole } from "../types.js";

export interface OpenAICompatibleProviderOptions {
  apiKey: string;
  apiBase: string;
  defaultModel: string;
  extraHeaders?: Record<string, string>;
}

export interface OpenAIChatCompletionImagePart {
  type: "image_url";
  image_url: {
    url: string;
  };
}

export interface OpenAIChatCompletionTextPart {
  type: "text";
  text: string;
}

export type OpenAIChatCompletionContentPart =
  | OpenAIChatCompletionImagePart
  | OpenAIChatCompletionTextPart;

export interface OpenAIChatCompletionMessage {
  role: AgentMessageRole;
  content: string | OpenAIChatCompletionContentPart[] | null;
  tool_calls?: Array<Record<string, unknown>>;
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string | null;
  thinking_blocks?: Array<Record<string, unknown>>;
}

export interface OpenAIChatCompletionRequestBody {
  model: string;
  messages: OpenAIChatCompletionMessage[];
  tools?: Array<Record<string, unknown>>;
  tool_choice?: "auto";
  stream: true;
  max_tokens: number;
  temperature: number;
  reasoning_effort?: string;
}
