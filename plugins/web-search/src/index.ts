import { CapabilityProvider, Plugin } from "@openintern/kernel";
import { WebSearchSearchCapabilityProvider } from "./capabilities.js";
import { WebSearchEngine } from "./engine.js";

export default class WebSearchPlugin extends Plugin {
  constructor() {
    super({
      name: "web-search",
      version: "0.0.0",
      namespaces: ["web-search"],
    });
  }

  public override async init(): Promise<void> {
    this.state.engine = new WebSearchEngine();
  }

  public override capabilities(): CapabilityProvider[] {
    return [
      new WebSearchSearchCapabilityProvider(this),
    ];
  }

  public engine(): WebSearchEngine {
    const engine = this.state.engine;
    if (!(engine instanceof WebSearchEngine)) {
      throw new Error("WebSearch engine is not initialized.");
    }
    return engine;
  }
}
