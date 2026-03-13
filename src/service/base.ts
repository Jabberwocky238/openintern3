export type ServiceKind =
  | "capability-registry"
  | "capability-invoker"
  | "capability-policy"
  | "capability-isolation";

export interface ServiceDescriptor {
  id: string;
  kind: ServiceKind;
  description: string;
}

export abstract class ServiceProvider {
  protected constructor(
    public readonly descriptor: ServiceDescriptor,
  ) {}

  public get id(): string {
    return this.descriptor.id;
  }

  public get kind(): ServiceKind {
    return this.descriptor.kind;
  }
}
