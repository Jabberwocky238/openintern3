import type { CapabilityContext } from "../kernel/capability.js";
import { ServiceProvider } from "./base.js";

export interface CapabilityIsolationRequest {
  capabilityId: string;
  input: unknown;
  context?: CapabilityContext;
}

export interface CapabilityIsolationResult {
  input: unknown;
  context?: CapabilityContext;
}

export abstract class CapabilityIsolationServiceProvider extends ServiceProvider {
  public abstract isolate(
    request: CapabilityIsolationRequest,
  ): Promise<CapabilityIsolationResult>;
}
