import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AgentMessage } from "./provider.js";

export class AgentSession {
  public readonly key: string;
  public messages: AgentMessage[];
  public createdAt: Date;
  public updatedAt: Date;
  public lastConsolidated: number;

  constructor(
    key: string,
    options?: {
      messages?: AgentMessage[];
      createdAt?: Date;
      updatedAt?: Date;
      lastConsolidated?: number;
    },
  ) {
    this.key = key;
    this.messages = options?.messages ? [...options.messages] : [];
    this.createdAt = options?.createdAt ?? new Date();
    this.updatedAt = options?.updatedAt ?? new Date();
    this.lastConsolidated = options?.lastConsolidated ?? 0;
  }

  public getHistory(maxMessages = 100): AgentMessage[] {
    const unconsolidated = this.messages.slice(this.lastConsolidated);
    let sliced = unconsolidated.slice(-maxMessages);

    const firstUserIndex = sliced.findIndex((message) => message.role === "user");

    if (firstUserIndex > 0) {
      sliced = sliced.slice(firstUserIndex);
    }

    return sliced.map((message) => ({ ...message }));
  }

  public clear(): void {
    this.messages = [];
    this.lastConsolidated = 0;
    this.updatedAt = new Date();
  }
}

function safeFilename(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function toAgentMessage(data: Record<string, unknown>): AgentMessage | null {
  const role = data.role;
  const content = data.content;

  if (
    role !== "system" &&
    role !== "user" &&
    role !== "assistant" &&
    role !== "tool"
  ) {
    return null;
  }

  if (typeof content !== "string" && content !== null) {
    return null;
  }

  return {
    role,
    content,
    ...(Array.isArray(data.tool_calls) ? { tool_calls: data.tool_calls as Array<Record<string, unknown>> } : {}),
    ...(typeof data.tool_call_id === "string" ? { tool_call_id: data.tool_call_id } : {}),
    ...(typeof data.name === "string" ? { name: data.name } : {}),
    ...(typeof data.reasoning_content === "string" || data.reasoning_content === null
      ? { reasoning_content: data.reasoning_content as string | null }
      : {}),
    ...(Array.isArray(data.thinking_blocks)
      ? { thinking_blocks: data.thinking_blocks as Array<Record<string, unknown>> }
      : {}),
  };
}

export class AgentSessionStore {
  private readonly sessionsDir: string;
  private readonly cache = new Map<string, AgentSession>();
  private readonly initPromise: Promise<void>;

  constructor(private readonly workspace: string) {
    this.sessionsDir = path.join(workspace, ".sessions", "agent");
    this.initPromise = mkdir(this.sessionsDir, { recursive: true }).then(() => undefined);
  }

  public async getOrCreate(key: string): Promise<AgentSession> {
    await this.initPromise;

    const cached = this.cache.get(key);

    if (cached) {
      return cached;
    }

    const loaded = await this.load(key);
    const session = loaded ?? new AgentSession(key);
    this.cache.set(key, session);
    return session;
  }

  public async save(session: AgentSession): Promise<void> {
    await this.initPromise;

    const metadataLine = JSON.stringify({
      _type: "metadata",
      key: session.key,
      created_at: session.createdAt.toISOString(),
      updated_at: session.updatedAt.toISOString(),
      last_consolidated: session.lastConsolidated,
    });

    const lines = [metadataLine, ...session.messages.map((message) => JSON.stringify(message))];
    await writeFile(this.sessionPath(session.key), `${lines.join("\n")}\n`, "utf8");
    this.cache.set(session.key, session);
  }

  public async clear(key: string): Promise<void> {
    const session = await this.getOrCreate(key);
    session.clear();
    await this.save(session);
  }

  public async listKeys(): Promise<string[]> {
    await this.initPromise;
    return [...this.cache.keys()];
  }

  private sessionPath(key: string): string {
    return path.join(this.sessionsDir, `${safeFilename(key)}.jsonl`);
  }

  private async load(key: string): Promise<AgentSession | null> {
    try {
      const raw = await readFile(this.sessionPath(key), "utf8");
      const lines = raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      if (lines.length === 0) {
        return null;
      }

      let createdAt: Date | undefined;
      let updatedAt: Date | undefined;
      let lastConsolidated = 0;
      const messages: AgentMessage[] = [];

      for (const line of lines) {
        const data = JSON.parse(line) as Record<string, unknown>;

        if (data._type === "metadata") {
          createdAt = typeof data.created_at === "string" ? new Date(data.created_at) : undefined;
          updatedAt = typeof data.updated_at === "string" ? new Date(data.updated_at) : undefined;
          lastConsolidated =
            typeof data.last_consolidated === "number" ? data.last_consolidated : 0;
          continue;
        }

        const message = toAgentMessage(data);

        if (message) {
          messages.push(message);
        }
      }

      return new AgentSession(key, {
        messages,
        createdAt,
        updatedAt,
        lastConsolidated,
      });
    } catch {
      return null;
    }
  }
}
