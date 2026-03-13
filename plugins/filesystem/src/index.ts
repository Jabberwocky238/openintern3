import { CapabilityProvider, Plugin } from "@openintern/kernel";
import {
  FilesystemEditFileCapabilityProvider,
  FilesystemInspectFileCapabilityProvider,
  FilesystemListDirCapabilityProvider,
  FilesystemReadFileCapabilityProvider,
  FilesystemWriteFileCapabilityProvider,
} from "./capabilities.js";
import { FilesystemInner } from "./inner.js";

export default class FilesystemPlugin extends Plugin {
  constructor() {
    super({
      name: "filesystem",
      version: "0.0.0",
      namespaces: ["filesystem"],
    });
  }

  public override async init(): Promise<void> {
    this.state.inner = new FilesystemInner(process.cwd(), process.cwd());
  }

  public override capabilities(): CapabilityProvider[] {
    return [
      new FilesystemReadFileCapabilityProvider(this),
      new FilesystemWriteFileCapabilityProvider(this),
      new FilesystemEditFileCapabilityProvider(this),
      new FilesystemListDirCapabilityProvider(this),
      new FilesystemInspectFileCapabilityProvider(this),
    ];
  }

  public inner(): FilesystemInner {
    const inner = this.state.inner;

    if (!(inner instanceof FilesystemInner)) {
      throw new Error("Filesystem inner is not initialized.");
    }

    return inner;
  }

  public async read(path: string): Promise<string> {
    return this.inner().readText(path);
  }

  public async write(path: string, content: string): Promise<{
    path: string;
    resolvedPath: string;
    bytesWritten: number;
  }> {
    return this.inner().writeText(path, content);
  }

  public async edit(path: string, oldText: string, newText: string): Promise<{
    path: string;
    resolvedPath: string;
    replaced: true;
  }> {
    return this.inner().editText(path, oldText, newText);
  }

  public async list(path: string): Promise<Array<{
    name: string;
    kind: "file" | "directory";
  }>> {
    return this.inner().listDir(path);
  }

  public async inspect(path: string) {
    return this.inner().inspect(path);
  }
}
