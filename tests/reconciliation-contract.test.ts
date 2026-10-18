import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  reconciliationManifest,
  duplicateMappings,
  manifestDigest,
} from "../packages/domain/reconciliation";
const row = () => ({
  sourceRow: "Sheet1:2",
  kind: "task-block",
  recordId: randomUUID(),
  recordVersion: 1,
  targetId: randomUUID(),
  reason: "Reviewed source mapping",
});
const input = () => ({
  version: 1,
  source: {
    system: "Legacy export",
    documentRef: "Approved source reference",
    sha256: "A".repeat(64),
  },
  rows: [row()],
});
test("mapping contract rejects missing provenance unsupported fields unsafe versions and oversized batches", () => {
  const v = input();
  assert.equal(reconciliationManifest.parse(v).source.sha256, "a".repeat(64));
  for (const bad of [
    { ...v, source: { ...v.source, sha256: "not-a-digest" } },
    { ...v, approved: true },
    { ...v, rows: [] },
    { ...v, rows: Array.from({ length: 51 }, row) },
    { ...v, rows: [{ ...row(), recordVersion: 0 }] },
    { ...v, rows: [{ ...row(), kind: "automatic-backfill" }] },
    { ...v, rows: [{ ...row(), reason: "x" }] },
  ])
    assert.equal(reconciliationManifest.safeParse(bad).success, false);
});
test("duplicate source and record proposals mark every conflicting row rather than choosing the first", () => {
  const a = row(),
    b = { ...row(), sourceRow: a.sourceRow },
    c = { ...row(), sourceRow: "Other:3", recordId: a.recordId };
  const v = reconciliationManifest.parse({ ...input(), rows: [a, b, c] });
  assert.deepEqual(duplicateMappings(v.rows), [
    { source: true, record: true },
    { source: true, record: false },
    { source: false, record: true },
  ]);
  const identity = "12345678-abcd-4abc-8abc-123456789abc";
  const canonical = reconciliationManifest.parse({
    ...input(),
    rows: [
      { ...row(), sourceRow: "A", recordId: identity },
      { ...row(), sourceRow: "B", recordId: identity.toUpperCase() },
    ],
  });
  assert.deepEqual(duplicateMappings(canonical.rows), [
    { source: false, record: true },
    { source: false, record: true },
  ]);
});
test("validated manifest digest binds source references row reasons targets and versions", () => {
  const v = reconciliationManifest.parse(input()),
    digest = manifestDigest(v);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(
    manifestDigest(reconciliationManifest.parse(JSON.parse(JSON.stringify(v)))),
    digest,
  );
  for (const changed of [
    { ...v, source: { ...v.source, documentRef: "Other source" } },
    { ...v, rows: [{ ...v.rows[0], targetId: randomUUID() }] },
    { ...v, rows: [{ ...v.rows[0], recordVersion: 2 }] },
  ])
    assert.notEqual(manifestDigest(changed), digest);
});
