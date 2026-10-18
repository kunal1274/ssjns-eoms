import { useEffect, useRef, useState } from "react";
import { RequestFailure } from "./feedback";
import { TaskBlockLink } from "./TaskBlock";
type Api = (path: string, body?: unknown) => Promise<any>;
export function LegacyReview({
  base,
  api,
  onOpenWork,
  onOpenHierarchy,
  initialKind = "tasks",
}: {
  base: string;
  api: Api;
  onOpenWork?: (record: Record<string, any>) => void;
  onOpenHierarchy?: () => void;
  initialKind?: "tasks" | "work";
}) {
  const [kind, setKind] = useState<string>(initialKind),
    [term, setTerm] = useState(""),
    [query, setQuery] = useState(""),
    [attempt, setAttempt] = useState(0),
    [rows, setRows] = useState<any[]>([]),
    [next, setNext] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [failedMore, setFailedMore] = useState(false),
    [selected, setSelected] = useState<any>(null),
    [link, setLink] = useState(false),
    [reviewBusy, setReviewBusy] = useState(false),
    [reviewError, setReviewError] = useState(""),
    [notice, setNotice] = useState(""),
    [denied, setDenied] = useState(false);
  const generation = useRef(0),
    detailGeneration = useRef(0),
    alive = useRef(true),
    accessEpoch = useRef(0),
    context = useRef(""),
    panel = useRef<HTMLElement>(null);
  context.current = JSON.stringify([base, kind, query]);
  useEffect(() => {
    alive.current = true;
    if (initialKind === "work") panel.current?.focus();
    return () => {
      alive.current = false;
      generation.current++;
      detailGeneration.current++;
      accessEpoch.current++;
    };
  }, []);
  const deniedError = (e: unknown) =>
    e instanceof RequestFailure && [401, 403, 404].includes(e.status);
  function clearDenied() {
    accessEpoch.current++;
    generation.current++;
    detailGeneration.current++;
    setRows([]);
    setNext(null);
    setSelected(null);
    setLink(false);
    setDenied(true);
    setTerm("");
    setQuery("");
    setReviewError("");
    setNotice("");
    setBusy(false);
    setReviewBusy(false);
  }
  async function checkedApi(path: string, body?: unknown) {
    const epoch = accessEpoch.current;
    try {
      const result = await api(path, body);
      if (!alive.current || epoch !== accessEpoch.current)
        throw new Error(
          "Access changed during this request. Refresh the review queue before continuing.",
        );
      return result;
    } catch (e) {
      if (alive.current && deniedError(e)) {
        clearDenied();
        setError((e as Error).message);
      }
      throw e;
    }
  }
  async function read(more = false) {
    const ticket = ++generation.current,
      started = context.current;
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({ q: query, limit: "25" });
      if (more && next) params.set("cursor", next);
      const result = await api(`${base}/legacy-review/${kind}?${params}`);
      if (
        !alive.current ||
        ticket !== generation.current ||
        started !== context.current
      )
        return;
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
      setDenied(false);
      if (!result.canLink) {
        detailGeneration.current++;
        setReviewBusy(false);
        setLink(false);
        setSelected((old: any) => (old ? { ...old, can_link: false } : null));
      }
    } catch (e) {
      if (
        alive.current &&
        ticket === generation.current &&
        started === context.current
      ) {
        if (deniedError(e)) clearDenied();
        setError((e as Error).message);
        setFailedMore(more);
      }
    } finally {
      if (alive.current && ticket === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    setRows([]);
    setNext(null);
    void read();
    return () => {
      generation.current++;
    };
  }, [base, kind, query, attempt]);
  async function review(id: string) {
    const ticket = ++detailGeneration.current;
    setReviewBusy(true);
    setReviewError("");
    try {
      const value = await api(`${base}/legacy-review/tasks/${id}`);
      if (!alive.current || ticket !== detailGeneration.current) return;
      setSelected(value);
      setLink(false);
      setDenied(false);
    } catch (e) {
      if (alive.current && ticket === detailGeneration.current) {
        if (deniedError(e)) clearDenied();
        setReviewError((e as Error).message);
      }
    } finally {
      if (alive.current && ticket === detailGeneration.current)
        setReviewBusy(false);
    }
  }
  async function saved() {
    if (!alive.current) return;
    const id = selected.id,
      ticket = ++detailGeneration.current;
    // A committed link is not resubmitted if either read fails.
    const value = await checkedApi(`${base}/legacy-review/tasks/${id}`);
    const params = new URLSearchParams({ q: query, limit: "25" });
    const result = await checkedApi(`${base}/legacy-review/tasks?${params}`);
    if (!alive.current || ticket !== detailGeneration.current) return;
    generation.current++;
    setBusy(false);
    setRows(result.items);
    setNext(result.nextCursor);
    setSelected(value);
    setLink(false);
    setNotice(
      "Block link saved once. Existing work and missing historical company attribution remain unchanged.",
    );
  }
  return (
    <section
      className="editor"
      aria-label="Legacy attribution review"
      ref={panel}
      tabIndex={-1}
    >
      <h3>Review legacy attribution</h3>
      <ol>
        <li>Find unresolved records in this estate.</li>
        <li>
          Review the recorded task code and latest version. A manager can
          explicitly link an exact matching configured block with a reason.
        </li>
        <li>
          Inspect the saved audit. Refer missing historical company attribution
          to the migration owner for source reconciliation.
        </li>
      </ol>
      <p>
        Historical company attribution is not inferred from today's company.
        Linking a task changes its current reference; it does not backfill
        historical work. Lists show loaded unresolved records, not a completion
        percentage.
      </p>
      <label>
        Legacy review queue
        <select
          aria-label="Legacy review queue"
          value={kind}
          disabled={reviewBusy || link}
          onChange={(e) => {
            detailGeneration.current++;
            setKind(e.target.value);
            setTerm("");
            setQuery("");
            setSelected(null);
            setReviewError("");
            setNotice("");
          }}
        >
          <option value="tasks">Tasks without block links</option>
          <option value="work">Work without recorded company</option>
        </select>
      </label>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (term.trim() === query) setAttempt((n) => n + 1);
          else setQuery(term.trim());
        }}
      >
        <label>
          Search legacy records
          <input
            aria-label="Search legacy records"
            value={term}
            maxLength={100}
            onChange={(e) => setTerm(e.target.value)}
          />
        </label>
        <button disabled={busy}>Find legacy records</button>
      </form>
      <button
        type="button"
        disabled={busy || reviewBusy || link}
        onClick={() => {
          setSelected(null);
          setReviewError("");
          setNotice("");
          setAttempt((n) => n + 1);
        }}
      >
        Refresh legacy queue
      </button>
      {busy && <p role="status">Loading unresolved records…</p>}
      {error && (
        <p role="alert">
          {error}{" "}
          <button
            type="button"
            disabled={busy}
            onClick={() => void read(failedMore && !denied)}
          >
            Retry legacy records
          </button>
        </p>
      )}
      {denied && (
        <p>
          Access changed. Cached records and private review inputs were cleared.
          Refresh after your administrator reviews the assignment; no other
          estate is selected automatically.
        </p>
      )}
      {!busy && !error && !rows.length && (
        <p>
          No matching unresolved records in this queue. Clear the search to
          review other records; this does not certify all migration data.
        </p>
      )}
      <p>{rows.length} unresolved records loaded.</p>
      {rows.map((r) => (
        <article className="event" key={r.id} data-legacy-id={r.id}>
          <div className="eventbody">
            <strong>
              {r.task_code} · recorded block {r.block_code}
            </strong>
            <p>
              {kind === "tasks"
                ? `No block link · Version ${r.version}`
                : `${r.business_date} · ${r.status} · ${r.quantity_ha} Ha · Company attribution not recorded`}
            </p>
            <small>Record ID: {r.id}</small>
            {kind === "work" && (
              <p>
                {r.current_task_block_id
                  ? "The task has a current block link. It is not a historical work snapshot."
                  : "The task also has no current block link."}
              </p>
            )}
            {kind === "tasks" ? (
              <button disabled={reviewBusy} onClick={() => void review(r.id)}>
                Review task
              </button>
            ) : (
              <button
                disabled={reviewBusy}
                onClick={() =>
                  void (async () => {
                    setReviewBusy(true);
                    setReviewError("");
                    try {
                      const value = await checkedApi(base + "/musters/" + r.id);
                      onOpenWork?.(value);
                    } catch (e) {
                      if (alive.current) setReviewError((e as Error).message);
                    } finally {
                      if (alive.current) setReviewBusy(false);
                    }
                  })()
                }
              >
                Open recorded work
              </button>
            )}
          </div>
        </article>
      ))}
      {next && (
        <button disabled={busy} onClick={() => void read(true)}>
          More legacy records
        </button>
      )}
      {reviewBusy && <p role="status">Checking current record and access…</p>}
      {reviewError && <p role="alert">{reviewError}</p>}
      {notice && <p role="status">{notice}</p>}
      {selected && (
        <article data-legacy-review={selected.id} className="editor">
          <h4>Reviewed task · {selected.task_code}</h4>
          <p>
            Recorded block {selected.block_code} · Version {selected.version} ·
            Task ID {selected.id}
          </p>
          <p>
            {selected.block_unit_id
              ? `Current linked block: ${selected.linked_block_name} · ${selected.block_unit_id}`
              : "Unlinked — choose a verified configured block only after review."}
          </p>
          <button
            disabled={reviewBusy || link}
            onClick={() => void review(selected.id)}
          >
            Refresh reviewed task
          </button>
          {!selected.block_unit_id && selected.can_link && !link && (
            <button
              onClick={() => {
                setNotice("");
                setLink(true);
              }}
            >
              Review matching block link
            </button>
          )}
          {!selected.can_link && (
            <p>
              Read-only review. An active estate and current estate-manager
              authority are required to link a task.
            </p>
          )}
          {onOpenHierarchy && (
            <p>
              In Organization, choose this same customer and estate before
              configuring a matching block.{" "}
              <button type="button" onClick={onOpenHierarchy}>
                Open hierarchy setup for matching block
              </button>
            </p>
          )}
          {selected.linkEvent && (
            <section aria-label="Recorded link audit">
              <p>
                Task linked ·{" "}
                {selected.linkEvent.actor || "System / explicit migration"} ·{" "}
                {selected.linkEvent.reason}
              </p>
              <details>
                <summary>View reviewed link details</summary>
                <dl>
                  <dt>Actor ID</dt>
                  <dd>{selected.linkEvent.actor_id || "Not recorded"}</dd>
                  <dt>Before block link</dt>
                  <dd>
                    {selected.linkEvent.before_state?.parentId ||
                      "No previous link"}
                  </dd>
                  <dt>After block link</dt>
                  <dd>{selected.linkEvent.after_state.parentId}</dd>
                  <dt>Event / support reference</dt>
                  <dd>
                    {selected.linkEvent.id} ·{" "}
                    {selected.linkEvent.request_id || "Not recorded"}
                  </dd>
                </dl>
              </details>
            </section>
          )}
        </article>
      )}
      {link && selected && (
        <TaskBlockLink
          key={selected.id + ":" + selected.version}
          base={base}
          api={checkedApi}
          task={selected}
          onCancel={() => setLink(false)}
          onSaved={saved}
        />
      )}
    </section>
  );
}
