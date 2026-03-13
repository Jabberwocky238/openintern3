import { Plugin } from "./plugin.js";

export type PluginClass = new () => Plugin;

export class PluginLoader {
  public async loadFromImport(modulePath: string): Promise<Plugin> {
    const imported = (await import(modulePath)) as {
      default?: PluginClass;
    };

    if (!imported.default) {
      throw new TypeError("Plugin module must provide a default export.");
    }

    return new imported.default();
  }
}
