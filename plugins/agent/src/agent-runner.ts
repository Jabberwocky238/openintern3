import type { AgentMessage, AgentRunRequest, AgentRunResult } from "./provider.js";

export interface AgentRunner {
  run(request: AgentRunRequest): Promise<AgentRunResult>;
}

export interface AgentPromptRequest {
  prompt: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: string | null;
  signal?: AbortSignal;
}

export function buildPromptMessages(request: AgentPromptRequest): AgentMessage[] {
  const messages: AgentMessage[] = [];

  if (request.systemPrompt && request.systemPrompt.trim().length > 0) {
    messages.push({
      role: "system",
      content: request.systemPrompt,
    });
  }

  messages.push({
    role: "user",
    content: request.prompt,
  });

  return messages;
}
