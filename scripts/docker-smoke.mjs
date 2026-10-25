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
  const policyPath = root + "/reconciliation/policies";
  const policyInput = {
    key: randomUUID(),
    expectedRevision: 0,
    reason: "Synthetic container policy design criteria",
    content: {
      version: 1,
      basis: "mapping-policy-r0",
      scope: "design-review-only",
      custodyCriteria:
        "Named synthetic archive custodian and controlled original",
      approverCriteria:
        "Independent scoped approver distinct from evidence actors",
      evidenceCriteria:
        "Resolve all current concerns and bind exact observation revisions",
    },
  };
  const policy = await call(policyPath, "POST", policyInput);
  const policyReplay = await call(policyPath, "POST", policyInput);
  assert.equal(policyReplay.policy.id, policy.policy.id);
  assert.equal(policyReplay.replayed, true);
  assert.equal(policy.policy.application_enabled, false);
  const recorderCandidates = await call(
    root + "/reconciliation/policy-authority/candidates",
  );
  const matchingRecorders = recorderCandidates.items.filter(
    (c) => c.name === "Development Setup Reviewer" && c.id !== login.user.id,
  );
  assert.equal(matchingRecorders.length, 1);
  const recorder = matchingRecorders[0];
  assert.ok(recorder);
  const authorityInput = {
    key: randomUUID(),
    subjectId: recorder.id,
    expectedRevision: 0,
    action: "appointed",
    authorityRef: "Synthetic container owner appointment",
    reason: "Explicit external decision recorder for container proof",
  };
  const authority = await call(
    root + "/reconciliation/policy-authority",
    "POST",
    authorityInput,
  );
  const authorityReplay = await call(
    root + "/reconciliation/policy-authority",
    "POST",
    authorityInput,
  );
  assert.equal(authorityReplay.authority.id, authority.authority.id);
  assert.equal(authorityReplay.replayed, true);
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
  const policyReviewInput = {
    key: randomUUID(),
    expectedRevision: 0,
    policySha256: policy.policy.sha256,
    outcome: "changes-requested",
    reference: "Synthetic container design workshop",
    reason:
      "Explicit custody criteria remain subject to authoritative acceptance",
  };
  const policyReview = await call(
    policyPath + "/" + policy.policy.id + "/reviews",
    "POST",
    policyReviewInput,
  );
  const policyReviewReplay = await call(
    policyPath + "/" + policy.policy.id + "/reviews",
    "POST",
    policyReviewInput,
  );
  assert.equal(policyReviewReplay.review.id, policyReview.review.id);
  assert.equal(policyReviewReplay.replayed, true);
  const policyReadiness = await call(
    evidencePath + "/" + evidence.check.id + "/readiness",
  );
  assert.equal(policyReadiness.policyReview.latest.id, policy.policy.id);
  assert.equal(policyReadiness.approvalEnabled, false);
  const acceptanceInput = {
    key: randomUUID(),
    expectedRevision: 0,
    policySha256: policy.policy.sha256,
    authorityId: authority.authority.id,
    outcome: "changes-requested",
    externalRef: "Synthetic container external owner changes",
    reason: "Recorded external changes without promoting design support",
    attested: true,
  };
  const acceptance = await call(
    policyPath + "/" + policy.policy.id + "/acceptance",
    "POST",
    acceptanceInput,
  );
  const acceptanceReplay = await call(
    policyPath + "/" + policy.policy.id + "/acceptance",
    "POST",
    acceptanceInput,
  );
  assert.equal(acceptanceReplay.acceptance.id, acceptance.acceptance.id);
  assert.equal(acceptanceReplay.replayed, true);
  const externalState = await call(
    policyPath + "/" + policy.policy.id + "/acceptance",
  );
  assert.equal(externalState.state.current, false);
  assert.equal(externalState.state.head.outcome, "changes-requested");
  const mappingPath =
    evidencePath + "/" + evidence.check.id + "/mapping-requests";
  const mappingContext = await call(mappingPath + "/context");
  assert.equal(mappingContext.binding.eligible, false);
  assert.equal(mappingContext.binding.records[0].valid, false);
  assert.equal(mappingContext.applicationEnabled, false);
  const denied = await fetch(base + mappingPath, {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: "http://localhost:5174",
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
    },
    body: JSON.stringify({
      key: randomUUID(),
      policyId: policy.policy.id,
      acceptanceId: acceptance.acceptance.id,
      previousId: null,
      custodyRef: "Synthetic blocked mapping reference",
      reason:
        "Already attributed modern row and unaccepted policy must not submit",
    }),
  });
  assert.equal(denied.status, 422);
  assert.equal((await call(mappingPath)).items.length, 0);
  await writeFile(
    ".local/docker-smoke-record.json",
    JSON.stringify({
      authorityId: authority.authority.id,
      acceptanceId: acceptance.acceptance.id,
      recorderId: recorder.id,
      policyId: policy.policy.id,
      policyReviewId: policyReview.review.id,
      policySha: policy.policy.sha256,
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

  const policyPath = `/api/estates/${saved.estateId}/reconciliation/policies/${saved.policyId}`;
  const policy = await call(policyPath),
    policyReviews = await call(policyPath + "/reviews");
  assert.equal(policy.policy.sha256, saved.policySha);
  assert.equal(policy.applicationEnabled, false);
  assert.equal(policyReviews.items.length, 1);
  assert.equal(policyReviews.items[0].id, saved.policyReviewId);
  assert.equal(policyReviews.items[0].outcome, "changes-requested");
  assert.equal(readiness.policyReview.latest.id, saved.policyId);
  const external = await call(policyPath + "/acceptance");
  assert.equal(external.items.length, 1);
  assert.equal(external.items[0].id, saved.acceptanceId);
  assert.equal(external.items[0].authority_id, saved.authorityId);
  assert.equal(external.state.current, false);
  const appointment = await call(
    `/api/estates/${saved.estateId}/reconciliation/policy-authority?subjectId=${saved.recorderId}`,
  );
  assert.equal(appointment.state.effective, true);
  assert.equal(appointment.state.current.id, saved.authorityId);
  const mappingPath =
    baseReview + "/evidence/" + saved.evidenceId + "/mapping-requests";
  const mapping = await call(mappingPath + "/context");
  assert.equal(mapping.binding.eligible, false);
  assert.equal(mapping.binding.sourceSha256, saved.sourceSha);
  assert.equal(mapping.applicationEnabled, false);
  assert.equal((await call(mappingPath)).items.length, 0);
  console.log(
    "Mapping context and blocked submission through proxy preserved original records and recovered after recreation.",
  );
  console.log(
    "Explicit policy appointment and external decision audit survived exact retry and retained-volume recreation.",
  );
  console.log(
    "Policy proposal, independent review, exact retry and retained-volume policy audit passed.",
  );

  console.log(
    "Saved draft, review/source-check/provenance audit/readiness inspection and development account survived container removal/recreation with retained volumes.",
  );
}
