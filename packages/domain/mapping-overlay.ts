import { z } from "zod";
const uuid = z.string().uuid().toLowerCase(),
  reference = z.string().trim().min(3).max(240),
  reason = z.string().trim().min(3).max(500);
export const overlayAuthorityInput = z
  .object({
    key: uuid,
    subjectId: uuid,
    purpose: z.enum(["apply", "compensate"]),
    expectedRevision: z.number().int().min(0).max(2147483646),
    action: z.enum(["appointed", "revoked"]),
    reference,
    reason,
  })
  .strict();
export const overlayExecutionInput = z
  .object({
    key: uuid,
    authorityId: uuid,
    operation: z.enum(["apply", "compensate"]),
    previousId: uuid.nullable(),
    reference,
    reason,
    examined: z.literal(true),
  })
  .strict()
  .refine(
    (v) =>
      v.operation === "apply" ? v.previousId === null : v.previousId !== null,
    { message: "Select the exact application receipt for compensation." },
  );
