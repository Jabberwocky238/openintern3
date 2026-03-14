import {
  CapabilityProvider,
  type CapabilityDescriptor,
  type CapabilityContext,
  type CapabilityResult,
} from "@openintern/kernel/capability";
import type {
  TerminalCommandOptions,
  TerminalCommandResult,
  TerminalOutputLine,
  TerminalOutputStream,
  TerminalProcessOptions,
  TerminalProcessSummary,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

interface TerminalsPluginLike {
  readonly name: string;
  readonly version: string;
  readonly isInitialized: boolean;
  start(command: string, options?: TerminalProcessOptions): { pid: number; description: string };
  list(): TerminalProcessSummary[];
  tail(pid: number, lines?: number, stream?: TerminalOutputStream): Promise<TerminalOutputLine[]>;
  kill(pid: number): { pid: number; status: "killed" };
  cmd(command: string, options?: TerminalCommandOptions): PromiseLike<TerminalCommandResult>;
}

abstract class TerminalsCapabilityProvider extends CapabilityProvider {
  constructor(
    descriptor: CapabilityDescriptor,
    protected readonly plugin: TerminalsPluginLike,
  ) {
    super(descriptor);
  }

  public override isAvailable(): boolean {
    return this.plugin.isInitialized;
  }
}

export class TerminalStartCapabilityProvider extends TerminalsCapabilityProvider {
  constructor(plugin: TerminalsPluginLike) {
    super(
      {
        id: "terminals.start",
        description: "Start a child process for a shell command and return its pid.",
        pluginName: plugin.name,
        version: plugin.version,
        tags: ["terminals", "process", "start"],
        input: {
          type: "object",
          properties: {
            command: { type: "string" },
            description: { type: "string" },
            cwd: { type: "string" },
            shell: { type: "string" },
            env: {
              type: "object",
              properties: {},
              additionalProperties: true,
            },
          },
          required: ["command"],
          additionalProperties: false,
        },
        output: {
          type: "object",
          properties: {
            pid: { type: "integer" },
            description: { type: "string" },
          },
          required: ["pid", "description"],
          additionalProperties: false,
        },
      },
      plugin,
    );
  }

  public override async invoke(input: unknown, _context?: CapabilityContext): Promise<CapabilityResult> {
    if (!isRecord(input) || typeof input.command !== "string" || !input.command.trim()) {
      return { ok: false, error: "command must be a non-empty string." };
    }

    try {
      return {
        ok: true,
        value: this.plugin.start(input.command, {
          description: typeof input.description === "string" ? input.description : undefined,
          cwd: typeof input.cwd === "string" ? input.cwd : undefined,
          shell: typeof input.shell === "string" ? input.shell : undefined,
          env: toStringRecord(input.env),
        }),
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export class TerminalListCapabilityProvider extends TerminalsCapabilityProvider {
  constructor(plugin: TerminalsPluginLike) {
    super(
      {
        id: "terminals.list",
        description: "List all tracked child processes with description, runtime and status.",
        pluginName: plugin.name,
        version: plugin.version,
        tags: ["terminals", "process", "list"],
        output: {
          type: "array",
          items: {
            type: "object",
            properties: {
              pid: { type: "integer" },
              command: { type: "string" },
              description: { type: "string" },
              cwd: { type: "string" },
              status: { type: "string" },
              startedAt: { type: "string" },
              runtimeMs: { type: "integer" },
              exitCode: { type: "integer" },
              signal: { type: "string" },
            },
            required: ["pid", "command", "description", "cwd", "status", "startedAt", "runtimeMs"],
            additionalProperties: false,
          },
        },
      },
      plugin,
    );
  }

  public override async invoke(_input: unknown, _context?: CapabilityContext): Promise<CapabilityResult> {
    return { ok: true, value: this.plugin.list() };
  }
}

export class TerminalTailCapabilityProvider extends TerminalsCapabilityProvider {
  constructor(plugin: TerminalsPluginLike) {
    super(
      {
        id: "terminals.tail",
        description: "Get the last n output lines of a tracked child process.",
        pluginName: plugin.name,
        version: plugin.version,
        tags: ["terminals", "process", "tail"],
        input: {
          type: "object",
          properties: {
            pid: { type: "integer" },
            lines: { type: "integer" },
            stream: { type: "string", enum: ["stdout", "stderr", "combine"] },
          },
          required: ["pid"],
          additionalProperties: false,
        },
        output: {
          type: "array",
          items: {
            type: "object",
            properties: {
              source: { type: "string", enum: ["stdout", "stderr", "combine"] },
              content: { type: "string" },
            },
            required: ["source", "content"],
            additionalProperties: false,
          },
        },
      },
      plugin,
    );
  }

  public override async invoke(input: unknown, _context?: CapabilityContext): Promise<CapabilityResult> {
    if (!isRecord(input) || !Number.isInteger(input.pid)) {
      return { ok: false, error: "pid must be an integer." };
    }

    const pid = input.pid as number;

    try {
      const stream =
        input.stream === "stdout" || input.stream === "stderr" || input.stream === "combine"
          ? input.stream
          : undefined;
      return {
        ok: true,
        value: this.plugin.tail(
          pid,
          Number.isInteger(input.lines) ? (input.lines as number) : undefined,
          stream,
        ),
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export class TerminalKillCapabilityProvider extends TerminalsCapabilityProvider {
  constructor(plugin: TerminalsPluginLike) {
    super(
      {
        id: "terminals.kill",
        description: "Kill a tracked child process by pid.",
        pluginName: plugin.name,
        version: plugin.version,
        tags: ["terminals", "process", "kill"],
        input: {
          type: "object",
          properties: {
            pid: { type: "integer" },
          },
          required: ["pid"],
          additionalProperties: false,
        },
        output: {
          type: "object",
          properties: {
            pid: { type: "integer" },
            status: { type: "string", enum: ["killed"] },
          },
          required: ["pid", "status"],
          additionalProperties: false,
        },
      },
      plugin,
    );
  }

  public override async invoke(input: unknown, _context?: CapabilityContext): Promise<CapabilityResult> {
    if (!isRecord(input) || !Number.isInteger(input.pid)) {
      return { ok: false, error: "pid must be an integer." };
    }

    const pid = input.pid as number;

    try {
      return { ok: true, value: this.plugin.kill(pid) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export class TerminalExecCapabilityProvider extends TerminalsCapabilityProvider {
  constructor(plugin: TerminalsPluginLike) {
    super(
      {
        id: "terminals.exec",
        description: "Execute a shell command and await the completed stdout/stderr result.",
        pluginName: plugin.name,
        version: plugin.version,
        tags: ["terminals", "command", "exec"],
        input: {
          type: "object",
          properties: {
            command: { type: "string" },
            description: { type: "string" },
            cwd: { type: "string" },
            shell: { type: "string" },
            env: {
              type: "object",
              properties: {},
              additionalProperties: true,
            },
          },
          required: ["command"],
          additionalProperties: false,
        },
        output: {
          type: "object",
          properties: {
            command: { type: "string" },
            cwd: { type: "string" },
            exitCode: { type: "integer" },
            signal: { type: "string" },
            stdout: { type: "string" },
            stderr: { type: "string" },
          },
          required: ["command", "cwd", "stdout", "stderr"],
          additionalProperties: false,
        },
      },
      plugin,
    );
  }

  public override async invoke(input: unknown, _context?: CapabilityContext): Promise<CapabilityResult> {
    if (!isRecord(input) || typeof input.command !== "string" || !input.command.trim()) {
      return { ok: false, error: "command must be a non-empty string." };
    }

    try {
      const result = await this.plugin.cmd(input.command, {
        description: typeof input.description === "string" ? input.description : undefined,
        cwd: typeof input.cwd === "string" ? input.cwd : undefined,
        shell: typeof input.shell === "string" ? input.shell : undefined,
        env: toStringRecord(input.env),
      });
      return { ok: true, value: result };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
