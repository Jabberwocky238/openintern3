import {
  type CapabilityDescriptor,
  CapabilityProvider,
  type CapabilityContext,
  type CapabilityResult,
} from "@openintern/kernel/capability";
import type { FilesystemInner } from "./inner.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface FilesystemPluginLike {
  readonly name: string;
  readonly version: string;
  readonly isInitialized: boolean;
  inner(): FilesystemInner;
}

abstract class FilesystemCapabilityProvider extends CapabilityProvider {
  constructor(
    descriptor: CapabilityDescriptor,
    protected readonly plugin: FilesystemPluginLike,
  ) {
    super(descriptor);
  }

  public override isAvailable(): boolean {
    return this.plugin.isInitialized;
  }
}

export class FilesystemReadFileCapabilityProvider extends FilesystemCapabilityProvider {
  constructor(plugin: FilesystemPluginLike) {
    super(
      {
        id: "filesystem.read_file",
        description: "Read a UTF-8 text file from the workspace.",
        pluginName: plugin.name,
        version: plugin.version,
        tags: ["filesystem", "read"],
        input: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "File path to read.",
            },
          },
          required: ["path"],
          additionalProperties: false,
        },
        output: {
          type: "string",
          description: "Text file content.",
        },
      },
      plugin,
    );
  }

  public override async invoke(
    input: unknown,
    _context?: CapabilityContext,
  ): Promise<CapabilityResult> {
    if (!isRecord(input) || typeof input.path !== "string" || input.path.trim().length === 0) {
      return { ok: false, error: "path must be a non-empty string." };
    }

    try {
      return {
        ok: true,
        value: await this.plugin.inner().readText(input.path),
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export class FilesystemWriteFileCapabilityProvider extends FilesystemCapabilityProvider {
  constructor(plugin: FilesystemPluginLike) {
    super(
      {
        id: "filesystem.write_file",
        description: "Write a UTF-8 text file, creating parent directories when needed.",
        pluginName: plugin.name,
        version: plugin.version,
        tags: ["filesystem", "write"],
        input: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "File path to write.",
            },
            content: {
              type: "string",
              description: "Text content to write.",
            },
          },
          required: ["path", "content"],
          additionalProperties: false,
        },
        output: {
          type: "object",
          properties: {
            path: { type: "string" },
            resolvedPath: { type: "string" },
            bytesWritten: { type: "integer" },
          },
          required: ["path", "resolvedPath", "bytesWritten"],
          additionalProperties: false,
        },
      },
      plugin,
    );
  }

  public override async invoke(
    input: unknown,
    _context?: CapabilityContext,
  ): Promise<CapabilityResult> {
    if (
      !isRecord(input) ||
      typeof input.path !== "string" ||
      input.path.trim().length === 0 ||
      typeof input.content !== "string"
    ) {
      return { ok: false, error: "path and content are required." };
    }

    try {
      return {
        ok: true,
        value: await this.plugin.inner().writeText(input.path, input.content),
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export class FilesystemEditFileCapabilityProvider extends FilesystemCapabilityProvider {
  constructor(plugin: FilesystemPluginLike) {
    super(
      {
        id: "filesystem.edit_file",
        description: "Edit a text file by replacing one exact text segment.",
        pluginName: plugin.name,
        version: plugin.version,
        tags: ["filesystem", "write", "edit"],
        input: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "File path to edit.",
            },
            old_text: {
              type: "string",
              description: "Exact text to replace.",
            },
            new_text: {
              type: "string",
              description: "Replacement text.",
            },
          },
          required: ["path", "old_text", "new_text"],
          additionalProperties: false,
        },
        output: {
          type: "object",
          properties: {
            path: { type: "string" },
            resolvedPath: { type: "string" },
            replaced: { type: "boolean" },
          },
          required: ["path", "resolvedPath", "replaced"],
          additionalProperties: false,
        },
      },
      plugin,
    );
  }

  public override async invoke(
    input: unknown,
    _context?: CapabilityContext,
  ): Promise<CapabilityResult> {
    if (
      !isRecord(input) ||
      typeof input.path !== "string" ||
      input.path.trim().length === 0 ||
      typeof input.old_text !== "string" ||
      typeof input.new_text !== "string"
    ) {
      return { ok: false, error: "path, old_text and new_text are required." };
    }

    try {
      return {
        ok: true,
        value: await this.plugin.inner().editText(input.path, input.old_text, input.new_text),
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export class FilesystemListDirCapabilityProvider extends FilesystemCapabilityProvider {
  constructor(plugin: FilesystemPluginLike) {
    super(
      {
        id: "filesystem.list_dir",
        description: "List the entries of a directory.",
        pluginName: plugin.name,
        version: plugin.version,
        tags: ["filesystem", "read", "list"],
        input: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Directory path to list.",
            },
          },
          required: ["path"],
          additionalProperties: false,
        },
        output: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              kind: {
                type: "string",
                enum: ["file", "directory"],
              },
            },
            required: ["name", "kind"],
            additionalProperties: false,
          },
          description: "Directory entries.",
        },
      },
      plugin,
    );
  }

  public override async invoke(
    input: unknown,
    _context?: CapabilityContext,
  ): Promise<CapabilityResult> {
    if (!isRecord(input) || typeof input.path !== "string" || input.path.trim().length === 0) {
      return { ok: false, error: "path must be a non-empty string." };
    }

    try {
      return {
        ok: true,
        value: await this.plugin.inner().listDir(input.path),
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export class FilesystemInspectFileCapabilityProvider extends FilesystemCapabilityProvider {
  constructor(plugin: FilesystemPluginLike) {
    super(
      {
        id: "filesystem.inspect_file",
        description: "Inspect a file or directory and recommend the next capability to use.",
        pluginName: plugin.name,
        version: plugin.version,
        tags: ["filesystem", "read", "inspect"],
        input: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to inspect.",
            },
          },
          required: ["path"],
          additionalProperties: false,
        },
        output: {
          type: "object",
          properties: {
            path: { type: "string" },
            resolvedPath: { type: "string" },
            type: {
              type: "string",
              enum: ["file", "directory", "other"],
            },
            sizeBytes: { type: "integer" },
            extension: { type: "string" },
            mime: { type: "string" },
            isBinary: { type: "boolean" },
            recommendedCapability: { type: "string" },
          },
          required: ["path", "resolvedPath", "type", "sizeBytes"],
          additionalProperties: true,
        },
      },
      plugin,
    );
  }

  public override async invoke(
    input: unknown,
    _context?: CapabilityContext,
  ): Promise<CapabilityResult> {
    if (!isRecord(input) || typeof input.path !== "string" || input.path.trim().length === 0) {
      return { ok: false, error: "path must be a non-empty string." };
    }

    try {
      return {
        ok: true,
        value: await this.plugin.inner().inspect(input.path),
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
