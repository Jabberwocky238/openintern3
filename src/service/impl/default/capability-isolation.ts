import type {
  CapabilityIsolationRequest,
  CapabilityIsolationResult,
} from "../../capability-isolation.js";
import { CapabilityIsolationServiceProvider } from "../../capability-isolation.js";

export class DefaultCapabilityIsolationService extends CapabilityIsolationServiceProvider {
  constructor() {
    super({
      id: "capability-isolation.default",
      kind: "capability-isolation",
      description: "Default capability isolation that passes input and context through unchanged.",
    });
  }

  public override async isolate(
    request: CapabilityIsolationRequest,
  ): Promise<CapabilityIsolationResult> {
    return {
      input: request.input,
      context: request.context,
    };
  }
}
