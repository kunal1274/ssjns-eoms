import { z } from "zod";
export const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024;
// Canonical base64 only: Buffer.from alone silently accepts malformed/truncated input.
export const sourceEvidenceInput = z
  .object({
    key: z
      .string()
      .uuid()
      .transform((v) => v.toLowerCase()),
    fileName: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .refine((v) => !/[\x00-\x1f\x7f/\\]/.test(v)),
    reason: z.string().trim().min(3).max(500),
    contentBase64: z
      .string()
      .min(4)
      .max(4 * Math.ceil(MAX_EVIDENCE_BYTES / 3))
      .refine((v) => {
        if (v.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(v))
          return false;
        const bytes = Buffer.from(v, "base64");
        return (
          bytes.length > 0 &&
          bytes.length <= MAX_EVIDENCE_BYTES &&
          bytes.toString("base64") === v
        );
      }),
  })
  .strict();
