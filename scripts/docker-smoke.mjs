import { readFile, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
const mode = process.argv[2];
if (!["create", "verify"].includes(mode))
  throw Error("Use create or verify. Synthetic development data only.");
const base = process.env.SMOKE_BASE_URL || "http://localhost:5174";
const accounts = JSON.parse(await readFile(".local/dev-accounts.json", "utf8"));
const account = accounts.find((a) => a.role === "manager");
if (!account) throw Error("Run the explicit synthetic seed first.");
let cookie = "",
  csrf = "";
async function call(path, method = "GET", body, extra = {}) {
  const r = await fetch(base + path, {
    method,
    signal: AbortSignal.timeout(10000),
    headers: {
      Cookie: cookie,
      Origin: "http://localhost:5174",
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (path === "/api/auth/login" && r.ok)
    cookie = r.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  if (!r.ok) throw Error(`Container smoke ${method} ${path}: HTTP ${r.status}`);
  return r.json();
}
const health = await call("/api/health");
assert.equal(health.service, "eoms-api");
const login = await call("/api/auth/login", "POST", {
  email: account.email,
  password: account.password,
});
csrf = login.csrf;
if (mode === "create") {
  const estates = await call("/api/estates");
  const estate = estates.find((e) => e.code === "SN");
  assert.ok(estate);
  const root = `/api/estates/${estate.id}`;
  const workers = await call(root + "/workers");
  const tasks = await call(root + "/occurrences");
  assert.ok(workers.length && tasks.length);
  const key = randomUUID();
  const body = {
    occurrenceId: tasks[0].id,
    businessDate: "2026-09-28",
    gangCode: "G-01",
    quantityHa: 0.01,
    workerIds: [workers[0].id],
  };
  const saved = await call(root + "/musters", "POST", body, {
    "Idempotency-Key": key,
  });
  assert.ok(saved.id);
  const replay = await call(root + "/musters", "POST", body, {
    "Idempotency-Key": key,
  });
  assert.equal(replay.id, saved.id);
  const sourceBytes = Buffer.alloc(2 * 1024 * 1024, 73),
    sourceSha = createHash("sha256").update(sourceBytes).digest("hex");
  const work = await call(root + "/musters/" + saved.id);
  const review = await call(root + "/reconciliation/jobs", "POST", {
    key: randomUUID(),
    reason: "Container source-check persistence fixture",
    manifest: {
      version: 1,
      source: {
        system: "Synthetic container source",
        documentRef: "Container retained-volume check",
        sha256: sourceSha,
      },
      rows: [
        {
          sourceRow: "A:2",
          kind: "work-company",
          recordId: saved.id,
          recordVersion: work.version,
          targetId: work.legal_company_id,
          reason: "Synthetic comparison only; no attribution changes",
        },
      ],
    },
  });
  const evidencePath =
      root + "/reconciliation/jobs/" + review.job.id + "/evidence",
    evidenceInput = {
      key: randomUUID(),
      fileName: "container-source.bin",
      reason: "Synthetic two MiB proxy and persistence check",
      contentBase64: sourceBytes.toString("base64"),
    };
  const evidence = await call(evidencePath, "POST", evidenceInput),
    evidenceReplay = await call(evidencePath, "POST", evidenceInput);
  assert.equal(evidence.check.computed_sha256, sourceSha);
  assert.equal(evidence.check.matches_declared, true);
  assert.equal(evidence.check.source_authenticity_verified, false);
  assert.equal(evidenceReplay.check.id, evidence.check.id);
  assert.equal(evidenceReplay.replayed, true);
  const independent = accounts.find((a) => a.email === "reviewer@eoms.local");
  assert.ok(independent);
  const reviewerLogin = await call("/api/auth/login", "POST", {
    email: independent.email,
    password: independent.password,
  });
  csrf = reviewerLogin.csrf;
  const provenancePath = evidencePath + "/" + evidence.check.id + "/reviews",
    provenanceInput = {
      key: randomUUID(),
      expectedRevision: 0,
      outcome: "corroborated",
      originalExamined: true,
      sourceRef: "Synthetic container controlled archive",
      reason: "Independent fixture reviewer examined synthetic source",
    };
  const provenance = await call(provenancePath, "POST", provenanceInput),
    provenanceReplay = await call(provenancePath, "POST", provenanceInput);
  assert.equal(provenance.review.revision, 1);
  assert.equal(provenanceReplay.review.id, provenance.review.id);
  assert.equal(provenanceReplay.replayed, true);
  const readiness = await call(
    evidencePath + "/" + evidence.check.id + "/readiness",
  );
  assert.equal(readiness.policy.status, "draft-not-approved");
  assert.equal(readiness.approvalEnabled, false);
  assert.equal(readiness.applicationEnabled, false);
  assert.equal(readiness.observations.total, 1);
  assert.equal(readiness.observations.authorizedCorroborated, 1);
  await writeFile(
    ".local/docker-smoke-record.json",
    JSON.stringify({
      estateId: estate.id,
      id: saved.id,
      jobId: review.job.id,
      evidenceId: evidence.check.id,
      sourceSha,
      provenanceId: provenance.review.id,
    }),
    { mode: 0o600 },
  );
  console.log(
    "Container proxy, database health, login, draft/review capture, two MiB source upload, independent observation, read-only readiness and duplicate replay passed.",
  );
} else {
  const saved = JSON.parse(
    await readFile(".local/docker-smoke-record.json", "utf8"),
  );
  const result = await call(
    `/api/estates/${saved.estateId}/musters/${saved.id}`,
  );
  assert.equal(result.id, saved.id);
  assert.equal(result.status, "draft");
  const baseReview = `/api/estates/${saved.estateId}/reconciliation/jobs/${saved.jobId}`;
  const review = await call(baseReview),
    checks = await call(baseReview + "/evidence");
  assert.equal(review.job.id, saved.jobId);
  assert.equal(review.job.snapshot.sourceEvidenceVerified, false);
  assert.equal(review.audit.length, 1);
  assert.equal(checks.items.length, 1);
  assert.equal(checks.items[0].id, saved.evidenceId);
  assert.equal(checks.items[0].computed_sha256, saved.sourceSha);
  assert.equal(checks.items[0].source_authenticity_verified, false);
  const observations = await call(
    baseReview + "/evidence/" + saved.evidenceId + "/reviews",
  );
  assert.equal(observations.items.length, 1);
  assert.equal(observations.items[0].id, saved.provenanceId);
  assert.equal(observations.items[0].outcome, "corroborated");
  assert.equal(observations.context.canRecord, false);
  const readiness = await call(
    baseReview + "/evidence/" + saved.evidenceId + "/readiness",
  );
  assert.equal(readiness.approvalEnabled, false);
  assert.equal(readiness.applicationEnabled, false);
  assert.equal(readiness.observations.total, 1);
  assert.equal(readiness.observations.items[0].id, saved.provenanceId);
  assert.ok(readiness.findings.some((f) => f.code === "POLICY_NOT_APPROVED"));

  console.log(
    "Saved draft, review/source-check/provenance audit/readiness inspection and development account survived container removal/recreation with retained volumes.",
  );
}
