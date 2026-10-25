import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
import { upgradedWorkFixture } from "./upgraded-work-fixture";
import { independentSourceReviewer } from "./source-review-fixture";
export async function mappingWorkflowFixture() {
  const f = await upgradedWorkFixture({ setupAdmin: true });
  try {
    const peer = await independentSourceReviewer(f),
      decider = await independentSourceReviewer(f);
    async function call(
      suffix: string,
      body?: any,
      raw = f.raw,
      estate = f.estate,
    ) {
      return fetch(
        f.apiURL + `/api/estates/${estate}/reconciliation/` + suffix,
        {
          method: body ? "POST" : "GET",
          headers: {
            Cookie: "eoms_session=" + raw,
            Origin: "http://localhost:5284",
            "Content-Type": "application/json",
            "X-CSRF-Token": "synthetic-history-ui",
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
    }
    async function post(suffix: string, body: any, raw = f.raw) {
      const r = await call(suffix, body, raw);
      assert.equal(r.status, 200, `${suffix}: HTTP${r.status}`);
      return (await r.json()) as any;
    }
    const policy = (
      await post("policies", {
        key: randomUUID(),
        expectedRevision: 0,
        reason: "Synthetic mapping decision policy",
        content: {
          version: 1,
          basis: "mapping-policy-r0",
          scope: "design-review-only",
          custodyCriteria:
            "Named controlled original archive and custody chain",
          approverCriteria:
            "Explicit separate scoped decision recorder excludes evidence actors",
          evidenceCriteria:
            "All current observations corroborate controlled source with no concerns",
        },
      })
    ).policy;
    const recorder = (
      await post("policy-authority", {
        key: randomUUID(),
        subjectId: peer.id,
        expectedRevision: 0,
        action: "appointed",
        authorityRef: "Synthetic owner delegated policy recorder",
        reason: "Separate external policy recorder appointment",
      })
    ).authority;
    const acceptance = (
      await post(
        `policies/${policy.id}/acceptance`,
        {
          key: randomUUID(),
          expectedRevision: 0,
          policySha256: policy.sha256,
          authorityId: recorder.id,
          outcome: "accepted-externally",
          externalRef: "Synthetic external owner accepted exact policy",
          reason: "Recorder examined synthetic policy reference",
          attested: true,
        },
        peer.raw,
      )
    ).acceptance;
    const bytes = Buffer.from(
        "Synthetic controlled historical attribution source",
      ),
      sha = createHash("sha256").update(bytes).digest("hex");
    const manifest = {
      version: 1,
      source: {
        system: "Synthetic mapping source",
        documentRef: "Controlled archive mapping original",
        sha256: sha,
      },
      rows: [
        {
          sourceRow: "A:2",
          kind: "work-company",
          recordId: f.target,
          recordVersion: 1,
          targetId: f.company,
          reason:
            "Inspect historical company attribution without rewriting facts",
        },
      ],
    };
    const job = (
      await post("jobs", {
        key: randomUUID(),
        reason: "Save controlled mapping proposal",
        manifest,
      })
    ).job;
    const check = (
      await post(`jobs/${job.id}/evidence`, {
        key: randomUUID(),
        fileName: "mapping-original.bin",
        reason: "Compare controlled original bytes",
        contentBase64: bytes.toString("base64"),
      })
    ).check;
    const observe = async (outcome = "corroborated", expectedRevision = 0) =>
      post(
        `jobs/${job.id}/evidence/${check.id}/reviews`,
        {
          key: randomUUID(),
          expectedRevision,
          outcome,
          originalExamined: true,
          sourceRef: "Synthetic controlled source custody reference",
          reason: "Independent provenance observation for mapping decision",
        },
        peer.raw,
      );
    await observe();
    const appointInput = (
      subjectId = decider.id,
      expectedRevision = 0,
      action = "appointed",
    ) => ({
      key: randomUUID(),
      subjectId,
      expectedRevision,
      policyId: policy.id,
      acceptanceId: acceptance.id,
      action,
      reference: "Synthetic owner mapping decision appointment",
      reason: "Explicit decision recorder independent of source actors",
    });
    const appointment = (await post("mapping-authority", appointInput()))
      .appointment;
    const sourcePath = `jobs/${job.id}/evidence/${check.id}/mapping-requests`;
    const requestInput = (previousId: string | null = null) => ({
      key: randomUUID(),
      policyId: policy.id,
      acceptanceId: acceptance.id,
      previousId,
      custodyRef: "Synthetic controlled document chain and authority reference",
      reason: "Request independent historical mapping decision",
    });
    const decisionInput = (
      outcome = "approved",
      expectedRevision = 0,
      appointmentId = appointment.id,
    ) => ({
      key: randomUUID(),
      expectedRevision,
      appointmentId,
      outcome,
      reference: "Synthetic independent decision reference",
      reason: "Examined exact bound source records policy and observations",
      examined: true,
    });
    return {
      f,
      peer,
      decider,
      policy,
      acceptance,
      appointment,
      job,
      check,
      manifest,
      bytes,
      sourcePath,
      call,
      post,
      observe,
      appointInput,
      requestInput,
      decisionInput,
    };
  } catch (e) {
    await f.close();
    throw e;
  }
}
