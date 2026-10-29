import { z } from "zod";
const uuid = z
  .string()
  .uuid()
  .transform((v) => v.toLowerCase());
const revision = z.number().int().min(0).max(2147483646);
const reference = z.string().trim().min(3).max(240);
const reason = z.string().trim().min(3).max(500);
export const policyAuthorityInput = z
  .object({
    key: uuid,
    subjectId: uuid,
    expectedRevision: revision,
    action: z.enum(["appointed", "revoked"]),
    authorityRef: reference,
    reason,
  })
  .strict();
export const policyAcceptanceInput = z
  .object({
    key: uuid,
    expectedRevision: revision,
    policySha256: z.string().regex(/^[a-f0-9]{64}$/),
    authorityId: uuid,
    outcome: z.enum([
      "accepted-externally",
      "changes-requested",
      "rejected",
      "withdrawn",
    ]),
    externalRef: reference,
    reason,
    attested: z.literal(true),
  })
  .strict();
