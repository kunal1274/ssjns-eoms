import { z } from "zod";
import { ApiError } from "./http";
export const pageFields = {
  q: z.string().trim().max(100).default(""),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(2000).optional(),
};
const bigint = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine((s) => BigInt(s) <= 9223372036854775807n);
const schema = z
  .object({
    v: z.literal(1),
    binding: z.string().max(1000),
    key: z.string(),
    upper: z.string().optional(),
  })
  .strict();
export function readPage(
  raw: string | undefined,
  binding: object,
  history = false,
) {
  if (!raw) return null;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw Error();
    const value = schema.parse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
    );
    if (value.binding !== JSON.stringify(binding)) throw Error();
    if (history) {
      bigint.parse(value.key);
      bigint.parse(value.upper);
      if (BigInt(value.key) > BigInt(value.upper!)) throw Error();
    } else {
      z.string().uuid().parse(value.key);
      if (value.upper !== undefined) throw Error();
    }
    return value;
  } catch {
    throw new ApiError(
      422,
      "This page reference is invalid or belongs to different filters or a different account. Search again to start from the first page.",
    );
  }
}
export function pageResult(
  rows: any[],
  limit: number,
  binding: object,
  key: (row: any) => string,
  upper?: string,
) {
  const items = rows.slice(0, limit),
    more = rows.length > limit;
  return {
    items,
    nextCursor: more
      ? Buffer.from(
          JSON.stringify({
            v: 1,
            binding: JSON.stringify(binding),
            key: String(key(items.at(-1))),
            ...(upper ? { upper } : {}),
          }),
        ).toString("base64url")
      : null,
  };
}
export function literalPattern(q: string) {
  return "%" + q.replace(/[\\%_]/g, "\\$&") + "%";
}
