import { useEffect, useRef, useState } from "react";
type Api = (path: string, body?: unknown) => Promise<any>;
export function DecisionLedger({
  api,
  path,
  label,
  kind,
  refreshKey,
  onChoose,
  choiceLabel,
  disabled = false,
}: {
  api: Api;
  path: string;
  label: string;
  kind: "responsibility" | "cancellation" | "move";
  refreshKey?: string | number;
  onChoose?: (row: any) => void;
  choiceLabel?: string;
  disabled?: boolean;
}) {
  const [term, setTerm] = useState(""),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [rows, setRows] = useState<any[]>([]),
    [next, setNext] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [failedMore, setFailedMore] = useState(false),
    [attempt, setAttempt] = useState(0);
  const apiRef = useRef(api),
    generation = useRef(0),
    contextRef = useRef("");
  apiRef.current = api;
  const context = JSON.stringify([path, query, status, refreshKey]);
  contextRef.current = context;
  async function read(more = false) {
    const id = ++generation.current,
      started = context;
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({ q: query, status, limit: "25" });
      if (more && next) params.set("cursor", next);
      const result = await apiRef.current(path + "?" + params);
      if (id !== generation.current || started !== contextRef.current) return;
      setRows((old) =>
        more
          ? [
              ...new Map(
                [...old, ...result.items].map((r) => [r.id, r]),
              ).values(),
            ]
          : result.items,
      );
      setNext(result.nextCursor);
    } catch (e) {
      if (id === generation.current && started === contextRef.current) {
        setError((e as Error).message);
        setFailedMore(more);
      }
    } finally {
      if (id === generation.current && started === contextRef.current)
        setBusy(false);
    }
  }
  useEffect(() => {
    setRows([]);
    setNext(null);
    void read();
    return () => {
      generation.current++;
    };
  }, [path, query, status, refreshKey, attempt]);
  return (
    <section className="editor" aria-label={label}>
      <h4>{label}</h4>
      <p>
        Search by reason, record ID, company or estate where applicable, actor,
        or support reference. Pages retain the first page's request boundary.
        Decisions and access are checked again on every read; refresh to include
        newer requests and current decisions. This view is not a point-in-time
        legal snapshot.
      </p>
      <p>
        {kind === "responsibility"
          ? "Only an unused approved-cancelled change can be used for correction."
          : "Only pending requests from another administrator can be sent for independent review. Decided requests remain readable."}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (term.trim() === query) setAttempt((n) => n + 1);
          else setQuery(term.trim());
        }}
      >
        <label>
          Search {label}
          <input
            aria-label={"Search " + label}
            maxLength={100}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </label>
        <label>
          {label} status
          <select
            aria-label={label + " status"}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">All records</option>
            {(kind === "responsibility"
              ? ["active", "cancelled"]
              : ["pending", "approved", "rejected"]
            ).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button disabled={busy}>Find {label}</button>{" "}
        <button
          type="button"
          disabled={busy}
          onClick={() => setAttempt((n) => n + 1)}
        >
          Refresh {label}
        </button>
      </form>
      {busy && <p role="status">Loading {label}…</p>}
      {error && (
        <p role="alert" className="error">
          {error}{" "}
          <button
            type="button"
            disabled={busy}
            onClick={() => void read(failedMore)}
          >
            Retry {label}
          </button>
        </p>
      )}
      {!busy && !error && !rows.length && (
        <p>
          No matching permitted records. Clear the search or change status; no
          record is selected automatically.
        </p>
      )}
      {rows.map((row) => (
        <article key={row.id} className="event" data-ledger-record={row.id}>
          <div className="eventbody">
            <strong>
              {row.status} · {row.name}
            </strong>
            <p>
              {row.reason} ·{" "}
              {row.actor || row.requester || "Actor not recorded"} ·{" "}
              {new Date(row.created_at).toLocaleString()}
            </p>
            {row.decision && (
              <p>
                {row.decision} · {row.reviewer} · {row.decision_reason}
              </p>
            )}
            {onChoose && (
              <button
                type="button"
                disabled={busy || disabled || !!error || !row.choice_eligible}
                onClick={() => onChoose(row)}
              >
                {choiceLabel}
              </button>
            )}
            <details>
              <summary>View ledger audit details</summary>
              <dl className="auditdetails">
                <dt>Record / estate / actor</dt>
                <dd>
                  {row.id} · {row.estate_id} ·{" "}
                  {row.actor_id || row.requester_id || "Not recorded"}
                </dd>
                {kind === "responsibility" ? (
                  <>
                    <dt>Previous / responsible company</dt>
                    <dd>
                      {row.previous_company_name} · {row.previous_company_id} →{" "}
                      {row.company_name} · {row.company_id}
                    </dd>
                    <dt>Effective date / revision / replacement source</dt>
                    <dd>
                      {row.effective_from} · {row.revision} ·{" "}
                      {row.replaces_responsibility_id || "No replacement"}
                    </dd>
                  </>
                ) : (
                  <>
                    <dt>Requested revision or placement version</dt>
                    <dd>{row.expected_revision ?? row.expected_version}</dd>
                    {kind === "move" ? (
                      <>
                        <dt>Source / destination</dt>
                        <dd>
                          {row.from_area_name ||
                            (row.from_area_id
                              ? "Area outside current visibility"
                              : "Customer root")}{" "}
                          · {row.from_area_id || "Root"} →{" "}
                          {row.to_area_name ||
                            (row.to_area_id
                              ? "Area outside current visibility"
                              : "Customer root")}{" "}
                          · {row.to_area_id || "Root"}
                        </dd>
                      </>
                    ) : (
                      <>
                        <dt>Original responsibility change</dt>
                        <dd>{row.responsibility_id}</dd>
                      </>
                    )}
                    <dt>Decision / reviewer / recorded time</dt>
                    <dd>
                      {row.decision_id || "Pending"} ·{" "}
                      {row.reviewer_id || "Awaiting independent review"} ·{" "}
                      {row.decided_at || "—"}
                    </dd>
                    <dt>Decision support reference</dt>
                    <dd>{row.decision_reference || "Pending"}</dd>
                  </>
                )}
                <dt>Request support reference</dt>
                <dd>{row.request_id || "Not recorded"}</dd>
              </dl>
            </details>
          </div>
        </article>
      ))}
      {next && (
        <button type="button" disabled={busy} onClick={() => void read(true)}>
          More {label}
        </button>
      )}
    </section>
  );
}
