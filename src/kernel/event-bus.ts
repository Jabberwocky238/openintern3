import mittModule, { type Emitter } from "mitt";

import type { Plugin } from "./plugin.js";
import type {
  EventHandlerMethod,
  EventHandlerMethodNames,
  PublicMethodNames,
} from "./typing.js";

export interface PluginEvent {
  plugin: {
    name: string;
    version: string;
    namespaces: string[];
  };
  type: string;
  payload: any;
}

export const PLUGIN_NAME_PREFIX = "plugin.openintern.com/name:";
export const PLUGIN_NAMESPACE_PREFIX = "plugin.openintern.com/namespace:";

export class EventSubTarget {
  private constructor(private readonly _target: string) { }

  public get target(): string {
    return this._target;
  }

  public static namespace(namespace: string): EventSubTarget {
    return new EventSubTarget(`${PLUGIN_NAMESPACE_PREFIX}${namespace}`);
  }

  public static pluginName(name: string): EventSubTarget {
    return new EventSubTarget(`${PLUGIN_NAME_PREFIX}${name}`);
  }
}

type EventMap = Record<string | symbol, PluginEvent>;

interface SubscriberRegistration<
  TPlugin extends Plugin = Plugin,
  THandler extends string = string,
> {
  subscriber: TPlugin;
  target: EventSubTarget;
  handlerName: THandler;
}

interface PublisherRegistration<
  TPlugin extends Plugin = Plugin,
  TMethod extends string = string,
> {
  plugin: TPlugin;
  methodName: TMethod;
  eventType: string;
}

export interface EventBusSnapshot {
  publishers: Array<{
    pluginName: string;
    pluginVersion: string;
    namespaces: string[];
    eventType: string;
    methodName: string;
  }>;
  subscriptions: Array<{
    subscriberName: string;
    subscriberVersion: string;
    eventType: string;
    targetPrefix: string;
    handlerName: string;
  }>;
}

const mitt = mittModule as unknown as <
  Events extends Record<string, unknown>,
>() => Emitter<Events>;

export class EventBus {
  private readonly emitter: Emitter<EventMap> = mitt<EventMap>();
  private readonly subscriptions = new Map<
    string,
    Map<string, SubscriberRegistration[]>
  >();
  private readonly publishers = new Map<string, PublisherRegistration>();
  private readonly activeDispatchers = new Set<string>();

  public sub<TPlugin extends Plugin, THandler extends EventHandlerMethodNames<TPlugin>>(
    subscriber: TPlugin,
    target: EventSubTarget,
    eventType: string,
    handlerName: THandler,
  ): void {
    const targetRegistrations = this.subscriptions.get(target.target) ?? new Map();
    const registrations = ((targetRegistrations.get(eventType) ??
      []) as unknown) as SubscriberRegistration<TPlugin, THandler>[];

    registrations.push({
      subscriber,
      target,
      handlerName,
    });

    targetRegistrations.set(eventType, registrations);
    this.subscriptions.set(target.target, targetRegistrations);
    this.ensureDispatcher(target.target);
  }

  public pub<TPlugin extends Plugin>(
    plugin: TPlugin,
    methodName: PublicMethodNames<TPlugin>,
    eventType: string,
  ): void {
    const publisherKey = this.getPublisherKey(plugin.name, methodName);

    if (this.publishers.has(publisherKey)) {
      return;
    }

    this.publishers.set(publisherKey, {
      plugin,
      methodName,
      eventType,
    } as PublisherRegistration);
  }

  public emit<T>(plugin: Plugin, eventType: string, payload: T): void {
    const event: PluginEvent = {
      plugin: {
        name: plugin.name,
        version: plugin.version,
        namespaces: plugin.namespaces,
      },
      type: eventType,
      payload,
    };

    for (const target of this.getPublishTargets(plugin)) {
      this.ensureDispatcher(target);
      this.emitter.emit(target, event);
    }
  }

  public show(): EventBusSnapshot {
    return {
      publishers: [...this.publishers.values()].map((registration) => ({
        pluginName: registration.plugin.name,
        pluginVersion: registration.plugin.version,
        namespaces: registration.plugin.namespaces,
        eventType: registration.eventType,
        methodName: registration.methodName,
      })),
      subscriptions: [...this.subscriptions.entries()].flatMap(
        ([targetPrefix, eventTypeMap]) =>
          [...eventTypeMap.entries()].flatMap(([eventType, registrations]) =>
            registrations.map((registration) => ({
              subscriberName: registration.subscriber.name,
              subscriberVersion: registration.subscriber.version,
              eventType,
              targetPrefix,
              handlerName: registration.handlerName,
            })),
          ),
      ),
    };
  }

  private ensureDispatcher(target: string): void {
    if (this.activeDispatchers.has(target)) {
      return;
    }

    this.emitter.on(target, async (event) => {
      await this.dispatch(target, event);
    });

    this.activeDispatchers.add(target);
  }

  private async dispatch(target: string, event: PluginEvent): Promise<void> {
    const registrations = this.subscriptions.get(target)?.get(event.type) ?? [];
    const invoked = new Set<string>();

    for (const registration of registrations) {
      if (!this.matchesTarget(target, registration.target, event.plugin)) {
        continue;
      }

      const invocationKey = [
        registration.subscriber.name,
        registration.handlerName,
        event.plugin.name,
        event.type,
      ].join(":");

      if (invoked.has(invocationKey)) {
        continue;
      }

      invoked.add(invocationKey);
      await this.invokeSubscriber(registration, event);
    }
  }

  private matchesTarget(
    targetKey: string,
    target: EventSubTarget,
    sourcePlugin: PluginEvent["plugin"],
  ): boolean {
    const targetPrefix = target.target;

    if (targetKey !== targetPrefix) {
      return false;
    }

    if (targetPrefix.startsWith(PLUGIN_NAME_PREFIX)) {
      return targetPrefix.slice(PLUGIN_NAME_PREFIX.length) === sourcePlugin.name;
    }

    if (targetPrefix.startsWith(PLUGIN_NAMESPACE_PREFIX)) {
      const namespace = targetPrefix.slice(PLUGIN_NAMESPACE_PREFIX.length);
      return sourcePlugin.namespaces.includes(namespace);
    }

    throw new TypeError(`Unsupported subscription prefix: ${targetPrefix}`);
  }

  private getPublisherKey(pluginName: string, methodName: string): string {
    return `${pluginName}:${methodName}`;
  }

  private getPublishTargets(plugin: Plugin): string[] {
    return [
      `${PLUGIN_NAME_PREFIX}${plugin.name}`,
      ...plugin.namespaces.map(
        (namespace) => `${PLUGIN_NAMESPACE_PREFIX}${namespace}`,
      ),
    ];
  }

  private async invokeSubscriber(
    registration: SubscriberRegistration,
    event: PluginEvent,
  ): Promise<void> {
    const handler =
      registration.subscriber[
      registration.handlerName as keyof typeof registration.subscriber
      ];

    if (typeof handler !== "function") {
      return;
    }

    await Reflect.apply(handler, registration.subscriber, [event]);
  }
}
