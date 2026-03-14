import type { AgentSessionStore } from "./session-store.js";

export type AgentMessageRole = "system" | "user" | "assistant" | "tool";

export interface AgentMessage {
  role: AgentMessageRole;
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

export interface OpenAICompatibleProviderOptions {
  apiKey: string;
  apiBase: string;
  defaultModel: string;
  extraHeaders?: Record<string, string>;
}

export interface AgentLoopExecution {
  result: AgentRunResult;
  messages: AgentMessage[];
}

export interface AgentExecutionOptions {
  sessionId?: string;
  isolation?: SubagentIsolationContext;
}

export interface SubagentSpawnRequest {
  task: string;
  sessionId?: string;
  role?: string;
  callbackSummary?: boolean;
}

export interface SubagentTaskRecord {
  id: string;
  parentSessionId: string;
  sessionId: string;
  task: string;
  role?: string;
  status: "queued" | "running" | "completed" | "failed";
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: string | null;
  error?: string;
}

export interface SubagentTaskExecution {
  finalContent: string | null;
}

export interface SubagentExecutionPolicy {
  allowedCapabilityIds: string[];
  maxDepth: number;
}

export interface SubagentIsolationContext {
  actorType: "subagent";
  depth: number;
  parentSessionId: string;
  sessionId: string;
  taskId: string;
  allowedCapabilityIds: string[];
}

export interface SubagentPluginLike {
  readonly name: string;
  readonly version: string;
  readonly isInitialized: boolean;
  runSubagentSession(
    sessionId: string,
    task: string,
    isolation: SubagentIsolationContext,
    role?: string,
  ): Promise<SubagentTaskExecution>;
  getSessionStoreForSubagent(): AgentSessionStore;
}

export type AgentChannelName = "feishu" | "whatsapp" | "wecom";

export interface AgentChannelMessage {
  channel: AgentChannelName;
  senderId: string;
  chatId: string;
  content: string;
  timestamp: string;
  media: string[];
  metadata: Record<string, unknown>;
}
