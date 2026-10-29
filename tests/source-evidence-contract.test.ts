import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  sourceEvidenceInput,
  MAX_EVIDENCE_BYTES,
} from "../packages/domain/source-evidence";
const input = () => ({
  key: randomUUID(),
  fileName: "Original source.pdf",
  reason: "Compare controlled export reference",
  contentBase64: Buffer.from([0, 255, 1, 128]).toString("base64"),
});
test("source check schema accepts canonical binary and normalizes retry identity without trusting caller digest or match claims", () => {
  const v = input();
  assert.equal(
    sourceEvidenceInput.parse({ ...v, key: v.key.toUpperCase() }).key,
    v.key,
  );
  for (const extra of [
    { digest: "a".repeat(64) },
    { matchesDeclared: true },
    { sourceAuthenticityVerified: true },
    { actorId: randomUUID() },
  ])
    assert.equal(
      sourceEvidenceInput.safeParse({ ...v, ...extra }).success,
      false,
    );
});
test("source check schema rejects truncated malformed noncanonical or empty base64 and unsafe file metadata", () => {
  const v = input();
  for (const contentBase64 of [
    "",
    "A",
    "AA",
    "AAA",
    "AA=",
    "AAAA=",
    "AAAA====",
    "AA A",
    "@@==",
    "AB==",
    "AAB=",
    "a\n==",
  ])
    assert.equal(
      sourceEvidenceInput.safeParse({ ...v, contentBase64 }).success,
      false,
      contentBase64,
    );
  for (const fileName of [
    "",
    "../file.pdf",
    "folder\\file.pdf",
    "bad\nfile",
    "x".repeat(161),
  ])
    assert.equal(
      sourceEvidenceInput.safeParse({ ...v, fileName }).success,
      false,
    );
  assert.equal(
    sourceEvidenceInput.safeParse({ ...v, reason: "x" }).success,
    false,
  );
});
test("source check schema enforces the actual decoded two MiB boundary including valid padding", () => {
  const v = input(),
    max = Buffer.alloc(MAX_EVIDENCE_BYTES, 255);
  assert.equal(
    sourceEvidenceInput.safeParse({
      ...v,
      contentBase64: max.toString("base64"),
    }).success,
    true,
  );
  assert.equal(
    sourceEvidenceInput.safeParse({
      ...v,
      contentBase64: Buffer.alloc(MAX_EVIDENCE_BYTES + 1).toString("base64"),
    }).success,
    false,
  );
});
