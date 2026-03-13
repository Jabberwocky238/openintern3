import {
  CapabilityProvider,
  Plugin,
  type EventBus,
} from "@openintern/kernel";
import {
  CronAddCapabilityProvider,
  CronDeleteCapabilityProvider,
  CronListCapabilityProvider,
} from "./cron-capabilities.js";
interface CronJob {
  id: string;
  eventType: string;
  intervalMs: number;
  timer: ReturnType<typeof setInterval>;
}

export default class CronPlugin extends Plugin {
  constructor() {
    super({
      name: "cron",
      version: "0.0.0",
      namespaces: ["cron"],
    });
  }

  public override async init(): Promise<void> {
    this.state.crons = new Map<string, CronJob>();
  }

  public addCron(eventType: string, intervalMs: number): string {
    if (typeof eventType !== "string" || eventType.trim().length === 0) {
      throw new TypeError("eventType must be a non-empty string.");
    }

    if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
      throw new TypeError("intervalMs must be a positive integer.");
    }

    const id = crypto.randomUUID();
    const timer = setInterval(() => {
      void this.emitCronTick(eventType, Date.now());
    }, intervalMs);
    const crons = this.getCronState();

    crons.set(id, {
      id,
      eventType,
      intervalMs,
      timer,
    });

    return id;
  }

  public deleteCron(id: string): void {
    const cron = this.getCronState().get(id);

    if (!cron) {
      throw new Error(`Cron not found: ${id}`);
    }

    clearInterval(cron.timer);
    this.getCronState().delete(id);
  }

  public listCron(): Array<{
    id: string;
    eventType: string;
    intervalMs: number;
  }> {
    return [...this.getCronState().values()].map(
      ({ id, eventType, intervalMs }) => ({
        id,
        eventType,
        intervalMs,
      }),
    );
  }

  public async emitCronTick(eventType: string, timestamp: number): Promise<void> {
    this.eventBus?.emit(this, eventType, timestamp);
  }

  public override capabilities(): CapabilityProvider[] {
    return [
      new CronAddCapabilityProvider(this),
      new CronDeleteCapabilityProvider(this),
      new CronListCapabilityProvider(this),
    ];
  }

  private getCronState(): Map<string, CronJob> {
    const crons = this.state.crons;

    if (!(crons instanceof Map)) {
      throw new Error("Cron state is not initialized.");
    }

    return crons as Map<string, CronJob>;
  }
}
