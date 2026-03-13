import { z } from "zod";

export const readFileSchema = z.object({
  path: z.string().min(1),
});

export const writeFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

export const editFileSchema = z.object({
  path: z.string().min(1),
  old_text: z.string(),
  new_text: z.string(),
});

export const listDirSchema = z.object({
  path: z.string().min(1),
});

export const inspectFileSchema = z.object({
  path: z.string().min(1),
});
