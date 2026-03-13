import { z } from "zod";

export const openTerminalSchema = z.object({});

export const closeTerminalSchema = z.object({
  id: z.string().min(1),
});

export const writeSchema = z.object({
  id: z.string().min(1),
  str: z.string(),
});

export const writeFlushSchema = z.object({
  id: z.string().min(1),
  str: z.string(),
});

export const listTerminalsSchema = z.object({});
