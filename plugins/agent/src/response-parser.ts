import type { AgentMessage, AgentToolCallRequest } from "./types.js";

export function summarizeResponseBody(body: string): string {
  const singleLine = body.replace(/\s+/g, " ").trim();

  if (singleLine.length === 0) {
    return "<empty response body>";
  }

  if (singleLine.length <= 240) {
    return singleLine;
  }

  return `${singleLine.slice(0, 240)}...`;
}

export function sanitizeMessages(
  messages: AgentMessage[],
): Array<Record<string, unknown>> {
  const allowedKeys = new Set([
    "role",
    "content",
    "tool_calls",
    "tool_call_id",
    "name",
    "reasoning_content",
    "thinking_blocks",
  ]);

  return messages.map((message) => {
    const clean: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(message)) {
      if (allowedKeys.has(key)) {
        clean[key] = value;
      }
    }

    if (
      clean.role === "assistant" &&
      clean.tool_calls !== undefined &&
      (clean.content === undefined || clean.content === "")
    ) {
      clean.content = null;
    }

    return clean;
  });
}

export function parseToolCalls(rawToolCalls: unknown): AgentToolCallRequest[] {
  if (!Array.isArray(rawToolCalls)) {
    return [];
  }

  const out: AgentToolCallRequest[] = [];

  for (const item of rawToolCalls) {
    if (typeof item !== "object" || item === null) {
      continue;
    }

    const record = item as Record<string, unknown>;
    const functionBlock =
      typeof record.function === "object" && record.function !== null
        ? (record.function as Record<string, unknown>)
        : {};
    const name = typeof functionBlock.name === "string" ? functionBlock.name : "";

    if (!name) {
      continue;
    }

    let args: Record<string, unknown> = {};
    const rawArgs = functionBlock.arguments;

    if (typeof rawArgs === "string") {
      try {
        const parsed = JSON.parse(rawArgs) as unknown;

        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        args = {};
      }
    } else if (typeof rawArgs === "object" && rawArgs !== null && !Array.isArray(rawArgs)) {
      args = rawArgs as Record<string, unknown>;
    }

    out.push({
      id: typeof record.id === "string" ? record.id : `${name}_${out.length + 1}`,
      name,
      arguments: args,
    });
  }

  return out;
}

export function parseSsePayload(body: string): Record<string, unknown> | null {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"));

  if (lines.length === 0) {
    return null;
  }

  let content = "";
  let finishReason: string | undefined;
  let model = "";
  const toolCallsById = new Map<string, AgentToolCallRequest>();

  for (const line of lines) {
    const data = line.slice("data:".length).trim();

    if (data === "[DONE]") {
      continue;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }

    if (typeof parsed !== "object" || parsed === null) {
      continue;
    }

    const record = parsed as Record<string, unknown>;
    const item =
      typeof record.item === "object" && record.item !== null
        ? (record.item as Record<string, unknown>)
        : null;

    if (item) {
      const toolName = typeof item.name === "string" ? item.name : "";
      const toolArguments = typeof item.arguments === "string" ? item.arguments : "";
      const toolId =
        typeof item.call_id === "string"
          ? item.call_id
          : `${toolName}_${toolCallsById.size + 1}`;

      if (toolName.length > 0) {
        let parsedArguments: Record<string, unknown> = {};

        if (toolArguments.length > 0) {
          try {
            const parsedJson = JSON.parse(toolArguments) as unknown;

            if (
              typeof parsedJson === "object" &&
              parsedJson !== null &&
              !Array.isArray(parsedJson)
            ) {
              parsedArguments = parsedJson as Record<string, unknown>;
            }
          } catch {
            parsedArguments = {};
          }
        }

        toolCallsById.set(toolId, {
          id: toolId,
          name: toolName,
          arguments: parsedArguments,
        });
      }
    }

    if (typeof record.delta === "string" && !String(record.id ?? "").startsWith("fc_")) {
      content += record.delta;
    }

    if (typeof record.text === "string") {
      content = record.text;
    }

    const choices = Array.isArray(record.choices) ? record.choices : [];
    const firstChoice =
      choices.length > 0 && typeof choices[0] === "object" && choices[0] !== null
        ? (choices[0] as Record<string, unknown>)
        : null;

    if (!firstChoice) {
      continue;
    }

    const delta =
      typeof firstChoice.delta === "object" && firstChoice.delta !== null
        ? (firstChoice.delta as Record<string, unknown>)
        : {};
    const deltaContent = typeof delta.content === "string" ? delta.content : "";

    content += deltaContent;

    if (typeof firstChoice.finish_reason === "string") {
      finishReason = firstChoice.finish_reason;
    }

    if (typeof record.model === "string") {
      model = record.model;
    }
  }

  return {
    choices: [
      {
        finish_reason: finishReason ?? "stop",
        message: {
          content,
          tool_calls: [...toolCallsById.values()].map((toolCall) => ({
            id: toolCall.id,
            function: {
              name: toolCall.name,
              arguments: JSON.stringify(toolCall.arguments),
            },
          })),
        },
      },
    ],
    model,
    usage: {},
  };
}
