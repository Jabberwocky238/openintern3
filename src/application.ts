import type { Plugin } from "@openintern/kernel/plugin";
import { CliEngine } from "./CliEngine.js";
import { EventBus } from "./kernel/event-bus.js";
import { ConsoleLogger } from "./kernel/logger.js";
import {
  InMemoryCapabilityInvokerService,
  InMemoryCapabilityRegistryService,
} from "./service/index.js";

export class Application {
  public readonly plugins: Plugin[] = [];
  public readonly capabilityRegistry = new InMemoryCapabilityRegistryService();
  public readonly capabilityInvoker = new InMemoryCapabilityInvokerService(
    this.capabilityRegistry,
  );
  public readonly logger = new ConsoleLogger();

  private readonly cliEngine = new CliEngine();
  private readonly eventBus = new EventBus();

  public async registerPlugin(plugin: Plugin): Promise<void> {
    this.plugins.push(plugin);
    await plugin._initPlugin(this.eventBus, {
      capabilityRegistry: this.capabilityRegistry,
      capabilityInvoker: this.capabilityInvoker,
      logger: this.logger,
    });
    this.registerPluginCapabilities(plugin);
  }

  public async executeLine(input: string): Promise<string | null> {
    return this.cliEngine.execute(input, this);
  }

  public getPrompt(): string {
    return this.cliEngine.getPrompt();
  }

  public async init(): Promise<void> {
    await this.cliEngine.initHistory();
  }

  public getCliReadlineHistory(): string[] {
    return this.cliEngine.getReadlineHistory();
  }

  public getPlugin(name: string): Plugin | undefined {
    return this.plugins.find((plugin) => plugin.name === name);
  }

  private registerPluginCapabilities(plugin: Plugin): void {
    for (const capability of plugin.capabilities()) {
      this.capabilityRegistry.register(capability);
    }
  }
}
