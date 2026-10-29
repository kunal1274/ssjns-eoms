import { z } from "zod";
const uuid = z.string().uuid().toLowerCase(),
  reason = z.string().trim().min(3).max(500),
  reference = z.string().trim().min(3).max(240);
export const mappingAppointmentInput = z
  .object({
    key: uuid,
    subjectId: uuid,
    policyId: uuid,
    acceptanceId: uuid,
    expectedRevision: z.number().int().min(0).max(2147483646),
    action: z.enum(["appointed", "revoked"]),
    reference,
    reason,
  })
  .strict();
export const mappingRequestInput = z
  .object({
    key: uuid,
    policyId: uuid,
    acceptanceId: uuid,
    previousId: uuid.nullable(),
    custodyRef: reference,
    reason,
  })
  .strict();
export const mappingDecisionInput = z
  .object({
    key: uuid,
    expectedRevision: z.number().int().min(0).max(2147483646),
    appointmentId: uuid,
    outcome: z.enum(["approved", "returned", "rejected", "withdrawn"]),
    reference,
    reason,
    examined: z.literal(true),
  })
  .strict();
