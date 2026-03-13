export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<Record<string, unknown>>;
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string | null;
  thinking_blocks?: Array<Record<string, unknown>>;
}

export interface AgentToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentRunRequest {
  messages: AgentMessage[];
  tools?: Array<Record<string, unknown>>;
  model?: string;
  maxIterations?: number;
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: string | null;
  signal?: AbortSignal;
}

export interface AgentRunResult {
  finalContent: string | null;
  toolCalls: AgentToolCallRequest[];
  finishReason?: string;
  usage?: Record<string, number>;
  reasoningContent?: string | null;
  thinkingBlocks?: Array<Record<string, unknown>>;
}

export interface AgentProvider {
  run(request: AgentRunRequest): Promise<AgentRunResult>;
  getDefaultModel(): string;
}
