import { z } from "zod";
export const hierarchyReadGrantInput = z
  .object({
    key: z.string().uuid().toLowerCase(),
    subjectId: z.string().uuid().toLowerCase(),
    nodeKind: z.enum([
      "customer",
      "group",
      "company",
      "area",
      "estate",
      "unit",
      "site",
    ]),
    nodeId: z.string().uuid().toLowerCase(),
    inheritance: z.enum(["none", "descendants"]),
    action: z.enum(["granted", "revoked"]),
    expectedRevision: z.number().int().min(0).max(2147483646),
    reference: z.string().trim().min(3).max(240),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
