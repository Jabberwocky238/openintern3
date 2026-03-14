import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { inspect } from "node:util";

import type { CapabilityDescriptor } from "./kernel/capability.js";
import type { Plugin } from "./kernel/plugin.js";

type CliMode = "cliDebugger" | "cliAgent";

interface PluginHost {
  readonly plugins: Plugin[];
  getPlugin(name: string): Plugin | undefined;
}

export class CliEngine {
  private mode: CliMode = "cliAgent";
  private readonly agentSessionId = "cli";
  private readonly historyPath = path.join(process.cwd(), ".openintern3", "history");
  private historyEntries: string[] = [];

  public async initHistory(): Promise<void> {
    await mkdir(path.dirname(this.historyPath), { recursive: true });

    try {
      const content = await readFile(this.historyPath, "utf8");
      this.historyEntries = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }

      this.historyEntries = [];
    }
  }

  public getReadlineHistory(): string[] {
    return [...this.historyEntries].reverse();
  }

  public async execute(input: string, host: PluginHost): Promise<string | null> {
    if (input.length === 0) {
      return null;
    }

    await this.appendHistory(input);

    if (input.startsWith("/")) {
      return this.executeCommand(input, host);
    }

    if (this.mode === "cliAgent") {
      return this.executeAgentInput(input, host);
    }

    return "Commands must start with '/'.";
  }

  public getPrompt(): string {
    return this.mode === "cliAgent" ? "agent> " : "debug> ";
  }

  private async appendHistory(input: string): Promise<void> {
    const trimmed = input.trim();

    if (trimmed.length === 0) {
      return;
    }

    await mkdir(path.dirname(this.historyPath), { recursive: true });
    await appendFile(this.historyPath, `${trimmed}\n`, "utf8");
    this.historyEntries.push(trimmed);
  }

  private async executeCommand(input: string, host: PluginHost): Promise<string | null> {
    const tokens = this.tokenize(input);

    if (tokens[0] === "/help") {
      return this.helpText();
    }

    if (tokens[0] === "/debug") {
      return this.switchMode("cliDebugger");
    }

    if (tokens[0] === "/agent" && tokens.length === 1) {
      return this.switchMode("cliAgent");
    }

    if (tokens[0] === "/mode") {
      return this.switchMode(tokens[1]);
    }

    if (
      (tokens[0] === "/agent" && tokens[1] === "reset") ||
      tokens[0] === "/reset"
    ) {
      const agentPlugin = host.getPlugin("agent");

      if (!agentPlugin) {
        return "Plugin not found: agent";
      }

      const callable = (agentPlugin as unknown as Record<string, unknown>).resetSession;

      if (typeof callable !== "function") {
        return "Method is not callable: agent.resetSession";
      }

      await Reflect.apply(
        callable as (...args: unknown[]) => unknown,
        agentPlugin,
        [this.agentSessionId],
      );
      return "Agent session reset.";
    }

    if (tokens[0] !== "/plugin") {
      return `Unknown command: ${input}`;
    }

    if (tokens[1] === "list") {
      return this.formatPluginList(host.plugins);
    }

    if (tokens[1] === "get" && tokens[2]) {
      return this.formatPlugin(host.getPlugin(tokens[2]), tokens[2]);
    }

    if (tokens.length < 3) {
      return "Usage: /plugin list | /plugin get <name> | /plugin <name> <method> <...args>";
    }

    const plugin = host.getPlugin(tokens[1]);

    if (!plugin) {
      return `Plugin not found: ${tokens[1]}`;
    }

    const methodName = tokens[2];
    const callable = (plugin as unknown as Record<string, unknown>)[methodName];

    if (typeof callable !== "function") {
      return `Method is not callable: ${plugin.name}.${methodName}`;
    }

    let result: unknown;

    try {
      result = await Reflect.apply(
        callable as (...args: unknown[]) => unknown,
        plugin,
        tokens.slice(3).map((token) => this.parseArg(token)),
      );
    } catch (error) {
      if (error instanceof Error) {
        return `${error.name}: ${error.message}`;
      }

      return String(error);
    }

    return this.formatResult(result);
  }

  private async executeAgentInput(input: string, host: PluginHost): Promise<string> {
    const agentPlugin = host.getPlugin("agent");

    if (!agentPlugin) {
      return "Plugin not found: agent";
    }

    const callable = (agentPlugin as unknown as Record<string, unknown>).runSession;

    if (typeof callable !== "function") {
      return "Method is not callable: agent.runSession";
    }

    let result: unknown;
    const progressMessages: string[] = [];

    try {
      result = await Reflect.apply(
        callable as (...args: unknown[]) => unknown,
        agentPlugin,
        [
          this.agentSessionId,
          input,
          undefined,
          undefined,
          async (message: string) => {
            const trimmed = message.trim();

            if (trimmed.length > 0) {
              progressMessages.push(trimmed);
            }
          },
        ],
      );
    } catch (error) {
      if (error instanceof Error) {
        return `${error.name}: ${error.message}`;
      }

      return String(error);
    }

    if (progressMessages.length > 0) {
      return progressMessages.join("\n\n");
    }

    const finalContent = this.extractAgentFinalContent(result);
    return finalContent ?? this.formatResult(result);
  }

  private switchMode(nextMode: string | undefined): string {
    if (nextMode !== "cliDebugger" && nextMode !== "cliAgent") {
      return "Usage: /mode cliDebugger | cliAgent";
    }

    this.mode = nextMode;

    if (nextMode === "cliDebugger") {
      return "Switched to cliDebugger.";
    }

    return "Switched to cliAgent.";
  }

  private helpText(): string {
    if (this.mode === "cliAgent") {
      return [
        "cliAgent mode",
        "Type any message to chat with the agent.",
        "/reset - reset current agent session",
        "/debug - switch to cliDebugger",
        "/plugin ... - run debugger commands without leaving agent mode",
      ].join("\n");
    }

    return [
      "cliDebugger mode",
      "/plugin list",
      "/plugin get <name>",
      "/plugin <name> <method> <...args>",
      "/agent - switch to cliAgent",
      "/reset - reset current agent session",
    ].join("\n");
  }

  private extractAgentFinalContent(result: unknown): string | null {
    if (typeof result !== "object" || result === null) {
      return null;
    }

    const finalContent = (result as { finalContent?: unknown }).finalContent;

    return typeof finalContent === "string" ? finalContent : null;
  }

  private tokenize(input: string): string[] {
    const matches = input.match(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|\S+/g) ?? [];

    return matches.map((token) => {
      if (
        (token.startsWith('"') && token.endsWith('"')) ||
        (token.startsWith("'") && token.endsWith("'"))
      ) {
        return token.slice(1, -1);
      }

      return token;
    });
  }

  private parseArg(value: string | undefined): unknown {
    if (value === undefined) {
      return undefined;
    }

    if (value === "true") {
      return true;
    }

    if (value === "false") {
      return false;
    }

    if (value === "null") {
      return null;
    }

    if (/^-?\d+(\.\d+)?$/.test(value)) {
      return Number(value);
    }

    return value;
  }

  private formatPluginList(plugins: Plugin[]): string {
    if (plugins.length === 0) {
      return "No plugins loaded.";
    }

    return plugins.map((plugin) => `${plugin.name}@${plugin.version}`).join("\n");
  }

  private formatPlugin(plugin: Plugin | undefined, name: string): string {
    if (!plugin) {
      return `Plugin not found: ${name}`;
    }

    return JSON.stringify(
      {
        name: plugin.name,
        version: plugin.version,
        namespaces: plugin.namespaces,
        capabilities: plugin
          .capabilities()
          .map((capability: { descriptor: CapabilityDescriptor }) => ({
            id: capability.descriptor.id,
            description: capability.descriptor.description,
            tags: capability.descriptor.tags ?? [],
          })),
      },
      null,
      2,
    );
  }

  private formatResult(result: unknown): string {
    if (result === undefined) {
      return "OK";
    }

    if (typeof result === "string") {
      return result;
    }

    return inspect(result, {
      depth: 4,
      colors: false,
    });
  }
}
