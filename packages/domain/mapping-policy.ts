import { z } from "zod";
const uuid = z
  .string()
  .uuid()
  .transform((v) => v.toLowerCase());
const note = z.string().trim().min(10).max(2000);
export const policyContent = z
  .object({
    version: z.literal(1),
    basis: z.literal("mapping-policy-r0"),
    scope: z.literal("design-review-only"),
    custodyCriteria: note,
    approverCriteria: note,
    evidenceCriteria: note,
  })
  .strict();
export const policyGuardrails = [
  "R0-01: Preserve original historical facts; separately classified attribution overlays only; no implied payroll or finance posting.",
  "R0-02: Task links remain in the existing exact-code, versioned, reasoned workflow; no bulk unlink or overwrite.",
  "R0-03: Future decisions must bind exact manifest, check, custody, observation and policy identities.",
  "R0-04: A separately scoped mapping approver must be distinct from preparer, uploader and relied-on provenance reviewers.",
  "R0-05: Concerns, insufficient evidence, changed authority and disputed custody pause decisions; positive statements do not cancel concerns.",
  "R0-06: Revalidate all scopes, lifecycle, versions and evidence transactionally before application.",
  "R0-07: Bounded atomic batches, immutable receipts and exact-payload retry; no partial application or live downstream dispatch.",
  "R0-08: Corrections require append-only authorized compensation preserving prior decisions and history.",
] as const;
export function policyDocument(input: unknown) {
  return { ...policyContent.parse(input), guardrails: policyGuardrails };
}
export const policyProposalInput = z
  .object({
    key: uuid,
    expectedRevision: z.number().int().min(0).max(2147483646),
    reason: z.string().trim().min(3).max(500),
    content: policyContent,
  })
  .strict();
export const policyReviewInput = z
  .object({
    key: uuid,
    expectedRevision: z.number().int().min(0).max(2147483646),
    policySha256: z.string().regex(/^[a-f0-9]{64}$/),
    outcome: z.enum([
      "support-for-design",
      "changes-requested",
      "not-supported",
    ]),
    reference: z.string().trim().min(3).max(240),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
