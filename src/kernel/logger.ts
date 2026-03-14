export interface Logger {
  log(message?: unknown, ...args: unknown[]): void;
  info(message?: unknown, ...args: unknown[]): void;
  warn(message?: unknown, ...args: unknown[]): void;
  error(message?: unknown, ...args: unknown[]): void;
  debug(message?: unknown, ...args: unknown[]): void;
  child(scope: { pluginName: string; pluginVersion: string }): Logger;
}

export type LoggerLevel = "debug" | "info" | "warn" | "error";

interface LoggerScope {
  pluginName?: string;
  pluginVersion?: string;
}

export class ConsoleLogger implements Logger {
  constructor(
    private readonly scope: LoggerScope = {},
    private readonly level: LoggerLevel = "info",
  ) {}

  public log(message?: unknown, ...args: unknown[]): void {
    if (!this.shouldLog("info")) {
      return;
    }
    console.log(this.formatPrefix(), message, ...args);
  }

  public info(message?: unknown, ...args: unknown[]): void {
    if (!this.shouldLog("info")) {
      return;
    }
    console.info(this.formatPrefix(), message, ...args);
  }

  public warn(message?: unknown, ...args: unknown[]): void {
    if (!this.shouldLog("warn")) {
      return;
    }
    console.warn(this.formatPrefix(), message, ...args);
  }

  public error(message?: unknown, ...args: unknown[]): void {
    if (!this.shouldLog("error")) {
      return;
    }
    console.error(this.formatPrefix(), message, ...args);
  }

  public debug(message?: unknown, ...args: unknown[]): void {
    if (!this.shouldLog("debug")) {
      return;
    }
    console.debug(this.formatPrefix(), message, ...args);
  }

  public child(scope: { pluginName: string; pluginVersion: string }): Logger {
    return new ConsoleLogger(scope, this.level);
  }

  private formatPrefix(): string {
    const timestamp = new Date().toISOString();

    if (!this.scope.pluginName || !this.scope.pluginVersion) {
      return `[${timestamp}]`;
    }

    return `[${timestamp}] [${this.scope.pluginName}@${this.scope.pluginVersion}]`;
  }

  private shouldLog(level: LoggerLevel): boolean {
    const priorities: Record<LoggerLevel, number> = {
      debug: 10,
      info: 20,
      warn: 30,
      error: 40,
    };

    return priorities[level] >= priorities[this.level];
  }
}
