import { z } from "zod";
const uuid = z.string().uuid().toLowerCase(),
  code = z
    .string()
    .trim()
    .regex(/^[A-Z0-9][A-Z0-9_-]{0,29}$/),
  name = z.string().trim().min(1).max(160),
  common = {
    key: uuid,
    reference: z.string().trim().min(3).max(240),
    reason: z.string().trim().min(3).max(500),
  };
export const customerProvisionInput = z
  .object({
    ...common,
    customerCode: code,
    customerName: name,
    companyCode: code,
    companyName: name,
    estateCode: code,
    estateName: name,
    initialAdminId: uuid,
  })
  .strict();
export const companyProvisionInput = z
  .object({ ...common, customerId: uuid, companyCode: code, companyName: name })
  .strict();
export const estateProvisionInput = z
  .object({
    ...common,
    customerId: uuid,
    companyId: uuid,
    estateCode: code,
    estateName: name,
    initialManagerId: uuid,
  })
  .strict();
export const setupGrantInput = z
  .object({
    key: uuid,
    customerId: uuid,
    subjectId: uuid,
    action: z.enum(["granted", "revoked"]),
    expectedGranted: z.boolean(),
    reference: z.string().trim().min(3).max(240),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
