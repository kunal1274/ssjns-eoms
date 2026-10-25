import { useEffect, useRef, useState } from "react";
import { RequestFailure } from "./feedback";
type Api = (path: string, body?: unknown) => Promise<any>;
export function OverlayExecution({
  path,
  api,
  onPending,
  disabled,
}: {
  path: string;
  api: Api;
  onPending: (v: boolean) => void;
  disabled: boolean;
}) {
  const base = path.split("/mapping-requests/")[0];
  const [data, setData] = useState<any>(null),
    [authority, setAuthority] = useState<any>(null),
    [people, setPeople] = useState<any>(null),
    [register, setRegister] = useState<any>(null),
    [subject, setSubject] = useState(""),
    [purpose, setPurpose] = useState("apply"),
    [action, setAction] = useState("appointed"),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [peopleCursor, setPeopleCursor] = useState<string | null>(null),
    [authorityCursor, setAuthorityCursor] = useState<string | null>(null),
    [registerCursor, setRegisterCursor] = useState<string | null>(null),
    [attempt, setAttempt] = useState(0),
    [loading, setLoading] = useState(true),
    [readError, setReadError] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [grantRef, setGrantRef] = useState(""),
    [grantReason, setGrantReason] = useState(""),
    [reference, setReference] = useState(""),
    [reason, setReason] = useState(""),
    [examined, setExamined] = useState(false);
  const live = useRef(true),
    write = useRef<{
      kind: "authority" | "execute";
      path: string;
      body: any;
    } | null>(null);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      onPending(false);
    };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setReadError("");
    setData(null);
    setAuthority(null);
    setPeople(null);
    setRegister(null);
    (async () => {
      const d = await api(path + "/execution"),
        a = await api(
          path +
            "/execution-authority?limit=10&purpose=" +
            purpose +
            (subject ? "&subjectId=" + subject : "") +
            (authorityCursor
              ? "&cursor=" + encodeURIComponent(authorityCursor)
              : ""),
        ),
        p = await api(
          base +
            "/policy-authority/candidates?limit=10&q=" +
            encodeURIComponent(query) +
            (peopleCursor ? "&cursor=" + encodeURIComponent(peopleCursor) : ""),
        ),
        r = await api(
          base +
            "/overlay-register?limit=10" +
            (registerCursor
              ? "&cursor=" + encodeURIComponent(registerCursor)
              : ""),
        );
      if (active) {
        setData(d);
        setAuthority(a);
        setPeople(p);
        setRegister(r);
      }
    })()
      .catch((e) => {
        if (active) setReadError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    path,
    subject,
    purpose,
    query,
    peopleCursor,
    authorityCursor,
    registerCursor,
    attempt,
  ]);
  const locked = disabled || loading || busy || pending || !!readError,
    application = data?.receipts.find((r: any) => r.kind === "applied"),
    own = purpose === "apply" ? data?.ownApply : data?.ownCompensate,
    canExecute =
      purpose === "apply"
        ? data?.state.approvalCurrent &&
          !application &&
          own?.effective &&
          data?.state.head?.actor_id !== data?.actorId
        : data?.active &&
          own?.effective &&
          application?.actor_id !== data?.actorId,
    grantValid =
      subject &&
      grantRef.trim().length >= 3 &&
      grantReason.trim().length >= 3 &&
      (action === "revoked"
        ? authority?.state.head?.action === "appointed"
        : subject !== data?.actorId &&
          authority?.state.eligible &&
          (purpose === "apply"
            ? data?.state.approvalCurrent &&
              !application &&
              subject !== data?.state.head?.actor_id
            : data?.active && subject !== application?.actor_id)),
    executionValid =
      canExecute &&
      reference.trim().length >= 3 &&
      reason.trim().length >= 3 &&
      examined;
  async function submit(kind: "authority" | "execute") {
    if (
      disabled ||
      loading ||
      busy ||
      readError ||
      (!write.current && !(kind === "authority" ? grantValid : executionValid))
    )
      return;
    write.current ??=
      kind === "authority"
        ? {
            kind,
            path: path + "/execution-authority",
            body: {
              key: crypto.randomUUID(),
              subjectId: subject,
              purpose,
              expectedRevision: authority.state.head?.revision ?? 0,
              action,
              reference: grantRef.trim(),
              reason: grantReason.trim(),
            },
          }
        : {
            kind,
            path: path + "/execution",
            body: {
              key: crypto.randomUUID(),
              authorityId: own.head.id,
              operation: purpose,
              previousId: purpose === "compensate" ? application.id : null,
              reference: reference.trim(),
              reason: reason.trim(),
              examined: true,
            },
          };
    const saved = write.current;
    setBusy(true);
    setPending(true);
    onPending(true);
    setError("");
    setNotice("");
    try {
      const v = await api(saved.path, saved.body);
      if (live.current) {
        setNotice(
          (v.replayed ? "Recovered existing receipt. " : "Recorded. ") +
            (kind === "authority"
              ? "Execution authorization revision " + v.authority.revision
              : "Overlay " + v.receipt.kind + " receipt " + v.receipt.id) +
            ". Original work, quantity and audit remain unchanged.",
        );
        write.current = null;
        setPending(false);
        onPending(false);
        if (kind === "authority") {
          setGrantRef("");
          setGrantReason("");
        } else {
          setReference("");
          setReason("");
          setExamined(false);
        }
        setAuthorityCursor(null);
        setRegisterCursor(null);
        setAttempt((n) => n + 1);
      }
    } catch (e) {
      if (live.current) {
        const uncertain = !(e instanceof RequestFailure) || e.status >= 500;
        if (!uncertain) {
          write.current = null;
          setPending(false);
          onPending(false);
        }
        setError(
          (e as Error).message +
            (uncertain
              ? " Retry unchanged submission to recover a possibly committed receipt. Fields and navigation are locked."
              : " Refresh execution and reconciliation, inspect current authority and receipt, then correct the retained draft."),
        );
      }
    } finally {
      if (live.current) setBusy(false);
    }
  }
  function buttonDisabled(kind: "authority" | "execute", valid: any) {
    return (
      disabled ||
      loading ||
      busy ||
      !!readError ||
      (pending ? write.current?.kind !== kind : !valid)
    );
  }
  return (
    <section
      aria-label="Overlay execution and reconciliation"
      style={{ overflowWrap: "anywhere", minWidth: 0 }}
    >
      <h5>Apply and reconcile attribution overlays</h5>
      <ol>
        <li>
          A separate manager authorizes a named executor for this exact request
          and approval. Decision recording alone never permits execution.
        </li>
        <li>
          Apply only after fresh transactional checks pass. Review original
          versus adjusted attribution and the immutable receipt.
        </li>
        <li>
          To undo an application, separately authorize a compensating actor
          distinct from the applier. Compensation preserves the original
          application and business facts. A new mapping needs a withdrawn
          approval and linked correction.
        </li>
      </ol>
      <p>
        No payroll or finance dispatch. Scope, evidence or approval changes
        block new application; they do not silently erase an existing overlay.
        Use explicit compensation.
      </p>
      <button
        disabled={disabled || loading || busy || pending}
        onClick={() => setAttempt((n) => n + 1)}
      >
        Refresh execution and reconciliation
      </button>
      {loading && (
        <p role="status">Loading execution authority and reconciliation…</p>
      )}
      {readError && <p role="alert">{readError}</p>}
      {data && authority && people && register && (
        <>
          <p>
            Application state:{" "}
            {data.active
              ? "Active overlay"
              : application
                ? "Compensated overlay"
                : "Not applied"}{" "}
            · Approval {data.state.approvalCurrent ? "current" : "not current"}{" "}
            · Your execution authority{" "}
            {own?.effective ? "current" : "not current"}.
          </p>
          <label>
            Overlay operation
            <select
              aria-label="Overlay operation"
              disabled={locked}
              value={purpose}
              onChange={(e) => {
                setPurpose(e.target.value);
                setAuthorityCursor(null);
                setExamined(false);
              }}
            >
              <option value="apply">Apply approved attribution</option>
              <option value="compensate">
                Compensate existing application
              </option>
            </select>
          </label>
          <section aria-label="Request execution authorization">
            <h6>Explicit request execution authorization</h6>
            <label>
              Search execution person
              <input
                aria-label="Search execution person"
                disabled={locked}
                maxLength={100}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <button
              disabled={locked}
              onClick={() => {
                setQuery(search.trim());
                setPeopleCursor(null);
                setAttempt((n) => n + 1);
              }}
            >
              Find execution person
            </button>
            {people.items.map((p: any) => (
              <button
                key={p.id}
                disabled={locked || p.id === data.actorId}
                onClick={() => {
                  setSubject(p.id);
                  setAuthorityCursor(null);
                }}
              >
                Select execution person {p.name} {p.id}
              </button>
            ))}
            <button
              disabled={locked || !people.nextCursor}
              onClick={() => setPeopleCursor(people.nextCursor)}
            >
              Next execution people
            </button>
            <p data-execution-authority-state>
              Selected person {subject || data.actorId} · Authorization revision{" "}
              {authority.state.head?.revision ?? 0} ·{" "}
              {authority.state.effective ? "Current" : "Not current"}
            </p>
            <form
              aria-label="Authorize overlay execution"
              onSubmit={(e) => {
                e.preventDefault();
                void submit("authority");
              }}
            >
              <fieldset disabled={locked || !subject}>
                <label>
                  Execution authorization action
                  <select
                    aria-label="Execution authorization action"
                    value={action}
                    onChange={(e) => setAction(e.target.value)}
                  >
                    <option value="appointed">
                      Authorize exact request operation
                    </option>
                    <option value="revoked">
                      Revoke exact request operation
                    </option>
                  </select>
                </label>
                <label>
                  Execution authority reference
                  <input
                    aria-label="Execution authority reference"
                    required
                    minLength={3}
                    maxLength={240}
                    value={grantRef}
                    onChange={(e) => setGrantRef(e.target.value)}
                  />
                </label>
                <label>
                  Execution authority reason
                  <textarea
                    aria-label="Execution authority reason"
                    required
                    minLength={3}
                    maxLength={500}
                    value={grantReason}
                    onChange={(e) => setGrantReason(e.target.value)}
                  />
                </label>
              </fieldset>
              <button disabled={buttonDisabled("authority", grantValid)}>
                Record execution authorization
              </button>
            </form>
            {authority.items.map((a: any) => (
              <article key={a.id} data-execution-authority={a.id}>
                <strong>
                  {a.action} · Authorization revision {a.revision}
                </strong>
                <p>
                  {a.purpose} · {a.reason} · {a.created_at}
                </p>
                <details>
                  <summary>View detailed execution authorization</summary>
                  <p>
                    Actor {a.actor_id} · Subject {a.subject_id} · Decision{" "}
                    {a.decision_id} · Previous{" "}
                    {a.previous_id ?? "First authorization"} · Reference{" "}
                    {a.reference} · Support {a.request_id}
                  </p>
                </details>
              </article>
            ))}
            <button
              disabled={locked || !authority.nextCursor}
              onClick={() => setAuthorityCursor(authority.nextCursor)}
            >
              Next execution authorization history
            </button>
          </section>
          <form
            aria-label="Execute attribution overlay"
            onSubmit={(e) => {
              e.preventDefault();
              void submit("execute");
            }}
          >
            <fieldset disabled={locked || !canExecute}>
              <label>
                Overlay execution reference
                <input
                  aria-label="Overlay execution reference"
                  required
                  minLength={3}
                  maxLength={240}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </label>
              <label>
                Overlay execution reason
                <textarea
                  aria-label="Overlay execution reason"
                  required
                  minLength={3}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  aria-label="I checked the exact approval authority rows and compensation consequences"
                  checked={examined}
                  onChange={(e) => setExamined(e.target.checked)}
                />
                I checked the exact approval, authority, rows and compensation
                consequences
              </label>
            </fieldset>
            <button disabled={buttonDisabled("execute", executionValid)}>
              {purpose === "apply"
                ? "Apply attribution overlay"
                : "Compensate attribution overlay"}
            </button>
          </form>
          {!canExecute && (
            <p>
              Execution blocked. Check current independent approval, named
              authorization and actor separation. Existing applications need
              separate compensation; revoked or changed evidence requires
              renewed review for new application.
            </p>
          )}
          {data.receipts.map((r: any) => (
            <article key={r.id} data-overlay-receipt={r.id}>
              <strong>
                {r.kind} · {r.row_count} rows · {r.quantity_ha} ha
              </strong>
              <p>
                {r.reason} · {r.created_at}
              </p>
              <details>
                <summary>View detailed overlay receipt</summary>
                <p>
                  Receipt {r.id} · Previous{" "}
                  {r.previous_id ?? "First application"} · Actor {r.actor_id} ·
                  Decision {r.decision_id} · Authorization {r.authority_id} ·
                  Reference {r.reference} · Support {r.request_id} · Snapshot{" "}
                  {r.snapshot_sha256} · Rows SHA-256 {r.rows_sha256}
                </p>
              </details>
            </article>
          ))}
          <details>
            <summary>View request original and adjusted attribution</summary>
            {data.rows.map((r: any) => (
              <p key={r.record_id}>
                Record {r.record_id} · Original{" "}
                {r.original_company_id ?? "Unresolved historical company"} ·
                Adjusted{" "}
                {data.active
                  ? r.adjusted_company_name
                  : "Original attribution restored in projection"}{" "}
                · Applied version {r.record_version} · Current version{" "}
                {r.current_version} · Quantity {r.quantity_ha} ha
              </p>
            ))}
          </details>
          <section aria-label="Estate original and adjusted reconciliation">
            <h6>Estate attribution reconciliation</h6>
            <p data-overlay-totals>
              {register.totals.records} records · Original unresolved{" "}
              {register.totals.original_unresolved} · Adjusted unresolved{" "}
              {register.totals.adjusted_unresolved} · Active overlay rows{" "}
              {register.totals.active_overlay_rows} · Original quantity{" "}
              {register.totals.original_quantity_ha} ha · Adjusted quantity{" "}
              {register.totals.adjusted_quantity_ha} ha
            </p>
            <p>
              Current scoped read window; totals are not a financial posting or
              historical access snapshot.
            </p>
            {register.items.map((r: any) => (
              <article key={r.id} data-overlay-register={r.id}>
                Record {r.id} · Original {r.original_company_id ?? "Unresolved"}{" "}
                · Adjusted {r.adjusted_company_id ?? "Unresolved"} · Quantity{" "}
                {r.quantity_ha} ha · Receipt{" "}
                {r.receipt_id ?? "No active overlay"} ·{" "}
                {r.version_current
                  ? "Version current"
                  : "Work version changed since application; inspect and compensate if required"}
              </article>
            ))}
            <button
              disabled={locked || !register.nextCursor}
              onClick={() => setRegisterCursor(register.nextCursor)}
            >
              Next reconciliation records
            </button>
            <button
              disabled={locked || !registerCursor}
              onClick={() => setRegisterCursor(null)}
            >
              First reconciliation records
            </button>
          </section>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
