import type { CapabilityContext, CapabilityDescriptor } from "../kernel/capability.js";
import { ServiceProvider } from "./base.js";

export interface CapabilityAccessRequest {
  capability: CapabilityDescriptor;
  context?: CapabilityContext;
  input?: unknown;
}

export interface CapabilityAccessDecision {
  allowed: boolean;
  reason?: string;
}

export abstract class CapabilityPolicyServiceProvider extends ServiceProvider {
  public abstract authorize(
    request: CapabilityAccessRequest,
  ): Promise<CapabilityAccessDecision>;
}
