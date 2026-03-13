import { z } from "zod";

export const pingSchema = z.object({
  args: z.array(z.any()),
});
