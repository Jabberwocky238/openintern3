import { z } from "zod";

const capabilityPrimitiveValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const capabilitySchemaSchema: z.ZodType<{
  type?: "string" | "number" | "integer" | "boolean" | "object" | "array";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  items?: unknown;
  enum?: Array<string | number | boolean | null>;
  description?: string;
}> = z.lazy(() =>
  z.object({
    type: z
      .enum(["string", "number", "integer", "boolean", "object", "array"])
      .optional(),
    properties: z.record(z.string(), capabilitySchemaSchema).optional(),
    required: z.array(z.string()).optional(),
    additionalProperties: z.boolean().optional(),
    items: capabilitySchemaSchema.optional(),
    enum: z.array(capabilityPrimitiveValueSchema).optional(),
    description: z.string().optional(),
  }),
);

export type CapabilitySchema = z.infer<typeof capabilitySchemaSchema>;

export interface CapabilityDescriptor {
  id: string;
  description: string;
  pluginName: string;
  version: string;
  tags?: string[];
  input?: CapabilitySchema;
  output?: CapabilitySchema;
}

export interface CapabilityContext {
  callerPluginName?: string;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

export interface CapabilityResult {
  ok: boolean;
  value?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

export abstract class CapabilityProvider {
  protected constructor(
    public readonly descriptor: CapabilityDescriptor,
  ) {
    if (descriptor.input) {
      capabilitySchemaSchema.parse(descriptor.input);
    }

    if (descriptor.output) {
      capabilitySchemaSchema.parse(descriptor.output);
    }
  }

  public get id(): string {
    return this.descriptor.id;
  }

  public abstract isAvailable(): boolean | Promise<boolean>;

  public abstract invoke(
    input: unknown,
    context?: CapabilityContext,
  ): Promise<CapabilityResult>;
}
