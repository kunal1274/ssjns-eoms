import { SourceEvidence } from "./SourceEvidence";
import { RequestFailure } from "./feedback";
import { useEffect, useRef, useState } from "react";
type Api = (path: string, body?: unknown) => Promise<any>;
export function ReconciliationJobs({
  base,
  api,
  result,
  draft,
  onLoad,
  onPending,
}: {
  base: string;
  api: Api;
  result: any;
  draft: string;
  onLoad: (value: string) => void;
  onPending: (value: boolean) => void;
}) {
  const [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [completed, setCompleted] = useState(false),
    [evidencePending, setEvidencePending] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [items, setItems] = useState<any[]>([]),
    [next, setNext] = useState<string | null>(null),
    [detail, setDetail] = useState<any>(null),
    [refresh, setRefresh] = useState(0),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [listError, setListError] = useState("");
  const epoch = useRef(0),
    live = useRef(true),
    pending = useRef<{ key: string; reason: string; manifest: any } | null>(
      null,
    );
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      epoch.current++;
    };
  }, []);
  useEffect(() => {
    if (pending.current) return;
    setCompleted(false);
    setReason("");
    setNotice("");
    setError("");
  }, [result?.requestId]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setListError("");
    setItems([]);
    setNext(null);
    api(
      base +
        "/reconciliation/jobs?limit=10" +
        (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
    )
      .then((v) => {
        if (active) {
          setItems(v.items);
          setNext(v.nextCursor);
        }
      })
      .catch((e) => {
        if (active) setListError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [base, cursor, refresh]);
  async function save() {
    if (
      busy ||
      evidencePending ||
      completed ||
      !result ||
      reason.trim().length < 3
    )
      return;
    const ticket = ++epoch.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const payload = pending.current ?? {
        key: crypto.randomUUID(),
        reason: reason.trim(),
        manifest: JSON.parse(draft),
      };
      pending.current = payload;
      onPending(true);
      const v = await api(base + "/reconciliation/jobs", payload);
      if (live.current && ticket === epoch.current) {
        setNotice(
          v.replayed
            ? "Saved review recovered. No duplicate review or audit event was created."
            : "Review saved with a fresh validation snapshot and audit event.",
        );
        setDetail({ job: v.job, audit: null });
        pending.current = null;
        setCompleted(true);
        onPending(false);
        setCursor(null);
        setRefresh((n) => n + 1);
      }
    } catch (e) {
      if (live.current && ticket === epoch.current) {
        if (e instanceof RequestFailure && e.status < 500) {
          pending.current = null;
          onPending(false);
        }
        setError(
          (e as Error).message +
            (pending.current
              ? " Retry the same save to recover a possibly completed submission; its content is kept until recovery."
              : " Review the error and submit again after correcting the issue."),
        );
      }
    } finally {
      if (live.current && ticket === epoch.current) setBusy(false);
    }
  }
  async function open(id: string) {
    const ticket = ++epoch.current;
    setBusy(true);
    setError("");
    setDetail(null);
    try {
      const v = await api(base + "/reconciliation/jobs/" + id);
      if (live.current && ticket === epoch.current) setDetail(v);
    } catch (e) {
      if (live.current && ticket === epoch.current)
        setError((e as Error).message);
    } finally {
      if (live.current && ticket === epoch.current) setBusy(false);
    }
  }
  return (
    <section aria-label="Saved reconciliation reviews">
      <h4>Save and reopen a review</h4>
      <p>
        1. Preview the manifest. 2. Explain why you are retaining it. 3. Save
        and reopen the audit. A saved review is an immutable validation
        snapshot, with unverified source evidence. It is not an approval or an
        applied correction.
      </p>
      <form
        aria-label="Save mapping review"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          Review retention reason
          <input
            aria-label="Review retention reason"
            value={reason}
            minLength={3}
            maxLength={500}
            required
            disabled={
              !result ||
              busy ||
              evidencePending ||
              completed ||
              !!pending.current
            }
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <button
          disabled={
            !result ||
            busy ||
            evidencePending ||
            completed ||
            reason.trim().length < 3
          }
        >
          Save review snapshot
        </button>
      </form>
      {busy && <p role="status">Loading or saving review…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Loading saved reviews…</p>}
      {listError && <p role="alert">{listError}</p>}
      {!loading && !listError && items.length === 0 && (
        <p>No saved reviews on this page. Preview a manifest to begin.</p>
      )}
      {items.map((j) => (
        <article className="event" key={j.id} data-review-id={j.id}>
          <div className="eventbody">
            <strong>{j.source.documentRef}</strong>
            <p>
              {j.summary.total} rows · {j.summary.blocked} blocked · Saved{" "}
              {j.created_at}
            </p>
            <p>{j.reason}</p>
            <button
              disabled={busy || evidencePending || !!pending.current}
              onClick={() => void open(j.id)}
            >
              Open saved review {j.id}
            </button>
          </div>
        </article>
      ))}
      <button
        disabled={loading || busy || evidencePending}
        onClick={() => {
          setCursor(null);
          setRefresh((n) => n + 1);
        }}
      >
        Refresh saved reviews
      </button>
      <button
        disabled={loading || busy || evidencePending || !next}
        onClick={() => setCursor(next)}
      >
        Next saved reviews
      </button>
      {detail && (
        <section aria-label="Saved review detail">
          <h5>Saved review · Requires source verification</h5>
          <p>
            {detail.job.id} · {detail.job.reason}
          </p>
          <p>
            {detail.job.snapshot.summary.total} rows ·{" "}
            {detail.job.snapshot.summary.blocked} blocked at save. Historical
            records unchanged.
          </p>
          <p>
            Saved by {detail.job.created_by} at {detail.job.created_at}. Support
            reference: {detail.job.request_id}
          </p>
          <p>
            This snapshot describes the save time. Load its manifest and preview
            again to check current versions and access.
          </p>
          <button
            disabled={busy || evidencePending || !!pending.current}
            onClick={() => {
              onLoad(JSON.stringify(detail.job.manifest, null, 2));
              setNotice(
                "Saved manifest loaded. Preview again before saving a new review.",
              );
            }}
          >
            Load saved manifest for revalidation
          </button>
          <details>
            <summary>View saved manifest and validation details</summary>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {JSON.stringify(
                {
                  manifest: detail.job.manifest,
                  snapshot: detail.job.snapshot,
                },
                null,
                2,
              )}
            </pre>
          </details>
          <SourceEvidence
            key={detail.job.id}
            path={base + "/reconciliation/jobs/" + detail.job.id + "/evidence"}
            api={api}
            onPending={setEvidencePending}
          />
          {detail.audit === null ? (
            <p>
              Open this saved review from the list to read its recorded audit
              event.
            </p>
          ) : (
            <>
              <p>Audit: {detail.audit.length} recorded event.</p>
              {detail.audit.map((a: any) => (
                <article key={a.id}>
                  <p>
                    Review saved · {a.reason} · {a.created_at}
                  </p>
                  <details>
                    <summary>View detailed review audit</summary>
                    <dl>
                      <dt>Action / event</dt>
                      <dd>
                        {a.action} · {a.id}
                      </dd>
                      <dt>Actor / support reference</dt>
                      <dd>
                        {a.actor_id} · {a.request_id}
                      </dd>
                      <dt>Validated manifest SHA-256</dt>
                      <dd style={{ overflowWrap: "anywhere" }}>
                        {a.manifest_sha256}
                      </dd>
                    </dl>
                  </details>
                </article>
              ))}
            </>
          )}
        </section>
      )}
    </section>
  );
}
