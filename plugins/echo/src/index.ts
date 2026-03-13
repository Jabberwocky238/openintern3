import {
  Plugin,
} from "@openintern/kernel/plugin";
import {
  CapabilityProvider,
  type EventBus,
  EventSubTarget,
  type PluginEvent,
} from "@openintern/kernel";
import { EchoPingCapabilityProvider } from "./echo-ping-capability.js";

export default class EchoPlugin extends Plugin {
  constructor() {
    super({
      name: "echo",
      version: "0.0.0",
      namespaces: ["echo"],
    });
  }

  public override async init(): Promise<void> {
    this.eventBus?.sub<EchoPlugin, "onEcho">(
      this,
      EventSubTarget.namespace("cron"),
      "echo",
      "onEcho",
    );
  }

  public ping(args: unknown[]): string {
    console.log(args);
    return "pong";
  }

  public override capabilities(): CapabilityProvider[] {
    return [
      new EchoPingCapabilityProvider(this),
    ];
  }

  public onEcho(event: PluginEvent): void {
    const payload = Array.isArray(event.payload) ? event.payload : [event.payload];
    this.ping(payload);
  }
}
