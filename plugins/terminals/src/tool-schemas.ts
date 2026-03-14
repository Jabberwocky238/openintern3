import { z } from "zod";

export const terminalStartSchema = z.object({
  command: z.string().min(1),
  description: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
  shell: z.string().min(1).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export const terminalListSchema = z.object({});

export const terminalTailSchema = z.object({
  pid: z.number().int().positive(),
  lines: z.number().int().positive().optional(),
  stream: z.enum(["stdout", "stderr", "combine"]).optional(),
});

export const terminalKillSchema = z.object({
  pid: z.number().int().positive(),
});

export const terminalCmdSchema = terminalStartSchema;
