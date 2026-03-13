import type { CapabilityDescriptor, CapabilityProvider } from "../../../kernel/capability.js";
import { CapabilityRegistryServiceProvider } from "../../capability-registry.js";

function matchesAllTags(
  descriptor: CapabilityDescriptor,
  tags: string[] | undefined,
): boolean {
  if (!tags || tags.length === 0) {
    return true;
  }

  const descriptorTags = new Set(descriptor.tags ?? []);

  return tags.every((tag) => descriptorTags.has(tag));
}

export class InMemoryCapabilityRegistryService extends CapabilityRegistryServiceProvider {
  private readonly providers = new Map<string, CapabilityProvider>();

  constructor() {
    super({
      id: "capability-registry.memory",
      kind: "capability-registry",
      description: "In-memory capability registry backed by a local Map.",
    });
  }

  public override register(provider: CapabilityProvider): void {
    const existing = this.providers.get(provider.id);

    if (existing && existing !== provider) {
      throw new Error(`Capability already registered: ${provider.id}`);
    }

    this.providers.set(provider.id, provider);
  }

  public override unregister(capabilityId: string): void {
    this.providers.delete(capabilityId);
  }

  public override get(capabilityId: string): CapabilityProvider | undefined {
    return this.providers.get(capabilityId);
  }

  public override list(tags?: string[]): CapabilityDescriptor[] {
    return [...this.providers.values()]
      .map((provider) => provider.descriptor)
      .filter((descriptor) => matchesAllTags(descriptor, tags));
  }
}
