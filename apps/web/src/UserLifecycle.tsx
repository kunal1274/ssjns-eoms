import { useEffect, useRef, useState } from "react";
import { RequestFailure } from "./feedback";
export function UserLifecycle({
  api,
  onPending,
  disabled,
}: {
  api: (path: string, body?: unknown) => Promise<any>;
  onPending: (v: boolean) => void;
  disabled: boolean;
}) {
  const [allowed, setAllowed] = useState(false),
    [accessError, setAccessError] = useState(""),
    [targetId, setTargetId] = useState(""),
    [target, setTarget] = useState<any>(null),
    [items, setItems] = useState<any[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [detail, setDetail] = useState<string | null>(null);
  const live = useRef(true),
    generation = useRef(0),
    pending = useRef<any>(null);
  useEffect(() => {
    live.current = true;
    void checkAccess();
    return () => {
      live.current = false;
      generation.current++;
    };
  }, []);
  async function checkAccess() {
    setAccessError("");
    try {
      const v = await api("/auth/lifecycle/context");
      if (live.current) setAllowed(v.allowed);
    } catch (e) {
      if (live.current) {
        setAllowed(false);
        setAccessError((e as Error).message);
      }
    }
  }
  async function preview(more = false) {
    const g = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const v = await api(
        "/auth/lifecycle/context?targetId=" +
          encodeURIComponent(targetId) +
          "&limit=10" +
          (more && cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
      );
      if (!live.current || g !== generation.current) return;
      setTarget(v.target);
      setItems((old) => (more ? [...old, ...v.items] : v.items));
      setCursor(v.nextCursor);
    } catch (e) {
      if (!live.current || g !== generation.current) return;
      setError((e as Error).message);
      if (e instanceof RequestFailure && [401, 403].includes(e.status)) {
        setTarget(null);
        setItems([]);
        setCursor(null);
        setAllowed(false);
      }
    } finally {
      if (live.current && g === generation.current) setBusy(false);
    }
  }
  async function change() {
    setBusy(true);
    onPending(true);
    setError("");
    setNotice("");
    try {
      const r = await api("/auth/lifecycle/change", pending.current);
      pending.current = null;
      setUncertain(false);
      onPending(false);
      if (!live.current) return;
      setTarget(null);
      setItems([]);
      setCursor(null);
      setNotice(
        `Account is ${r.state}. Ended ${r.sessionsInvalidated} session(s). Audit event ${r.eventId}; request ${r.requestId}. ${r.replayed ? "Recovered the original receipt." : ""}`,
      );
      // A failed read after a confirmed write must not turn the committed write into an unknown result.
      await preview();
    } catch (e) {
      if (!live.current) return;
      if (e instanceof RequestFailure && e.status < 500) {
        pending.current = null;
        setUncertain(false);
        onPending(false);
        setTarget(null);
        setItems([]);
        setCursor(null);
        setError(
          e.message +
            " Preview the account again before making another decision.",
        );
        if ([401, 403].includes(e.status)) setAllowed(false);
      } else {
        setUncertain(true);
        setError(
          "Result unknown. Keep this page open and retry the same lifecycle decision to recover its receipt.",
        );
      }
    } finally {
      if (live.current) setBusy(false);
    }
  }
  if (!allowed)
    return accessError ? (
      <div>
        <p role="alert">{accessError}</p>
        <button disabled={disabled} onClick={() => void checkAccess()}>
          Retry lifecycle access check
        </button>
      </div>
    ) : null;
  const locked = busy || uncertain || disabled;
  return (
    <section className="card" aria-label="User lifecycle administration">
      <h3>User lifecycle administration</h3>
      <p>
        Your explicit platform appointment permits changes to named accounts
        across customers. Step 1: preview the account. Step 2: review its
        assignments and choose a change. Step 3: retain the audit receipt.
      </p>
      <p>
        Suspension and deactivation end EOMS sessions and recovery tokens.
        Reactivation requires a fresh sign-in. Existing estate and setup
        assignments are retained and can take effect again; review them before
        reactivating. Separate authority appointments may need renewal.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {busy && <p role="status">Checking or recording user lifecycle…</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setNotice("");
          void preview();
        }}
      >
        <label>
          Lifecycle account UUID
          <input
            value={targetId}
            onChange={(e) => {
              generation.current++;
              setTargetId(e.target.value);
              setTarget(null);
              setItems([]);
              setCursor(null);
              setNotice("");
              setError("");
            }}
            required
            pattern="[a-fA-F0-9-]{36}"
            disabled={locked}
          />
        </label>
        <button disabled={locked}>Preview lifecycle account</button>
      </form>
      {target && (
        <>
          <p>
            {target.name} · Current state: {target.state} · Revision{" "}
            {target.revision}
          </p>
          <p>
            {target.sessionCount} active sessions · {target.estateAssignments}{" "}
            estate assignments · {target.setupAssignments} setup assignments
          </p>
          {target.self && (
            <p role="status">
              Ask a separate lifecycle operator to change your own account.
            </p>
          )}
          {target.protectedSetups > 0 && (
            <p role="status">
              This is the last active setup administrator for{" "}
              {target.protectedSetups} customer(s). Arrange a setup handover
              before suspension or deactivation.
            </p>
          )}
          {!target.self && (
            <form
              key={target.id + ":" + target.revision}
              onSubmit={(e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                pending.current = {
                  targetId: target.id,
                  revision: target.revision,
                  state: d.get("state"),
                  key: crypto.randomUUID(),
                  reference: d.get("reference"),
                  reason: d.get("reason"),
                  reviewed: true,
                };
                void change();
              }}
            >
              <label>
                New account state
                <select
                  aria-label="New account state"
                  name="state"
                  required
                  defaultValue=""
                  disabled={locked}
                >
                  <option value="" disabled>
                    Choose a state change
                  </option>
                  {target.state !== "active" && (
                    <option value="active">Reactivate</option>
                  )}
                  {target.state === "active" &&
                    target.protectedSetups === 0 && (
                      <option value="suspended">Suspend</option>
                    )}
                  {target.state !== "deactivated" &&
                    target.protectedSetups === 0 && (
                      <option value="deactivated">Deactivate</option>
                    )}
                </select>
              </label>
              <label>
                Lifecycle reference
                <input
                  name="reference"
                  required
                  minLength={5}
                  maxLength={200}
                  disabled={locked}
                />
              </label>
              <label>
                Lifecycle reason
                <textarea
                  name="reason"
                  required
                  minLength={10}
                  maxLength={500}
                  disabled={locked}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  name="reviewed"
                  required
                  disabled={locked}
                />
                I reviewed the named account, retained assignments and effect of
                this change.
              </label>
              <button
                disabled={
                  locked ||
                  (target.state === "active" && target.protectedSetups > 0)
                }
              >
                Record lifecycle change
              </button>
            </form>
          )}
          <h4>Lifecycle history</h4>
          <p>
            Short entries describe recorded decisions. Open details for actor,
            reason and request reference. Migration classification is not a
            historical decision.
          </p>
          {!items.length && (
            <p>No recorded lifecycle decisions are available.</p>
          )}
          {items.map((e) => (
            <article key={e.id}>
              <p>
                {e.action} · {new Date(e.created_at).toLocaleString()}
              </p>
              <button
                disabled={locked}
                onClick={() => setDetail(detail === e.id ? null : e.id)}
              >
                Details for lifecycle event {e.id}
              </button>
              {detail === e.id && (
                <dl>
                  <dt>Actor</dt>
                  <dd>{e.actor_id ?? "Authorized support"}</dd>
                  <dt>Reference</dt>
                  <dd>{e.detail.reference}</dd>
                  <dt>Reason</dt>
                  <dd>{e.detail.reason}</dd>
                  <dt>Request</dt>
                  <dd>{e.request_id}</dd>
                  <dt>State and revision</dt>
                  <dd>
                    {e.detail.state} · {e.detail.revision}
                  </dd>
                </dl>
              )}
            </article>
          ))}
          {cursor && (
            <button disabled={locked} onClick={() => void preview(true)}>
              More lifecycle history
            </button>
          )}
        </>
      )}
      {uncertain && (
        <button disabled={busy} onClick={() => void change()}>
          Retry same lifecycle decision
        </button>
      )}
    </section>
  );
}
