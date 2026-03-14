import {
  CapabilityProvider,
  EventSubTarget,
  type PluginEvent,
  Plugin,
} from "@openintern/kernel";
import type {
  AgentChannelMessage,
  AgentExecutionOptions,
  AgentLoopExecution,
  AgentMessage,
  AgentPromptRequest,
  AgentProvider,
  AgentRunner,
  AgentRunRequest,
  AgentRunResult,
  AgentToolCallRequest,
} from "./types.js";
import type { OpenAICompatibleProviderOptions } from "./providers/openai-compatible-provider-types.js";
import { AgentSessionStore } from "./session-store.js";
import { DEFAULT_AGENT_ALLOWED_CAPABILITIES } from "./capability-use.js";
import {
  AgentSpawnCapabilityProvider,
  type SubagentIsolationContext,
  SubagentManager,
} from "./subagent.js";
import { OpenAICompatibleProvider } from "./providers/openai-compatible-provider.js";

const DEFAULT_MAX_TOOL_ITERATIONS = 8;
const SESSION_STORE_STATE_KEY = "sessionStore";
const SUBAGENT_MANAGER_STATE_KEY = "subagentManager";

export default class AgentPlugin extends Plugin implements AgentRunner {
  private provider?: AgentProvider;
  private lastProgressMessageBySession = new Map<string, string>();

  constructor() {
    super({
      name: "agent",
      version: "0.0.0",
      namespaces: ["agent"],
    });
  }

  public override async init(): Promise<void> {
    this.state[SESSION_STORE_STATE_KEY] = new AgentSessionStore(process.cwd());
    this.state[SUBAGENT_MANAGER_STATE_KEY] = new SubagentManager(this);
    this.provider = new OpenAICompatibleProvider(this.getProviderOptions());
    this.eventBus?.sub<AgentPlugin, "onChannelMessage">(
      this,
      EventSubTarget.namespace("channel"),
      "message.received",
      "onChannelMessage",
    );
  }

  public async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const messages = this.normalizeMessages(request.messages);

    if (messages.length === 0) {
      throw new TypeError("messages must contain at least one valid message.");
    }

    const execution = await this.executeLoop(request, messages);
    return execution.result;
  }

  public async runPrompt(
    prompt: string,
    model?: string,
    systemPrompt?: string,
  ): Promise<AgentRunResult> {
    if (typeof prompt !== "string" || prompt.trim().length === 0) {
      throw new TypeError("prompt must be a non-empty string.");
    }

    const request: AgentPromptRequest = {
      prompt,
      model,
      systemPrompt,
    };

    return this.run({
      messages: buildPromptMessages(request),
      model: request.model,
    });
  }

  public getDefaultModel(): string {
    return this.getProvider().getDefaultModel();
  }

  public async invokeCapability(
    capabilityId: string,
    input?: unknown,
  ): Promise<unknown> {
    if (typeof capabilityId !== "string" || capabilityId.trim().length === 0) {
      throw new TypeError("capabilityId must be a non-empty string.");
    }

    const normalizedInput = this.normalizeCapabilityInput(input);
    const result = await this.invoker().invoke(
      capabilityId,
      normalizedInput,
      {
        callerPluginName: this.name,
      },
    );

    if (!result.ok) {
      throw new Error(result.error ?? `Capability invocation failed: ${capabilityId}`);
    }

    return result.value;
  }

  public async pingEcho(...args: unknown[]): Promise<unknown> {
    return this.invokeCapability("echo.ping", { args });
  }

  public async runSession(
    sessionId: string,
    input: string,
    model?: string,
    systemPrompt?: string,
    onProgressMessage?: (message: string) => Promise<void>,
  ): Promise<AgentRunResult> {
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw new TypeError("sessionId must be a non-empty string.");
    }

    if (typeof input !== "string" || input.trim().length === 0) {
      throw new TypeError("input must be a non-empty string.");
    }

    const sessions = this.getSessionStore();
    const key = sessionId.trim();
    const session = await sessions.getOrCreate(key);
    const originalMessageCount = session.messages.length;
    const baseMessages = session.getHistory();

    if (session.messages.length === 0 && systemPrompt && systemPrompt.trim().length > 0) {
      baseMessages.push({
        role: "system",
        content: systemPrompt,
      });
    }

    baseMessages.push({
      role: "user",
      content: input,
    });

    const execution = await this.executeLoop(
      {
        messages: baseMessages,
        model,
      },
      baseMessages,
      {
        sessionId: key,
        onProgressMessage,
      },
    );

    const concurrentMessages = session.messages.slice(originalMessageCount);
    session.messages = execution.messages.concat(concurrentMessages);
    session.updatedAt = new Date();
    await sessions.save(session);
    this.lastProgressMessageBySession.delete(key);

    return execution.result;
  }

  public async resetSession(sessionId: string): Promise<void> {
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw new TypeError("sessionId must be a non-empty string.");
    }

    await this.getSessionStore().clear(sessionId.trim());
  }

  public async listSessions(): Promise<string[]> {
    return this.getSessionStore().listKeys();
  }

  public override capabilities(): CapabilityProvider[] {
    return [
      new AgentSpawnCapabilityProvider(this, this.getSubagentManager()),
    ];
  }

  public getSessionStoreForSubagent(): AgentSessionStore {
    return this.getSessionStore();
  }

  public async runSubagentSession(
    sessionId: string,
    task: string,
    isolation: SubagentIsolationContext,
    role?: string,
  ): Promise<AgentRunResult> {
    const roleInstruction = role?.trim()
      ? `You are a focused subagent working as a ${role.trim()}. Complete the delegated task and return only the useful result for the parent agent.`
      : "You are a focused subagent. Complete the delegated task and return only the useful result for the parent agent.";
    const sessions = this.getSessionStore();
    const session = await sessions.getOrCreate(sessionId);
    const originalMessageCount = session.messages.length;
    const baseMessages = session.getHistory();

    if (session.messages.length === 0) {
      baseMessages.push({
        role: "system",
        content: [
          roleInstruction,
          "Isolation rules:",
          `- You are isolated from the parent session '${isolation.parentSessionId}'.`,
          `- Your task id is '${isolation.taskId}'.`,
          `- You may only use these capabilities: ${isolation.allowedCapabilityIds.join(", ")}.`,
          "- Do not ask for or attempt any capability outside this allowlist.",
          "- Do not spawn another subagent.",
        ].join("\n"),
      });
    }

    baseMessages.push({
      role: "user",
      content: task,
    });

    const execution = await this.executeLoop(
      {
        messages: baseMessages,
      },
      baseMessages,
      {
        sessionId,
        isolation,
      },
    );

    const concurrentMessages = session.messages.slice(originalMessageCount);
    session.messages = execution.messages.concat(concurrentMessages);
    session.updatedAt = new Date();
    await sessions.save(session);
    this.lastProgressMessageBySession.delete(sessionId);
    return execution.result;
  }

  public async onChannelMessage(event: PluginEvent): Promise<void> {
    const payload = this.toChannelMessage(event.payload);
    if (!payload) {
      return;
    }

    this.logger().info("agent received channel bus message", {
      channel: payload.channel,
      senderId: payload.senderId,
      chatId: payload.chatId,
      contentPreview: payload.content.slice(0, 120),
      mediaCount: payload.media.length,
    });

    if (!payload.chatId.trim()) {
      return;
    }

    const route = this.resolveChannelRoute(payload.channel);
    if (!route) {
      return;
    }

    const result = await this.runSession(
      `${route.sessionPrefix}:${payload.chatId}`,
      this.formatChannelInput(payload),
      undefined,
      undefined,
      async (message) => {
        await this.invokeCapability(route.replyCapabilityId, {
          to: payload.chatId,
          text: message,
        });
      },
    );
    if (!result.finalContent || !result.finalContent.trim()) {
      this.logger().info("agent produced empty channel reply", {
        channel: payload.channel,
        chatId: payload.chatId,
        sessionId: `${route.sessionPrefix}:${payload.chatId}`,
      });
    }
  }

  private async executeToolCall(
    capabilityId: string,
    toolCall: AgentToolCallRequest,
    options?: AgentExecutionOptions,
  ): Promise<string> {
    const deniedReason = this.getCapabilityDenyReason(capabilityId, options?.isolation);

    if (deniedReason) {
      this.logger().warn("agent tool call denied", {
        capabilityId,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        reason: deniedReason,
        sessionId: options?.sessionId,
      });
      return `Error: ${deniedReason}`;
    }

    this.logger().info("agent invoking capability", {
      capabilityId,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      arguments: toolCall.arguments,
      sessionId: options?.sessionId,
    });

    const result = await this.invoker().invoke(
      capabilityId,
      toolCall.arguments,
      {
        callerPluginName: this.name,
        metadata: this.buildInvocationMetadata(options),
      },
    );

    if (!result.ok) {
      this.logger().warn("agent capability invocation failed", {
        capabilityId,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        error: result.error ?? `Capability invocation failed: ${capabilityId}`,
        sessionId: options?.sessionId,
      });
      return `Error: ${result.error ?? `Capability invocation failed: ${capabilityId}`}`;
    }

    const stringified = this.stringifyToolResult(result.value);
    this.logger().info("agent capability invocation completed", {
      capabilityId,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      sessionId: options?.sessionId,
      resultPreview: stringified.slice(0, 240),
    });

    return stringified;
  }

  private async buildCapabilityTools(
    isolation?: SubagentIsolationContext,
  ): Promise<Array<{
    capabilityId: string;
    toolName: string;
    definition: Record<string, unknown>;
  }>> {
    const descriptors = await this.registry().list();
    const allowedCapabilityIds = isolation
      ? isolation.allowedCapabilityIds
      : [...DEFAULT_AGENT_ALLOWED_CAPABILITIES];
    const visibleDescriptors = descriptors.filter(
      (descriptor) => allowedCapabilityIds.includes(descriptor.id),
    );

    return visibleDescriptors.map((descriptor) => {
      const toolName = this.toProviderToolName(descriptor.id);

      return {
        capabilityId: descriptor.id,
        toolName,
        definition: {
          type: "function",
          function: {
            name: toolName,
            description: descriptor.description,
            parameters: descriptor.input ?? {
              type: "object",
              properties: {},
              required: [],
              additionalProperties: true,
            },
          },
        },
      };
    });
  }

  private toProviderToolName(capabilityId: string): string {
    return capabilityId.replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  private stringifyToolResult(value: unknown): string {
    if (value === undefined) {
      return "OK";
    }

    if (typeof value === "string") {
      return value;
    }

    return JSON.stringify(value, null, 2);
  }

  private getProvider(): AgentProvider {
    if (!this.provider) {
      throw new Error("Agent provider is not initialized.");
    }

    return this.provider;
  }

  private async executeLoop(
    request: AgentRunRequest,
    initialMessages: AgentMessage[],
    options?: AgentExecutionOptions,
  ): Promise<AgentLoopExecution> {
    const tools = await this.buildCapabilityTools(options?.isolation);
    const toolNameMap = new Map(tools.map((tool) => [tool.toolName, tool.capabilityId]));
    const activeMessages = [...initialMessages];
    const maxIterations = request.maxIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
    let lastResult: AgentRunResult = {
      finalContent: null,
      toolCalls: [],
    };

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const result = await this.getProvider().run({
        ...request,
        messages: activeMessages,
        tools: tools.map((tool) => tool.definition),
      });

      lastResult = result;
      this.logger().info("agent provider returned result", {
        iteration: iteration + 1,
        sessionId: options?.sessionId,
        finishReason: result.finishReason ?? "stop",
        finalContentPreview: (result.finalContent ?? "").slice(0, 240),
        toolCallCount: result.toolCalls.length,
      });
      await this.emitProgressMessage(options, result.finalContent ?? "");

      if (result.toolCalls.length === 0) {
        activeMessages.push({
          role: "assistant",
          content: result.finalContent,
          reasoning_content: result.reasoningContent,
          thinking_blocks: result.thinkingBlocks,
        });

        return {
          result,
          messages: activeMessages,
        };
      }

      this.logger().info("agent received tool calls", {
        iteration: iteration + 1,
        sessionId: options?.sessionId,
        toolCalls: result.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          name: toolCall.name,
        })),
      });

      activeMessages.push({
        role: "assistant",
        content: result.finalContent,
        tool_calls: result.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: "function",
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments),
          },
        })),
        reasoning_content: result.reasoningContent,
        thinking_blocks: result.thinkingBlocks,
      });

      for (const toolCall of result.toolCalls) {
        if (request.signal?.aborted) {
          throw new Error("Request aborted");
        }

        const capabilityId = toolNameMap.get(toolCall.name) ?? toolCall.name;
        const toolResult = await this.executeToolCall(capabilityId, toolCall, options);

        activeMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolCall.name,
          content: toolResult,
        });
      }
    }

    return {
      result: {
        ...lastResult,
        finalContent:
          lastResult.finalContent ??
          `I reached the maximum number of tool call iterations (${maxIterations}).`,
      },
      messages: activeMessages,
    };
  }

  private normalizeMessages(messages: AgentMessage[]): AgentMessage[] {
    return messages.filter(
      (message): message is AgentMessage =>
        typeof message === "object" &&
        message !== null &&
        typeof message.role === "string" &&
        (typeof message.content === "string" || message.content === null),
    );
  }

  private async emitProgressMessage(
    options: AgentExecutionOptions | undefined,
    message: string,
  ): Promise<void> {
    if (typeof options?.onProgressMessage !== "function") {
      return;
    }

    const trimmed = message.trim();

    if (trimmed.length === 0) {
      return;
    }

    if (options.sessionId) {
      const lastMessage = this.lastProgressMessageBySession.get(options.sessionId);

      if (lastMessage === trimmed) {
        return;
      }

      this.lastProgressMessageBySession.set(options.sessionId, trimmed);
    }

    await options.onProgressMessage(trimmed);
  }

  private getSessionStore(): AgentSessionStore {
    const store = this.state[SESSION_STORE_STATE_KEY];

    if (!(store instanceof AgentSessionStore)) {
      throw new Error("Agent session store is not initialized.");
    }

    return store;
  }

  private getSubagentManager(): SubagentManager {
    const manager = this.state[SUBAGENT_MANAGER_STATE_KEY];

    if (!(manager instanceof SubagentManager)) {
      throw new Error("Subagent manager is not initialized.");
    }

    return manager;
  }

  private buildInvocationMetadata(
    options?: AgentExecutionOptions,
  ): Record<string, unknown> | undefined {
    const metadata: Record<string, unknown> = {};

    if (options?.sessionId) {
      metadata.sessionId = options.sessionId;
    }

    if (options?.isolation) {
      metadata.actorType = options.isolation.actorType;
      metadata.subagentDepth = options.isolation.depth;
      metadata.parentSessionId = options.isolation.parentSessionId;
      metadata.subagentSessionId = options.isolation.sessionId;
      metadata.subagentTaskId = options.isolation.taskId;
      metadata.allowedCapabilityIds = [...options.isolation.allowedCapabilityIds];
    }

    return Object.keys(metadata).length > 0 ? metadata : undefined;
  }

  private getCapabilityDenyReason(
    capabilityId: string,
    isolation?: SubagentIsolationContext,
  ): string | null {
    if (!isolation) {
      return null;
    }

    if (!isolation.allowedCapabilityIds.includes(capabilityId)) {
      return `Capability '${capabilityId}' is blocked by subagent policy.`;
    }

    return null;
  }

  private normalizeCapabilityInput(input: unknown): unknown {
    if (typeof input !== "string") {
      return input ?? {};
    }

    const trimmed = input.trim();

    if (trimmed.length === 0) {
      return {};
    }

    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return input;
    }
  }

  private getProviderOptions(): OpenAICompatibleProviderOptions {
    const apiKey = process.env.AGENT_PROVIDER_API_KEY;
    const apiBase = process.env.AGENT_PROVIDER_API_BASE;
    const defaultModel = process.env.AGENT_PROVIDER_DEFAULT_MODEL;
    const rawExtraHeaders = process.env.AGENT_PROVIDER_EXTRA_HEADERS;

    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error(`Missing environment variable: AGENT_PROVIDER_API_KEY`);
    }

    if (!apiBase || apiBase.trim().length === 0) {
      throw new Error(`Missing environment variable: AGENT_PROVIDER_API_BASE`);
    }

    if (!defaultModel || defaultModel.trim().length === 0) {
      throw new Error(`Missing environment variable: AGENT_PROVIDER_DEFAULT_MODEL`);
    }

    return {
      apiKey,
      apiBase,
      defaultModel,
      extraHeaders: this.parseExtraHeaders(rawExtraHeaders),
    };
  }

  private parseExtraHeaders(
    rawExtraHeaders: string | undefined,
  ): Record<string, string> | undefined {
    if (!rawExtraHeaders || rawExtraHeaders.trim().length === 0) {
      return undefined;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(rawExtraHeaders);
    } catch {
      throw new TypeError(
        `AGENT_PROVIDER_EXTRA_HEADERS must be a valid JSON object string.`,
      );
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new TypeError(
        `AGENT_PROVIDER_EXTRA_HEADERS must be a valid JSON object string.`,
      );
    }

    const headers: Record<string, string> = {};

    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "string") {
        throw new TypeError(
          `AGENT_PROVIDER_EXTRA_HEADERS values must all be strings.`,
        );
      }

      headers[key] = value;
    }

    return headers;
  }

  private whatsAppAgentEnabled(): boolean {
    return process.env.WHATSAPP_AGENT_ENABLED === "true";
  }

  private wecomAgentEnabled(): boolean {
    return process.env.WECOM_AGENT_ENABLED === "true";
  }

  private resolveChannelRoute(
    channel: string,
  ): { sessionPrefix: string; replyCapabilityId: string } | null {
    if (channel === "whatsapp" && this.whatsAppAgentEnabled()) {
      return {
        sessionPrefix: "whatsapp",
        replyCapabilityId: "whatsapp.send_message",
      };
    }

    if (channel === "wecom" && this.wecomAgentEnabled()) {
      return {
        sessionPrefix: "wecom",
        replyCapabilityId: "wecom.send_message",
      };
    }

    return null;
  }

  private toChannelMessage(payload: unknown): AgentChannelMessage | null {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return null;
    }

    const record = payload as Record<string, unknown>;
    const channel = record.channel;
    const senderId = record.senderId;
    const chatId = record.chatId;
    const content = record.content;
    const timestamp = record.timestamp;
    const media = record.media;
    const metadata = record.metadata;

    if (
      channel !== "feishu" &&
      channel !== "whatsapp" &&
      channel !== "wecom"
    ) {
      return null;
    }

    if (
      typeof senderId !== "string" ||
      typeof chatId !== "string" ||
      typeof content !== "string" ||
      typeof timestamp !== "string" ||
      !Array.isArray(media) ||
      media.some((item) => typeof item !== "string") ||
      typeof metadata !== "object" ||
      metadata === null ||
      Array.isArray(metadata)
    ) {
      return null;
    }

    return {
      channel,
      senderId,
      chatId,
      content,
      timestamp,
      media: [...media],
      metadata: metadata as Record<string, unknown>,
    };
  }

  private formatChannelInput(payload: AgentChannelMessage): string {
    const parts: string[] = [];

    if (payload.content.trim()) {
      parts.push(payload.content);
    }

    if (payload.media.length > 0) {
      parts.push("Media files:");
      for (const mediaPath of payload.media) {
        parts.push(`- ${mediaPath}`);
      }
    }

    return parts.join("\n").trim();
  }
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
