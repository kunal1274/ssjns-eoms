import { useEffect, useRef, useState } from "react";
import { RequestFailure } from "./feedback";
type Api = (path: string, body?: unknown) => Promise<any>;
const labels: Record<string, string> = {
  corroborated: "Provenance corroborated by reviewer",
  concerns: "Provenance concerns",
  insufficient: "Insufficient evidence",
};
export function SourceReview({
  path,
  api,
  onPending,
}: {
  path: string;
  api: Api;
  onPending: (v: boolean) => void;
}) {
  const [outcome, setOutcome] = useState("insufficient"),
    [examined, setExamined] = useState(false),
    [sourceRef, setSourceRef] = useState(""),
    [reason, setReason] = useState(""),
    [data, setData] = useState<any>(null),
    [cursor, setCursor] = useState<string | null>(null),
    [refresh, setRefresh] = useState(0),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [readError, setReadError] = useState(""),
    [notice, setNotice] = useState("");
  const live = useRef(true),
    payload = useRef<any>(null),
    epoch = useRef(0);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      epoch.current++;
      onPending(false);
    };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setReadError("");
    setData(null);
    api(
      path +
        "?limit=10" +
        (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
    )
      .then((v) => {
        if (active) setData(v);
      })
      .catch((e) => {
        if (active) setReadError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, cursor, refresh]);
  const valid =
    data?.context.canRecord &&
    sourceRef.trim().length >= 3 &&
    reason.trim().length >= 3 &&
    (outcome !== "corroborated" || (examined && data.context.canCorroborate));
  async function submit() {
    if (busy || loading || !valid) return;
    const ticket = ++epoch.current;
    setBusy(true);
    setError("");
    setNotice("");
    payload.current ??= {
      key: crypto.randomUUID(),
      expectedRevision: data.context.ownRevision,
      outcome,
      originalExamined: examined,
      sourceRef: sourceRef.trim(),
      reason: reason.trim(),
    };
    setPending(true);
    onPending(true);
    try {
      const v = await api(path, payload.current);
      if (live.current && ticket === epoch.current) {
        setNotice(
          (v.replayed
            ? "Review recovered. "
            : "Independent review recorded. ") +
            "Revision " +
            v.review.revision +
            ". This human statement does not approve mappings or machine-authenticate the source.",
        );
        payload.current = null;
        setPending(false);
        onPending(false);
        setOutcome("insufficient");
        setExamined(false);
        setSourceRef("");
        setReason("");
        setCursor(null);
        setRefresh((n) => n + 1);
      }
    } catch (e) {
      if (live.current && ticket === epoch.current) {
        const uncertain = !(e instanceof RequestFailure) || e.status >= 500;
        if (!uncertain) {
          payload.current = null;
          setPending(false);
          onPending(false);
        }
        setError(
          (e as Error).message +
            (uncertain
              ? " Retry the same review to recover a possibly committed revision; its fields are locked until recovery."
              : " Refresh review history, inspect your current revision and correct the form before trying again."),
        );
      }
    } finally {
      if (live.current && ticket === epoch.current) setBusy(false);
    }
  }
  return (
    <section aria-label="Independent provenance review">
      <h5>Independent provenance review</h5>
      <ol>
        <li>
          A separately authorized reviewer examines the controlled original and
          its provenance outside this app.
        </li>
        <li>
          Record the controlled document reference, examination statement,
          outcome and reason.
        </li>
        <li>
          Reopen the recorded audit. To correct your observation, refresh and
          save a new revision; previous revisions remain visible.
        </li>
      </ol>
      <p>
        This is a non-authorizing human observation. It does not certify
        authenticity, approve a mapping or change historical facts. The preparer
        and source uploader may read reviews but cannot record an independent
        review of their own evidence.
      </p>
      {loading && (
        <p role="status">Loading provenance review access and history…</p>
      )}
      {readError && <p role="alert">{readError}</p>}
      {data && (
        <>
          <p>
            Reviewing {data.context.source.fileName} ·{" "}
            {data.context.source.documentRef}
          </p>
          <details>
            <summary>View source identity for review</summary>
            <p>
              Check {data.context.source.checkId} · Saved review{" "}
              {data.context.source.jobId}
            </p>
            <p style={{ overflowWrap: "anywhere" }}>
              Source SHA-256: {data.context.source.sha256}
            </p>
            <p style={{ overflowWrap: "anywhere" }}>
              Manifest SHA-256: {data.context.source.manifestSha256}
            </p>
          </details>
          <p>Your current review revision: {data.context.ownRevision}</p>
          {data.context.blockers.map((b: string) => (
            <p key={b}>{b}</p>
          ))}
          {!data.context.canCorroborate && data.context.canRecord && (
            <p>
              A digest mismatch cannot be corroborated. Record concerns or
              insufficient evidence and resolve the original source separately.
            </p>
          )}
        </>
      )}
      <form
        aria-label="Record provenance observation"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset
          disabled={
            loading ||
            !!readError ||
            !data?.context.canRecord ||
            busy ||
            pending
          }
        >
          <label>
            Review outcome
            <select
              aria-label="Review outcome"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
            >
              <option value="insufficient">Insufficient evidence</option>
              <option value="concerns">Provenance concerns</option>
              <option
                value="corroborated"
                disabled={!data?.context.canCorroborate}
              >
                Provenance corroborated by reviewer
              </option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              aria-label="I examined the controlled original and its provenance"
              checked={examined}
              onChange={(e) => setExamined(e.target.checked)}
            />
            I examined the controlled original and its provenance
          </label>
          <label>
            Controlled document reference
            <input
              aria-label="Controlled document reference"
              value={sourceRef}
              required
              minLength={3}
              maxLength={240}
              onChange={(e) => setSourceRef(e.target.value)}
            />
          </label>
          <label>
            Provenance review reason
            <textarea
              aria-label="Provenance review reason"
              value={reason}
              required
              minLength={3}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </fieldset>
        <button disabled={busy || loading || !!readError || !valid}>
          Record provenance observation
        </button>
      </form>
      {busy && <p role="status">Recording provenance observation…</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!loading && data && !data.items.length && (
        <p>No provenance observations on this page.</p>
      )}
      {data?.items.map((r: any) => (
        <article key={r.id} data-source-review-id={r.id} className="event">
          <div className="eventbody">
            <strong>
              {labels[r.outcome]} · Revision {r.revision} ·{" "}
              {r.is_current
                ? "Current for this reviewer"
                : "Superseded by later revision"}
            </strong>
            <p>
              {r.reason} · {r.created_at}
            </p>
            <p>Controlled reference: {r.source_ref}</p>
            <p>
              Human observation only. Source authenticity is not
              machine-verified; no mapping approved.
            </p>
            <details>
              <summary>View detailed provenance review</summary>
              <dl>
                <dt>Review / previous revision</dt>
                <dd>
                  {r.id} · {r.previous_id ?? "First observation"}
                </dd>
                <dt>Reviewer / original examined</dt>
                <dd>
                  {r.reviewer_id} ·{" "}
                  {r.original_examined ? "Yes, as declared by reviewer" : "No"}
                </dd>
                <dt>Support reference</dt>
                <dd>{r.request_id}</dd>
                <dt>Source check / saved manifest</dt>
                <dd>
                  {r.evidence_id} · {r.job_id}
                </dd>
                <dt>Source / manifest SHA-256</dt>
                <dd style={{ overflowWrap: "anywhere" }}>
                  {r.evidence_sha256} · {r.manifest_sha256}
                </dd>
              </dl>
            </details>
          </div>
        </article>
      ))}
      <button
        disabled={loading || busy || pending}
        onClick={() => {
          setCursor(null);
          setRefresh((n) => n + 1);
        }}
      >
        Refresh provenance reviews
      </button>
      <button
        disabled={loading || busy || pending || !data?.nextCursor}
        onClick={() => setCursor(data.nextCursor)}
      >
        Next provenance reviews
      </button>
    </section>
  );
}
