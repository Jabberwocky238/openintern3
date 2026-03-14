export class AsyncChunkQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<{
    resolve: (value: IteratorResult<T>) => void;
    reject: (error?: unknown) => void;
  }> = [];
  private done = false;
  private error: unknown;

  public push(item: T): void {
    if (this.done) {
      return;
    }

    const waiter = this.waiters.shift();

    if (waiter) {
      waiter.resolve({ done: false, value: item });
      return;
    }

    this.items.push(item);
  }

  public finish(): void {
    if (this.done) {
      return;
    }

    this.done = true;

    while (this.waiters.length > 0) {
      this.waiters.shift()?.resolve({ done: true, value: undefined });
    }
  }

  public fail(error: unknown): void {
    if (this.done) {
      return;
    }

    this.done = true;
    this.error = error;

    while (this.waiters.length > 0) {
      this.waiters.shift()?.reject(error);
    }
  }

  public [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length > 0) {
          const value = this.items.shift() as T;
          return Promise.resolve({ done: false, value });
        }

        if (this.error !== undefined) {
          return Promise.reject(this.error);
        }

        if (this.done) {
          return Promise.resolve({ done: true, value: undefined });
        }

        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.waiters.push({ resolve, reject });
        });
      },
    };
  }
}
