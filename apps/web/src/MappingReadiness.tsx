import { useEffect, useRef, useState } from "react";
type Api = (path: string, body?: unknown) => Promise<any>;
export function MappingReadiness({ path, api }: { path: string; api: Api }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [report, setReport] = useState<any>(null),
    [attempt, setAttempt] = useState(0);
  const epoch = useRef(0);
  useEffect(() => {
    let live = true;
    const ticket = ++epoch.current;
    setBusy(true);
    setError("");
    setReport(null);
    api(path)
      .then((v) => {
        if (live && epoch.current === ticket) setReport(v);
      })
      .catch((e) => {
        if (live && epoch.current === ticket) setError(e.message);
      })
      .finally(() => {
        if (live && epoch.current === ticket) setBusy(false);
      });
    return () => {
      live = false;
      epoch.current++;
    };
  }, [path, attempt]);
  return (
    <section aria-label="Mapping readiness inspection">
      <h5>Inspect mapping readiness</h5>
      <p>
        Inspect current records and the latest observation from each reviewer
        for this selected source check. This read-only report is not a stored
        decision, approval or application. Refresh after a record, reviewer
        observation or permission changes.
      </p>
      <button disabled={busy} onClick={() => setAttempt((n) => n + 1)}>
        Refresh mapping readiness
      </button>
      {busy && (
        <p role="status">
          Inspecting current records and provenance observations…
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {report && (
        <>
          <p role="status">
            {report.current.summary.total} rows ·{" "}
            {report.current.summary.blocked} currently blocked ·{" "}
            {report.changedRows.length} record changes since save. Approval and
            application disabled.
          </p>
          <p>
            Saved snapshot: {report.saved.summary.blocked} blocked at save.
            Current records require separate transactional revalidation before
            any governed write.
          </p>
          <p>
            Selected source:{" "}
            {report.evidence.matches_declared
              ? "Bytes match declaration"
              : "Digest mismatch"}
            . Source authenticity remains unverified.
          </p>
          <p>
            Current observations: {report.observations.total} · corroborated{" "}
            {report.observations.corroborated} · concerns{" "}
            {report.observations.concerns} · insufficient{" "}
            {report.observations.insufficient} · reviewer access changed{" "}
            {report.observations.authorizationChanged}.
          </p>
          <p>
            Recorded statements stay visible when reviewer access changes. No
            positive statement cancels another reviewer's concern.
          </p>
          <ol>
            {report.findings.map((f: any) => (
              <li key={f.code} data-readiness-finding={f.code}>
                {f.message}
              </li>
            ))}
          </ol>
          {report.current.rows.map((r: any, i: number) => (
            <article key={i} data-readiness-row={i}>
              <strong>
                {r.sourceRow} · {r.kind} ·{" "}
                {r.status === "blocked"
                  ? "Blocked"
                  : "Requires governed decision"}
              </strong>
              {r.issues.map((issue: any) => (
                <p key={issue.code}>{issue.message}</p>
              ))}
              <details>
                <summary>View current mapping inspection</summary>
                <p>
                  Record {r.recordId} · Proposed version {r.recordVersion} ·
                  Current version {r.current?.version ?? "Unavailable"}
                </p>
                <p>
                  Proposed target: {r.target?.name ?? "Unavailable in scope"} ·{" "}
                  {r.targetId}
                </p>
                <p>{r.action}</p>
              </details>
            </article>
          ))}
          <details>
            <summary>View readiness provenance</summary>
            <dl>
              <dt>Started / completed</dt>
              <dd>
                {report.startedAt} · {report.evaluatedAt}
              </dd>
              <dt>Actor / support reference</dt>
              <dd>
                {report.actorId} · {report.requestId}
              </dd>
              <dt>Estate / saved review / source check</dt>
              <dd>
                {report.estateId} · {report.jobId} · {report.checkId}
              </dd>
              <dt>Saved manifest SHA-256</dt>
              <dd style={{ overflowWrap: "anywhere" }}>
                {report.manifestSha256}
              </dd>
            </dl>
            <p>
              The inspection spans a read window and is not an atomic write
              authorization. It creates no approval audit event.
            </p>
          </details>
          <details>
            <summary>View current reviewer observations</summary>
            {report.observations.items.map((o: any) => (
              <article key={o.id} data-readiness-observation={o.id}>
                <p>
                  {o.reviewer} · {o.outcome} · Revision {o.revision} ·{" "}
                  {o.currently_authorized
                    ? "Review authority current"
                    : "Review authority changed"}
                </p>
                <p>
                  {o.source_ref} · {o.reason}
                </p>
                <p>
                  Reviewer {o.reviewer_id} · Observation {o.id} · Support{" "}
                  {o.request_id}
                </p>
              </article>
            ))}
            {report.observations.truncated && (
              <p>
                Showing 25 observations. Totals and findings include all current
                reviewer observations; open provenance history for full detail.
              </p>
            )}
          </details>
          <details>
            <summary>View proposed mapping policy R0</summary>
            <p>
              Draft — owner review required. Approval enabled: No. Application
              enabled: No.
            </p>
            <p>
              Recorded design proposal:{" "}
              {report.policyReview.latest
                ? `Version ${report.policyReview.latest.revision} · ${report.policyReview.latest.id}`
                : "None"}
              . Individual design reviews do not activate policy. Open Mapping
              policy design review in the source mapping panel to inspect
              criteria and history.
            </p>
            {report.policyReview.acceptance && (
              <p>
                External decision:{" "}
                {report.policyReview.acceptance.head?.outcome ??
                  "None recorded"}{" "}
                ·{" "}
                {report.policyReview.acceptance.current
                  ? "Recorded acceptance current"
                  : "No current acceptance"}
                . Open design concerns:{" "}
                {report.policyReview.acceptance.openDesignConcerns}. This record
                does not enable mapping application.
              </p>
            )}
            <p>{report.policy.approach}</p>
            <p>{report.policy.next}</p>
            <p>
              Proposed sequence: resolve current validation issues → resolve
              provenance concerns → bind a separately approved decision to exact
              records and policy → revalidate before application. No part of
              this report activates that workflow.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
