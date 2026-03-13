import { z } from "zod";

export const addCronSchema = z.object({
  eventType: z.string().min(1),
  intervalMs: z.number().int().positive(),
});

export const deleteCronSchema = z.object({
  id: z.string().min(1),
});

export const listCronSchema = z.object({});
