import { z } from "zod";
import { ApiError } from "./http";
const cursor = z
  .object({
    v: z.literal(1),
    binding: z.string().max(1000),
    kind: z.enum([
      "customer",
      "group",
      "company",
      "area",
      "estate",
      "unit",
      "site",
    ]),
    id: z.string().uuid(),
  })
  .strict();
export function readHierarchyPage(raw: string | undefined, binding: object) {
  if (!raw) return null;
  try {
    if (!/^[A-Za-z0-9_-]{1,2000}$/.test(raw)) throw Error();
    const p = cursor.parse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
    );
    if (p.binding !== JSON.stringify(binding)) throw Error();
    return p;
  } catch {
    throw new ApiError(
      422,
      "This hierarchy page belongs to different filters or account, or is invalid. Refresh from the first page.",
    );
  }
}
export function hierarchyPage(rows: any[], limit: number, binding: object) {
  const items = rows.slice(0, limit),
    last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > limit
        ? Buffer.from(
            JSON.stringify({
              v: 1,
              binding: JSON.stringify(binding),
              kind: last.kind,
              id: last.id,
            }),
          ).toString("base64url")
        : null,
  };
}
