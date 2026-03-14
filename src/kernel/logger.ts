export interface Logger {
  log(message?: unknown, ...args: unknown[]): void;
  info(message?: unknown, ...args: unknown[]): void;
  warn(message?: unknown, ...args: unknown[]): void;
  error(message?: unknown, ...args: unknown[]): void;
  debug(message?: unknown, ...args: unknown[]): void;
  child(scope: { pluginName: string; pluginVersion: string }): Logger;
}

interface LoggerScope {
  pluginName?: string;
  pluginVersion?: string;
}

export class ConsoleLogger implements Logger {
  constructor(private readonly scope: LoggerScope = {}) {}

  public log(message?: unknown, ...args: unknown[]): void {
    console.log(this.formatPrefix(), message, ...args);
  }

  public info(message?: unknown, ...args: unknown[]): void {
    console.info(this.formatPrefix(), message, ...args);
  }

  public warn(message?: unknown, ...args: unknown[]): void {
    console.warn(this.formatPrefix(), message, ...args);
  }

  public error(message?: unknown, ...args: unknown[]): void {
    console.error(this.formatPrefix(), message, ...args);
  }

  public debug(message?: unknown, ...args: unknown[]): void {
    console.debug(this.formatPrefix(), message, ...args);
  }

  public child(scope: { pluginName: string; pluginVersion: string }): Logger {
    return new ConsoleLogger(scope);
  }

  private formatPrefix(): string {
    const timestamp = new Date().toISOString();

    if (!this.scope.pluginName || !this.scope.pluginVersion) {
      return `[${timestamp}]`;
    }

    return `[${timestamp}] [${this.scope.pluginName}@${this.scope.pluginVersion}]`;
  }
}
