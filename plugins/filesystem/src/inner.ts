import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface InspectFileResult {
  path: string;
  resolvedPath: string;
  type: "file" | "directory" | "other";
  sizeBytes: number;
  extension?: string;
  mime?: string | null;
  isBinary?: boolean;
  recommendedCapability: string | null;
}

function isEscapingRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

export class FilesystemInner {
  constructor(
    private readonly workspace = process.cwd(),
    private readonly allowedDir?: string,
  ) {}

  public resolvePath(input: string): string {
    if (typeof input !== "string" || input.trim().length === 0) {
      throw new TypeError("path must be a non-empty string.");
    }

    const base = path.isAbsolute(input)
      ? input
      : path.join(this.workspace, input);
    const resolved = path.resolve(base);

    if (this.allowedDir) {
      const root = path.resolve(this.allowedDir);
      if (isEscapingRoot(root, resolved)) {
        throw new Error(`Access denied: path '${input}' escapes workspace sandbox.`);
      }
    }

    return resolved;
  }

  public detectBinary(bytes: Buffer): boolean {
    const sample = bytes.subarray(0, Math.min(bytes.length, 4096));

    if (sample.includes(0)) {
      return true;
    }

    let suspicious = 0;
    for (const byte of sample) {
      const isControl = byte < 7 || (byte > 14 && byte < 32) || byte === 127;
      if (isControl) {
        suspicious += 1;
      }
    }

    return sample.length > 0 && suspicious / sample.length > 0.1;
  }

  public mimeFromExtension(ext: string): string | null {
    switch (ext.toLowerCase()) {
      case ".png":
        return "image/png";
      case ".jpg":
      case ".jpeg":
        return "image/jpeg";
      case ".webp":
        return "image/webp";
      case ".gif":
        return "image/gif";
      case ".pdf":
        return "application/pdf";
      default:
        return null;
    }
  }

  public async readText(rawPath: string): Promise<string> {
    const filePath = this.resolvePath(rawPath);
    const fileStat = await stat(filePath);

    if (!fileStat.isFile()) {
      throw new Error(`Not a file: ${rawPath}`);
    }

    const bytes = await readFile(filePath);
    if (this.detectBinary(bytes)) {
      const mime = this.mimeFromExtension(path.extname(filePath));
      const mimePart = mime ? ` (${mime})` : "";
      throw new Error(
        `File appears to be binary${mimePart}: ${rawPath}. Use inspect_file or read_image instead.`,
      );
    }

    return bytes.toString("utf8");
  }

  public async writeText(rawPath: string, content: string): Promise<{
    path: string;
    resolvedPath: string;
    bytesWritten: number;
  }> {
    const filePath = this.resolvePath(rawPath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");

    return {
      path: rawPath,
      resolvedPath: filePath,
      bytesWritten: Buffer.byteLength(content, "utf8"),
    };
  }

  public async editText(
    rawPath: string,
    oldText: string,
    newText: string,
  ): Promise<{
    path: string;
    resolvedPath: string;
    replaced: true;
  }> {
    const filePath = this.resolvePath(rawPath);
    const content = await readFile(filePath, "utf8");

    if (!content.includes(oldText)) {
      throw new Error(`old_text not found in ${rawPath}.`);
    }

    const count = content.split(oldText).length - 1;
    if (count > 1) {
      throw new Error(
        `old_text appears ${count} times in ${rawPath}. Provide a more specific match.`,
      );
    }

    const next = content.replace(oldText, newText);
    await writeFile(filePath, next, "utf8");

    return {
      path: rawPath,
      resolvedPath: filePath,
      replaced: true,
    };
  }

  public async listDir(rawPath: string): Promise<Array<{
    name: string;
    kind: "file" | "directory";
  }>> {
    const dirPath = this.resolvePath(rawPath);
    const dirStat = await stat(dirPath);

    if (!dirStat.isDirectory()) {
      throw new Error(`Not a directory: ${rawPath}`);
    }

    const names = await readdir(dirPath);
    const rows = await Promise.all(
      names.sort().map(async (name) => {
        const entryPath = path.join(dirPath, name);
        const entryStat = await stat(entryPath);
        return {
          name,
          kind: entryStat.isDirectory() ? "directory" as const : "file" as const,
        };
      }),
    );

    return rows;
  }

  public async inspect(rawPath: string): Promise<InspectFileResult> {
    const resolvedPath = this.resolvePath(rawPath);
    const fileStat = await stat(resolvedPath);

    if (fileStat.isDirectory()) {
      return {
        path: rawPath,
        resolvedPath,
        type: "directory",
        sizeBytes: fileStat.size,
        recommendedCapability: "filesystem.list_dir",
      };
    }

    if (!fileStat.isFile()) {
      return {
        path: rawPath,
        resolvedPath,
        type: "other",
        sizeBytes: fileStat.size,
        recommendedCapability: null,
      };
    }

    const extension = path.extname(resolvedPath).toLowerCase();
    const mime = this.mimeFromExtension(extension);
    const bytes = await readFile(resolvedPath);
    const isBinary = this.detectBinary(bytes);

    return {
      path: rawPath,
      resolvedPath,
      type: "file",
      sizeBytes: fileStat.size,
      extension,
      mime,
      isBinary,
      recommendedCapability:
        mime && mime.startsWith("image/")
          ? "filesystem.read_image"
          : isBinary
            ? null
            : "filesystem.read_file",
    };
  }
}
