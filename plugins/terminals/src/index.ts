import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  Plugin,
} from "@openintern/kernel";

interface TerminalRecord {
  id: string;
  handle: ChildProcessWithoutNullStreams;
}

interface TerminalSession extends TerminalRecord {
  pending: Promise<void>;
}

export default class TerminalsPlugin extends Plugin {
  constructor() {
    super({
      name: "terminals",
      version: "0.0.0",
      namespaces: ["terminals"],
    });
  }

  public override async init(): Promise<void> {
    this.state.terminals = new Map<string, TerminalSession>();
  }

  public openTerminal(): TerminalRecord {
    const shell = process.platform === "win32" ? "powershell.exe" : "bash";
    const handle = spawn(shell, [], {
      stdio: "pipe",
    });
    const id = crypto.randomUUID();
    const terminals = this.getTerminalState();

    terminals.set(id, {
      id,
      handle,
      pending: Promise.resolve(),
    });

    return { id, handle };
  }

  public closeTerminal(id: string): void {
    const terminals = this.getTerminalState();
    const terminal = terminals.get(id);

    if (!terminal) {
      throw new Error(`Terminal not found: ${id}`);
    }

    terminal.handle.kill();
    terminals.delete(id);
  }

  public async write(id: string, str: string): Promise<string> {
    const terminal = this.getTerminalById(id);
    return this.enqueueWrite(terminal, str, false);
  }

  public async writeFlush(id: string, str: string): Promise<string> {
    const terminal = this.getTerminalById(id);
    return this.enqueueWrite(terminal, str, true);
  }

  public listTerminals(): TerminalRecord[] {
    return [...this.getTerminalState().values()].map(({ id, handle }) => ({
      id,
      handle,
    }));
  }
  private getTerminalState(): Map<string, TerminalSession> {
    const terminals = this.state.terminals;

    if (!(terminals instanceof Map)) {
      throw new Error("Terminal state is not initialized.");
    }

    return terminals as Map<string, TerminalSession>;
  }

  private getTerminalById(id: string): TerminalSession {
    const terminal = this.getTerminalState().get(id);

    if (!terminal) {
      throw new Error(`Terminal not found: ${id}`);
    }

    return terminal;
  }

  private async enqueueWrite(
    terminal: TerminalSession,
    str: string,
    flush: boolean,
  ): Promise<string> {
    const run = async () => this.performWrite(terminal.handle, str, flush);
    const result = terminal.pending.then(run, run);

    terminal.pending = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }

  private async performWrite(
    handle: ChildProcessWithoutNullStreams,
    str: string,
    flush: boolean,
  ): Promise<string> {
    const output = await this.captureOutput(handle, async () => {
      const canContinue = handle.stdin.write(str);

      if (flush && !canContinue) {
        await new Promise<void>((resolve, reject) => {
          handle.stdin.once("drain", resolve);
          handle.stdin.once("error", reject);
        });
      }
    });

    return output;
  }

  private async captureOutput(
    handle: ChildProcessWithoutNullStreams,
    action: () => Promise<void>,
  ): Promise<string> {
    const chunks: string[] = [];
    let resolveIdle: (() => void) | undefined;
    let rejectIdle: ((error: Error) => void) | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const resetIdleTimer = (): void => {
      if (idleTimer) {
        clearTimeout(idleTimer);
      }

      idleTimer = setTimeout(() => {
        cleanup();
        resolveIdle?.();
      }, 100);
    };

    const onData = (chunk: Buffer): void => {
      chunks.push(chunk.toString());
      resetIdleTimer();
    };

    const onError = (error: Error): void => {
      cleanup();
      rejectIdle?.(error);
    };

    const onExit = (): void => {
      cleanup();
      resolveIdle?.();
    };

    const cleanup = (): void => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }

      handle.stdout.off("data", onData);
      handle.stderr.off("data", onData);
      handle.off("error", onError);
      handle.off("exit", onExit);
    };

    handle.stdout.on("data", onData);
    handle.stderr.on("data", onData);
    handle.on("error", onError);
    handle.on("exit", onExit);

    const idle = new Promise<void>((resolve, reject) => {
      resolveIdle = resolve;
      rejectIdle = reject;
    });

    await action();
    resetIdleTimer();
    await idle;

    return chunks.join("");
  }
}
