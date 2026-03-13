import type {
  CapabilityContext,
  CapabilityResult,
} from "../kernel/capability.js";
import { ServiceProvider } from "./base.js";

export abstract class CapabilityInvokerServiceProvider extends ServiceProvider {
  public abstract invoke(
    capabilityId: string,
    input: unknown,
    context?: CapabilityContext,
  ): Promise<CapabilityResult>;
}
