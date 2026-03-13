import type {
  CapabilityAccessDecision,
  CapabilityAccessRequest,
} from "../../capability-policy.js";
import { CapabilityPolicyServiceProvider } from "../../capability-policy.js";

export class DefaultCapabilityPolicyService extends CapabilityPolicyServiceProvider {
  constructor() {
    super({
      id: "capability-policy.default",
      kind: "capability-policy",
      description: "Default capability policy that allows all capability invocations.",
    });
  }

  public override async authorize(
    _request: CapabilityAccessRequest,
  ): Promise<CapabilityAccessDecision> {
    return {
      allowed: true,
    };
  }
}
