import type { CapabilityDescriptor, CapabilityProvider } from "../kernel/capability.js";
import { ServiceProvider } from "./base.js";

export abstract class CapabilityRegistryServiceProvider extends ServiceProvider {
  public abstract register(provider: CapabilityProvider): void | Promise<void>;

  public abstract unregister(capabilityId: string): void | Promise<void>;

  public abstract get(capabilityId: string): CapabilityProvider | undefined | Promise<CapabilityProvider | undefined>;

  public abstract list(tags?: string[]): CapabilityDescriptor[] | Promise<CapabilityDescriptor[]>;
}
