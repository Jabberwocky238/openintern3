import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { CapabilityProvider, Plugin } from "@openintern/kernel";
import {
  TerminalExecCapabilityProvider,
  TerminalKillCapabilityProvider,
  TerminalListCapabilityProvider,
  TerminalStartCapabilityProvider,
  TerminalTailCapabilityProvider,
} from "./capabilities.js";
import { TerminalCommandExecution } from "./execution.js";
import type {
  ManagedTerminalProcess,
  TerminalCommandChunk,
  TerminalCommandOptions,
  TerminalCommandResult,
  TerminalOutputLine,
  TerminalOutputStream,
  TerminalProcessOptions,
  TerminalProcessSummary,
} from "./types.js";

export type {
  ManagedTerminalProcess,
  TerminalCommandChunk,
  TerminalCommandOptions,
  TerminalCommandResult,
  TerminalOutputLine,
  TerminalOutputStream,
  TerminalProcessOptions,
  TerminalProcessSummary,
} from "./types.js";
export { TerminalCommandExecution } from "./execution.js";

export default class TerminalsPlugin extends Plugin {
  constructor() {
    super({
      name: "terminals",
      version: "0.0.0",
      namespaces: ["terminals"],
    });
  }

  public override async init(): Promise<void> {
    this.state.processes = new Map<number, ManagedTerminalProcess>();
    this.state.outputBaseDir = path.join(process.cwd(), "terminals", "output");
    await mkdir(this.outputBaseDir(), { recursive: true });
  }

  public override capabilities(): CapabilityProvider[] {
    return [
      new TerminalStartCapabilityProvider(this),
      new TerminalListCapabilityProvider(this),
      new TerminalTailCapabilityProvider(this),
      new TerminalKillCapabilityProvider(this),
      new TerminalExecCapabilityProvider(this),
    ];
  }

  public start(command: string, options: TerminalProcessOptions = {}): {
    pid: number;
    description: string;
  } {
    if (typeof command !== "string" || command.trim().length === 0) {
      throw new TypeError("command must be a non-empty string.");
    }

    const cwd = this.resolveCwd(options.cwd);
    const shell = this.resolveShell(options.shell);
    const child = spawn(shell.command, shell.args(command), {
      cwd,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: "pipe",
      signal: options.signal,
      windowsHide: true,
    } satisfies SpawnOptionsWithoutStdio);
    const pid = child.pid;

    if (!pid) {
      throw new Error("Failed to start child process.");
    }

    const processRecord = this.createManagedProcess(pid, command, cwd, child, options);
    this.getProcessState().set(pid, processRecord);

    return {
      pid,
      description: processRecord.description,
    };
  }

  public list(): TerminalProcessSummary[] {
    return [...this.getProcessState().values()]
      .map((processRecord) => this.toSummary(processRecord))
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  public async tail(
    pid: number,
    lines = 20,
    stream: TerminalOutputStream = "combine",
  ): Promise<TerminalOutputLine[]> {
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new TypeError("pid must be a positive integer.");
    }

    if (!Number.isInteger(lines) || lines <= 0) {
      throw new TypeError("lines must be a positive integer.");
    }

    const processRecord = this.getProcessByPid(pid);
    return this.readTail(processRecord, lines, stream);
  }

  public kill(pid: number): {
    pid: number;
    status: "killed";
  } {
    const processRecord = this.getProcessByPid(pid);

    if (processRecord.status === "running") {
      processRecord.status = "killed";
      processRecord.child.kill();
    }

    return {
      pid,
      status: "killed",
    };
  }

  public cmd(command: string, options: TerminalCommandOptions = {}): TerminalCommandExecution {
    const started = this.start(command, options);
    const processRecord = this.getProcessByPid(started.pid);
    const execution = new TerminalCommandExecution(
      started.pid,
      processRecord.child,
      processRecord.completion,
    );
    const previousOnChunk = processRecord.onChunk;

    processRecord.onChunk = async (chunk: TerminalCommandChunk) => {
      execution.push(chunk);

      if (previousOnChunk) {
        await previousOnChunk(chunk);
      }
    };

    return execution;
  }

  private createManagedProcess(
    pid: number,
    command: string,
    cwd: string,
    child: ChildProcessWithoutNullStreams,
    options: TerminalProcessOptions,
  ): ManagedTerminalProcess {
    const outputDir = this.outputDirForPid(pid);
    mkdirSync(outputDir, { recursive: true });
    const stdoutPath = path.join(outputDir, "stdout");
    const stderrPath = path.join(outputDir, "stderr");
    const combinedPath = path.join(outputDir, "combine");
    writeFileSync(stdoutPath, "", "utf8");
    writeFileSync(stderrPath, "", "utf8");
    writeFileSync(combinedPath, "", "utf8");

    const processRecord: ManagedTerminalProcess = {
      pid,
      command,
      description: options.description?.trim() || command,
      cwd,
      child,
      startedAt: new Date(),
      status: "running",
      exitCode: null,
      signal: null,
      outputDir,
      stdoutPath,
      stderrPath,
      combinedPath,
      onChunk: options.onChunk,
      completion: Promise.resolve({
        command,
        cwd,
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: "",
      }),
    };

    processRecord.completion = new Promise<TerminalCommandResult>((resolve, reject) => {
      const stdoutStream = createWriteStream(processRecord.stdoutPath, { flags: "a" });
      const stderrStream = createWriteStream(processRecord.stderrPath, { flags: "a" });
      const combinedStream = createWriteStream(processRecord.combinedPath, { flags: "a" });

      const onStdout = (chunk: Buffer): void => {
        const content = chunk.toString();
        this.recordOutput(processRecord, stdoutStream, combinedStream, "stdout", content);
      };

      const onStderr = (chunk: Buffer): void => {
        const content = chunk.toString();
        this.recordOutput(processRecord, stderrStream, combinedStream, "stderr", content);
      };

      const cleanup = (): void => {
        child.stdout.off("data", onStdout);
        child.stderr.off("data", onStderr);
        child.off("error", onError);
        child.off("close", onClose);
      };

      const onError = (error: Error): void => {
        processRecord.status = processRecord.status === "killed" ? "killed" : "failed";
        cleanup();
        this.closeOutputStreams(stdoutStream, stderrStream, combinedStream).then(
          () => reject(error),
          () => reject(error),
        );
      };

      const onClose = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
        processRecord.exitCode = exitCode;
        processRecord.signal = signal;

        if (processRecord.status !== "killed") {
          processRecord.status = exitCode === 0 ? "exited" : "failed";
        }

        cleanup();
        void this.closeOutputStreams(stdoutStream, stderrStream, combinedStream).then(() =>
          this.readCommandResult(processRecord).then((result) => {
            resolve({
              command,
              cwd,
              exitCode,
              signal,
              stdout: result.stdout,
              stderr: result.stderr,
            });
          }, reject),
        );
      };

      child.stdout.on("data", onStdout);
      child.stderr.on("data", onStderr);
      child.on("error", onError);
      child.on("close", onClose);
    });

    return processRecord;
  }

  private recordOutput(
    processRecord: ManagedTerminalProcess,
    stream: ReturnType<typeof createWriteStream>,
    combinedStream: ReturnType<typeof createWriteStream>,
    source: "stdout" | "stderr",
    chunk: string,
  ): void {
    stream.write(chunk);
    combinedStream.write(chunk);
    if (processRecord.onChunk) {
      void processRecord.onChunk({
        source,
        content: chunk,
      });
    }
  }

  private getProcessState(): Map<number, ManagedTerminalProcess> {
    const processes = this.state.processes;

    if (!(processes instanceof Map)) {
      throw new Error("Terminal process state is not initialized.");
    }

    return processes as Map<number, ManagedTerminalProcess>;
  }

  private getProcessByPid(pid: number): ManagedTerminalProcess {
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new TypeError("pid must be a positive integer.");
    }

    const processRecord = this.getProcessState().get(pid);

    if (!processRecord) {
      throw new Error(`Process not found: ${pid}`);
    }

    return processRecord;
  }

  private toSummary(processRecord: ManagedTerminalProcess): TerminalProcessSummary {
    return {
      pid: processRecord.pid,
      command: processRecord.command,
      description: processRecord.description,
      cwd: processRecord.cwd,
      status: processRecord.status,
      startedAt: processRecord.startedAt.toISOString(),
      runtimeMs: Date.now() - processRecord.startedAt.getTime(),
      exitCode: processRecord.exitCode,
      signal: processRecord.signal,
    };
  }

  private resolveCwd(rawCwd?: string): string {
    if (!rawCwd || rawCwd.trim().length === 0) {
      return process.cwd();
    }

    return path.isAbsolute(rawCwd)
      ? rawCwd
      : path.resolve(process.cwd(), rawCwd);
  }

  private resolveShell(rawShell?: string): {
    command: string;
    args: (command: string) => string[];
  } {
    const shell = rawShell?.trim();

    if (shell) {
      return {
        command: shell,
        args: (command) => ["-lc", command],
      };
    }

    if (process.platform === "win32") {
      return {
        command: "powershell.exe",
        args: (command) => ["-NoProfile", "-Command", command],
      };
    }

    return {
      command: "bash",
      args: (command) => ["-lc", command],
    };
  }

  private outputBaseDir(): string {
    const outputBaseDir = this.state.outputBaseDir;

    if (typeof outputBaseDir !== "string" || outputBaseDir.length === 0) {
      throw new Error("Terminal output base dir is not initialized.");
    }

    return outputBaseDir;
  }

  private outputDirForPid(pid: number): string {
    return path.join(this.outputBaseDir(), String(pid));
  }

  private async readCommandResult(
    processRecord: ManagedTerminalProcess,
  ): Promise<{ stdout: string; stderr: string }> {
    const [stdout, stderr] = await Promise.all([
      this.readOutputFile(processRecord.stdoutPath),
      this.readOutputFile(processRecord.stderrPath),
    ]);

    return { stdout, stderr };
  }

  private async readTail(
    processRecord: ManagedTerminalProcess,
    lines: number,
    stream: TerminalOutputStream,
  ): Promise<TerminalOutputLine[]> {
    const content = await this.readOutputFile(
      this.outputPathForStream(processRecord, stream),
    );
    return this.toOutputLines(stream, content).slice(-lines);
  }

  private async readOutputFile(filePath: string): Promise<string> {
    try {
      return await readFile(filePath, "utf8");
    } catch {
      return "";
    }
  }

  private async closeOutputStreams(
    stdoutStream: ReturnType<typeof createWriteStream>,
    stderrStream: ReturnType<typeof createWriteStream>,
    combinedStream: ReturnType<typeof createWriteStream>,
  ): Promise<void> {
    await Promise.all([
      new Promise<void>((resolve) => stdoutStream.end(resolve)),
      new Promise<void>((resolve) => stderrStream.end(resolve)),
      new Promise<void>((resolve) => combinedStream.end(resolve)),
    ]);
  }

  private toOutputLines(
    source: TerminalOutputStream,
    content: string,
  ): TerminalOutputLine[] {
    return content
      .split(/\r?\n/)
      .filter((line, index, list) => line.length > 0 || index < list.length - 1)
      .map((line) => ({
        source,
        content: line,
      }));
  }

  private outputPathForStream(
    processRecord: ManagedTerminalProcess,
    stream: TerminalOutputStream,
  ): string {
    if (stream === "stdout") {
      return processRecord.stdoutPath;
    }

    if (stream === "stderr") {
      return processRecord.stderrPath;
    }

    return processRecord.combinedPath;
  }

}
