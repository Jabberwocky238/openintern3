import {
  CapabilityProvider,
  type CapabilityDescriptor,
  type CapabilityContext,
  type CapabilityResult,
} from "@openintern/kernel/capability";
import type { AgentSessionStore } from "./session-store.js";

export const DEFAULT_SUBAGENT_ALLOWED_CAPABILITIES = [
  "echo.ping",
  "cron.list",
  "filesystem.read_file",
  "filesystem.list_dir",
  "filesystem.inspect_file",
  "feishu.status",
  "feishu.pull_messages",
  "whatsapp.status",
  "whatsapp.pull_messages",
] as const;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class SubagentManager {
  private readonly tasks = new Map<string, SubagentTaskRecord>();
  private readonly policy: SubagentExecutionPolicy;

  constructor(
    private readonly plugin: SubagentPluginLike,
    policy?: Partial<SubagentExecutionPolicy>,
  ) {
    this.policy = {
      allowedCapabilityIds: [...(policy?.allowedCapabilityIds ?? DEFAULT_SUBAGENT_ALLOWED_CAPABILITIES)],
      maxDepth: policy?.maxDepth ?? 1,
    };
  }

  public getPolicy(): SubagentExecutionPolicy {
    return {
      allowedCapabilityIds: [...this.policy.allowedCapabilityIds],
      maxDepth: this.policy.maxDepth,
    };
  }

  public list(): SubagentTaskRecord[] {
    return [...this.tasks.values()].map((task) => ({ ...task }));
  }

  public get(taskId: string): SubagentTaskRecord | null {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : null;
  }

  public async spawn(request: SubagentSpawnRequest): Promise<SubagentTaskRecord> {
    const task = request.task.trim();
    const parentSessionId = request.sessionId?.trim();

    if (!task) {
      throw new TypeError("task must be a non-empty string.");
    }

    if (!parentSessionId) {
      throw new TypeError("sessionId is required for subagent spawn.");
    }

    const parentDepth = this.resolveDepth(request.sessionId);

    if (parentDepth >= this.policy.maxDepth) {
      throw new Error(
        `Subagent depth limit reached (${this.policy.maxDepth}). Nested subagent spawn is not allowed.`,
      );
    }

    const taskId = crypto.randomUUID();
    const sessionId = `subagent:${parentSessionId}:${taskId}`;
    const record: SubagentTaskRecord = {
      id: taskId,
      parentSessionId,
      sessionId,
      task,
      role: request.role?.trim() || undefined,
      status: "queued",
      createdAt: new Date().toISOString(),
    };

    this.tasks.set(taskId, record);
    void this.runTask(record, request.callbackSummary !== false);

    return { ...record };
  }

  private async runTask(
    record: SubagentTaskRecord,
    callbackSummary: boolean,
  ): Promise<void> {
    record.status = "running";
    record.startedAt = new Date().toISOString();

    try {
      const result = await this.plugin.runSubagentSession(
        record.sessionId,
        record.task,
        {
          actorType: "subagent",
          depth: this.resolveDepth(record.sessionId),
          parentSessionId: record.parentSessionId,
          sessionId: record.sessionId,
          taskId: record.id,
          allowedCapabilityIds: [...this.policy.allowedCapabilityIds],
        },
        record.role,
      );

      record.status = "completed";
      record.finishedAt = new Date().toISOString();
      record.result = result.finalContent;

      if (callbackSummary) {
        await this.writeSystemCallback(record);
      }
    } catch (error) {
      record.status = "failed";
      record.finishedAt = new Date().toISOString();
      record.error = error instanceof Error ? error.message : String(error);
      await this.writeSystemCallback(record);
    }
  }

  private async writeSystemCallback(record: SubagentTaskRecord): Promise<void> {
    const store = this.plugin.getSessionStoreForSubagent();
    const session = await store.getOrCreate(record.parentSessionId);
    const content =
      record.status === "completed"
        ? [
            `Subagent task completed.`,
            `task_id: ${record.id}`,
            `task: ${record.task}`,
            `result: ${(record.result ?? "No result").trim() || "No result"}`,
          ].join("\n")
        : [
            `Subagent task failed.`,
            `task_id: ${record.id}`,
            `task: ${record.task}`,
            `error: ${record.error ?? "Unknown error"}`,
          ].join("\n");

    session.messages.push({
      role: "system",
      content,
    });
    session.updatedAt = new Date();
    await store.save(session);
  }

  private resolveDepth(sessionId?: string): number {
    if (!sessionId) {
      return 0;
    }

    const matches = sessionId.match(/subagent:/g);
    return matches ? matches.length : 0;
  }
}

abstract class AgentSubagentCapabilityProvider extends CapabilityProvider {
  constructor(
    descriptor: CapabilityDescriptor,
    protected readonly plugin: SubagentPluginLike,
  ) {
    super(descriptor);
  }

  public override isAvailable(): boolean {
    return this.plugin.isInitialized;
  }
}

export class AgentSpawnCapabilityProvider extends AgentSubagentCapabilityProvider {
  constructor(
    plugin: SubagentPluginLike,
    private readonly manager: SubagentManager,
  ) {
    super(
      {
        id: "agent.spawn",
        description: "Spawn a background subagent for a delegated task and callback into the parent session when it finishes.",
        pluginName: plugin.name,
        version: plugin.version,
        tags: ["agent", "subagent", "spawn"],
        input: {
          type: "object",
          properties: {
            task: {
              type: "string",
              description: "Task for the background subagent.",
            },
            role: {
              type: "string",
              description: "Optional role hint for the subagent.",
            },
          },
          required: ["task"],
          additionalProperties: false,
        },
        output: {
          type: "object",
          properties: {
            taskId: { type: "string" },
            sessionId: { type: "string" },
            parentSessionId: { type: "string" },
            status: {
              type: "string",
              enum: ["queued", "running", "completed", "failed"],
            },
            allowedCapabilities: {
              type: "array",
              items: {
                type: "string",
              },
            },
          },
          required: ["taskId", "sessionId", "parentSessionId", "status", "allowedCapabilities"],
          additionalProperties: false,
        },
      },
      plugin,
    );
  }

  public override async invoke(
    input: unknown,
    context?: CapabilityContext,
  ): Promise<CapabilityResult> {
    if (!isRecord(input) || typeof input.task !== "string" || input.task.trim().length === 0) {
      return {
        ok: false,
        error: "task must be a non-empty string.",
      };
    }

    const sessionId = this.resolveSessionId(context);

    if (!sessionId) {
      return {
        ok: false,
        error: "agent.spawn requires a sessionId in invocation context.",
      };
    }

    try {
      const record = await this.manager.spawn({
        task: input.task,
        role: typeof input.role === "string" ? input.role : undefined,
        sessionId,
        callbackSummary: true,
      });

      return {
        ok: true,
        value: {
          taskId: record.id,
          sessionId: record.sessionId,
          parentSessionId: record.parentSessionId,
          status: record.status,
          allowedCapabilities: this.manager.getPolicy().allowedCapabilityIds,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private resolveSessionId(context?: CapabilityContext): string | null {
    const metadata = context?.metadata;

    if (!metadata || typeof metadata.sessionId !== "string") {
      return null;
    }

    const sessionId = metadata.sessionId.trim();
    return sessionId.length > 0 ? sessionId : null;
  }
}
