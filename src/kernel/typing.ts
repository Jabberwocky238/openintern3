import type { PluginEvent } from "./event-bus.js";

type AnyMethod = (...args: any[]) => any;

// Extract all public method names from a plugin instance type.
export type PublicMethodNames<T> = {
  [TKey in keyof T]-?: T[TKey] extends AnyMethod ? TKey : never;
}[keyof T] &
  string;

// Keep only the callable public members of a plugin instance type.
export type PublicMethods<T> = Pick<T, PublicMethodNames<T>>;

// Infer the parameter tuple for a specific public method.
export type MethodArgs<
  T,
  TMethodName extends PublicMethodNames<T>,
> = T[TMethodName] extends (...args: infer TArgs) => any ? TArgs : never;

// Infer the raw return type for a specific public method.
export type MethodReturn<
  T,
  TMethodName extends PublicMethodNames<T>,
> = T[TMethodName] extends (...args: any[]) => infer TReturn ? TReturn : never;

// Infer the awaited return type for async and sync methods uniformly.
export type AwaitedMethodReturn<
  T,
  TMethodName extends PublicMethodNames<T>,
> = Awaited<MethodReturn<T, TMethodName>>;

// Filter public methods down to event handlers that accept a PluginEvent.
export type EventHandlerMethodNames<T> = {
  [TKey in PublicMethodNames<T>]-?: MethodArgs<T, TKey> extends [PluginEvent]
    ? TKey
    : never;
}[PublicMethodNames<T>] &
  string;

// Extract the concrete event handler function type from a plugin method.
export type EventHandlerMethod<
  T,
  TMethodName extends EventHandlerMethodNames<T>,
> = Extract<T[TMethodName], (event: PluginEvent) => unknown | Promise<unknown>>;
