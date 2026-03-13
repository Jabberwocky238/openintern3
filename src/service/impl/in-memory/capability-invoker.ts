import type { CapabilityContext, CapabilityResult } from "../../../kernel/capability.js";
import type { CapabilityRegistryServiceProvider } from "../../capability-registry.js";
import { CapabilityInvokerServiceProvider } from "../../capability-invoker.js";

export class InMemoryCapabilityInvokerService extends CapabilityInvokerServiceProvider {
  constructor(
    private readonly registry: CapabilityRegistryServiceProvider,
  ) {
    super({
      id: "capability-invoker.memory",
      kind: "capability-invoker",
      description: "In-memory capability invoker backed by a capability registry.",
    });
  }

  public override async invoke(
    capabilityId: string,
    input: unknown,
    context?: CapabilityContext,
  ): Promise<CapabilityResult> {
    const provider = await this.registry.get(capabilityId);

    if (!provider) {
      return {
        ok: false,
        error: `Capability not found: ${capabilityId}`,
      };
    }

    const available = await provider.isAvailable();

    if (!available) {
      return {
        ok: false,
        error: `Capability is not available: ${capabilityId}`,
      };
    }

    try {
      return await provider.invoke(input, context);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
