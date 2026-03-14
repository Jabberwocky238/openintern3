import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { AsyncChunkQueue } from "./async-queue.js";
import type { TerminalCommandChunk, TerminalCommandResult } from "./types.js";

export class TerminalCommandExecution
  implements PromiseLike<TerminalCommandResult>, AsyncIterable<TerminalCommandChunk>
{
  private readonly queue = new AsyncChunkQueue<TerminalCommandChunk>();

  constructor(
    public readonly pid: number,
    public readonly child: ChildProcessWithoutNullStreams,
    public readonly completed: Promise<TerminalCommandResult>,
  ) {
    void completed.then(
      () => this.queue.finish(),
      (error) => this.queue.fail(error),
    );
  }

  public push(chunk: TerminalCommandChunk): void {
    this.queue.push(chunk);
  }

  public then<TResult1 = TerminalCommandResult, TResult2 = never>(
    onfulfilled?:
      | ((value: TerminalCommandResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.completed.then(onfulfilled, onrejected);
  }

  public [Symbol.asyncIterator](): AsyncIterator<TerminalCommandChunk> {
    return this.queue[Symbol.asyncIterator]();
  }
}
