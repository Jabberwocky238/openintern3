import type { CapabilityProvider } from "./capability.js";
import type { EventBus } from "./event-bus.js";
import type { CapabilityInvokerServiceProvider } from "../service/capability-invoker.js";
import type { CapabilityRegistryServiceProvider } from "../service/capability-registry.js";

export interface PluginOptions {
  namespaces: string[];
  name: string;
  version: string;
}

export interface PluginInject {
  capabilityInvoker: CapabilityInvokerServiceProvider;
  capabilityRegistry: CapabilityRegistryServiceProvider;
}

export abstract class Plugin {
  public readonly namespaces: string[];
  public readonly name: string;
  public readonly version: string;
  public readonly state: Record<string, unknown> = {};
  protected readonly inject: Partial<PluginInject> = {};
  protected eventBus?: EventBus;
  protected _initState = false;
  protected _healthState = false;

  constructor(options: PluginOptions) {
    this.namespaces = options.namespaces;
    this.name = options.name;
    this.version = options.version;
  }

  public capabilities(): CapabilityProvider[] {
    return [];
  }

  public registry(): CapabilityRegistryServiceProvider {
    const registry = this.inject.capabilityRegistry;
    if (!registry) {
      throw new Error(`Capability registry is not available for plugin '${this.name}'.`);
    }
    return registry as CapabilityRegistryServiceProvider;
  }

  public invoker(): CapabilityInvokerServiceProvider {
    const invoker = this.inject.capabilityInvoker;
    if (!invoker) {
      throw new Error(`Capability invoker is not available for plugin '${this.name}'.`);
    }
    return invoker as CapabilityInvokerServiceProvider;
  }

  public async init(): Promise<void> {}

  // only for internal use by the Application to initialize the plugin
  public async _initPlugin(eventBus: EventBus, services: Partial<PluginInject>): Promise<void> {
    this.eventBus = eventBus;
    Object.assign(this.inject, services);
    try {
      await this.init();
      this._initState = true;
      this._healthState = true;
    } catch (error) {
      this._initState = false;
      this._healthState = false;
      throw error;
    }
  }

  public get isInitialized(): boolean {
    return this._initState;
  }
}
