import type { ChildProcessWithoutNullStreams } from "node:child_process";

export interface TerminalCommandChunk {
  source: "stdout" | "stderr";
  content: string;
}

export interface TerminalProcessOptions {
  cwd?: string;
  env?: Record<string, string>;
  shell?: string;
  signal?: AbortSignal;
  description?: string;
  onChunk?: (chunk: TerminalCommandChunk) => void | Promise<void>;
}

export interface TerminalCommandOptions extends TerminalProcessOptions {}

export interface TerminalCommandResult {
  command: string;
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface TerminalProcessSummary {
  pid: number;
  command: string;
  description: string;
  cwd: string;
  status: "running" | "exited" | "failed" | "killed";
  startedAt: string;
  runtimeMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export interface TerminalOutputLine {
  source: "stdout" | "stderr" | "combine";
  content: string;
}

export type TerminalOutputStream = "stdout" | "stderr" | "combine";

export interface ManagedTerminalProcess {
  pid: number;
  command: string;
  description: string;
  cwd: string;
  child: ChildProcessWithoutNullStreams;
  startedAt: Date;
  status: "running" | "exited" | "failed" | "killed";
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  outputDir: string;
  stdoutPath: string;
  stderrPath: string;
  combinedPath: string;
  onChunk?: (chunk: TerminalCommandChunk) => void | Promise<void>;
  completion: Promise<TerminalCommandResult>;
}
