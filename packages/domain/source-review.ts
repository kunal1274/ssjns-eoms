import { z } from "zod";
export const sourceReviewInput = z
  .object({
    key: z
      .string()
      .uuid()
      .transform((v) => v.toLowerCase()),
    expectedRevision: z.number().int().min(0).max(2147483646),
    outcome: z.enum(["corroborated", "concerns", "insufficient"]),
    originalExamined: z.boolean(),
    sourceRef: z.string().trim().min(3).max(240),
    reason: z.string().trim().min(3).max(500),
  })
  .strict()
  .refine((v) => v.outcome !== "corroborated" || v.originalExamined, {
    message: "Corroboration requires original examination",
  });
