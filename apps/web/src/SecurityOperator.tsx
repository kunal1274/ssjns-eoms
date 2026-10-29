import { useEffect, useRef, useState } from "react";
import { RequestFailure } from "./feedback";
export function SecurityOperator({
  api,
  onPending,
  disabled,
}: {
  api: (path: string, body?: unknown) => Promise<any>;
  onPending: (v: boolean) => void;
  disabled: boolean;
}) {
  const [allowed, setAllowed] = useState(false),
    [checkError, setCheckError] = useState(""),
    [target, setTarget] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const pending = useRef<any>(null),
    form = useRef<HTMLFormElement>(null),
    live = useRef(true);
  useEffect(() => {
    live.current = true;
    void checkAccess();
    return () => {
      live.current = false;
    };
  }, []);
  async function checkAccess() {
    setCheckError("");
    try {
      const v = await api("/auth/admin/context");
      if (live.current) setAllowed(v.allowed);
    } catch (e) {
      if (live.current) {
        setAllowed(false);
        setCheckError((e as Error).message);
      }
    }
  }
  async function submit() {
    setBusy(true);
    onPending(true);
    setError("");
    try {
      const r = await api("/auth/admin/revoke", pending.current);
      pending.current = null;
      setUncertain(false);
      setTarget(null);
      form.current?.reset();
      setNotice(
        `Revoked ${r.count} session(s). Audit event ${r.eventId}; request ${r.requestId}.`,
      );
      onPending(false);
    } catch (e) {
      if (e instanceof RequestFailure && e.status < 500) {
        pending.current = null;
        setUncertain(false);
        setTarget(null);
        onPending(false);
        setError(e.message);
        if ([401, 403].includes(e.status)) setAllowed(false);
      } else {
        setUncertain(true);
        setError(
          "Result unknown. Retry this exact revocation to recover its receipt.",
        );
      }
    } finally {
      setBusy(false);
    }
  }
  if (!allowed)
    return checkError ? (
      <div>
        <p role="alert">{checkError}</p>
        <button disabled={disabled} onClick={() => void checkAccess()}>
          Retry security access check
        </button>
      </div>
    ) : null;
  return (
    <section className="card" aria-label="Security operator revocation">
      <h3>Authorized security operator</h3>
      <p>
        Your explicit platform appointment permits global session revocation for
        a named account. This may affect every customer assigned to that
        account. It grants no operational permissions.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          setNotice("");
          void api(
            "/auth/admin/context?targetId=" +
              encodeURIComponent(String(data.get("targetId"))),
          )
            .then((v) => setTarget(v.target))
            .catch((e) => {
              setTarget(null);
              setError(e.message);
            })
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Named account UUID
          <input
            name="targetId"
            onChange={() => {
              setTarget(null);
              setNotice("");
            }}
            required
            pattern="[a-fA-F0-9-]{36}"
            disabled={busy || uncertain || disabled}
          />
        </label>
        <button disabled={busy || uncertain || disabled}>
          Preview named account
        </button>
      </form>
      {target && (
        <form
          ref={form}
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            pending.current = {
              targetId: target.id,
              revision: target.revision,
              key: crypto.randomUUID(),
              reference: data.get("reference"),
              reason: data.get("reason"),
            };
            void submit();
          }}
        >
          <p>
            {target.name} · {target.active ? "Active" : "Inactive"} ·{" "}
            {target.sessionCount} active sessions
          </p>
          <label>
            Revocation reference
            <input
              name="reference"
              required
              minLength={5}
              maxLength={200}
              disabled={busy || uncertain || disabled}
            />
          </label>
          <label>
            Revocation reason
            <textarea
              name="reason"
              required
              minLength={10}
              maxLength={500}
              disabled={busy || uncertain || disabled}
            />
          </label>
          <button disabled={busy || uncertain || disabled}>
            Revoke all sessions for this account
          </button>
        </form>
      )}
      {uncertain && (
        <button disabled={busy} onClick={() => void submit()}>
          Retry same operator revocation
        </button>
      )}
    </section>
  );
}
