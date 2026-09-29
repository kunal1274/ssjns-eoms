/** Quantities cross the API as decimal Ha; allocations use integer hundredths. */
export function allocateHundredths(
  quantity: number,
  workerIds: string[],
): Record<string, number> {
  const total = Math.round(quantity * 100);
  if (
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    quantity > 1000000 ||
    Math.abs(quantity * 100 - total) > 1e-7
  )
    throw Error("Quantity must be positive with at most two decimal places.");
  if (!workerIds.length || new Set(workerIds).size !== workerIds.length)
    throw Error("Select unique workers.");
  const base = Math.floor(total / workerIds.length),
    extra = total % workerIds.length;
  return Object.fromEntries(
    workerIds.map((id, i) => [id, base + (i < extra ? 1 : 0)]),
  );
}
