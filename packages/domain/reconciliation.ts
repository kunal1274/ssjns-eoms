import { z } from "zod";
import { createHash } from "node:crypto";
export const reconciliationManifest = z
  .object({
    version: z.literal(1),
    source: z
      .object({
        system: z.string().trim().min(1).max(80),
        documentRef: z.string().trim().min(1).max(160),
        sha256: z
          .string()
          .toLowerCase()
          .regex(/^[0-9a-f]{64}$/),
      })
      .strict(),
    rows: z
      .array(
        z
          .object({
            sourceRow: z.string().trim().min(1).max(80),
            kind: z.enum(["task-block", "work-company"]),
            recordId: z.string().uuid().toLowerCase(),
            recordVersion: z.number().int().positive(),
            targetId: z.string().uuid().toLowerCase(),
            reason: z.string().trim().min(3).max(500),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
export type ReconciliationManifest = z.infer<typeof reconciliationManifest>;
export function duplicateMappings(rows: ReconciliationManifest["rows"]) {
  const sources = new Map<string, number>(),
    records = new Map<string, number>();
  for (const r of rows) {
    sources.set(r.sourceRow, (sources.get(r.sourceRow) || 0) + 1);
    const key = r.kind + ":" + r.recordId;
    records.set(key, (records.get(key) || 0) + 1);
  }
  return rows.map((r) => ({
    source: (sources.get(r.sourceRow) || 0) > 1,
    record: (records.get(r.kind + ":" + r.recordId) || 0) > 1,
  }));
}
export function manifestDigest(value: ReconciliationManifest) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
