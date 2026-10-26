import { Onboarding, AccessManifest } from "./Onboarding";
import { UserLifecycle } from "./UserLifecycle";
import { SecurityOperator } from "./SecurityOperator";
import { useEffect, useRef, useState } from "react";
import { RequestFailure } from "./feedback";
type Api = (path: string, body?: unknown) => Promise<any>;
export function AccountSecurity({
  api,
  onPending,
  onSignOutAll,
  onCredentialChanged,
}: {
  api: Api;
  onPending: (v: boolean) => void;
  onSignOutAll: () => Promise<void>;
  onCredentialChanged: () => void;
}) {
  const [sessions, setSessions] = useState<any[]>([]),
    [events, setEvents] = useState<any[]>([]),
    [nextSessions, setNextSessions] = useState<string | null>(null),
    [nextEvents, setNextEvents] = useState<string | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [ownBusy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [options, setOptions] = useState<any>(null),
    [detail, setDetail] = useState<string | null>(null),
    [confirmAll, setConfirmAll] = useState(false);
  const [operatorPending, setOperatorPending] = useState(false);
  const [lifecyclePending, setLifecyclePending] = useState(false);
  const [onboardingPending, setOnboardingPending] = useState(false);
  const busy =
    ownBusy || operatorPending || lifecyclePending || onboardingPending;
  const pending = useRef<any>(null),
    live = useRef(true);
  useEffect(() => {
    live.current = true;
    void refresh();
    return () => {
      live.current = false;
      onPending(false);
    };
  }, []);
  async function load(kind: "sessions" | "events", cursor?: string | null) {
    const v = await api(
      "/auth/" +
        kind +
        "?limit=10" +
        (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
    );
    if (!live.current) return;
    if (kind === "sessions") {
      setSessions((old) => (cursor ? [...old, ...v.items] : v.items));
      setNextSessions(v.nextCursor);
    } else {
      setEvents((old) => (cursor ? [...old, ...v.items] : v.items));
      setNextEvents(v.nextCursor);
    }
  }
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const o = await api("/auth/options");
      if (live.current) setOptions(o);
      await Promise.all([load("sessions"), load("events")]);
    } catch (e) {
      if (live.current) {
        setError((e as Error).message);
        if (e instanceof RequestFailure && [401, 403].includes(e.status)) {
          setSessions([]);
          setEvents([]);
        }
      }
    } finally {
      if (live.current) setBusy(false);
    }
  }
  async function revoke(targetId: string | null, allOthers: boolean) {
    pending.current ??= { key: crypto.randomUUID(), targetId, allOthers };
    setBusy(true);
    onPending(true);
    setError("");
    setNotice("");
    try {
      const receipt = await api("/auth/sessions/revoke", pending.current);
      pending.current = null;
      setUncertain(false);
      setNotice(
        `Revoked ${receipt.count} other session(s). Current session retained. Audit event ${receipt.eventId}; request ${receipt.requestId}.`,
      );
      await Promise.all([load("sessions"), load("events")]);
      onPending(false);
    } catch (e) {
      if (e instanceof RequestFailure && e.status < 500) {
        pending.current = null;
        setUncertain(false);
        onPending(false);
        setError(e.message);
        if ([401, 403].includes(e.status)) {
          setSessions([]);
          setEvents([]);
        }
      } else {
        setUncertain(true);
        setError(
          "We could not confirm the result. Retry the same request to recover its receipt.",
        );
      }
    } finally {
      if (live.current) setBusy(false);
    }
  }
  return (
    <section
      className="card account-security"
      aria-label="Account security controls"
    >
      <h2>Your account security</h2>
      <p>
        Review active sessions and your security history. Signing out other
        sessions keeps this device connected. Session policy: 30 minutes idle,
        up to 8 hours absolute in this development environment.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {busy && <p role="status">Loading or recording account security…</p>}
      {uncertain && (
        <button
          disabled={busy}
          onClick={() =>
            void revoke(pending.current.targetId, pending.current.allOthers)
          }
        >
          Retry same session revocation
        </button>
      )}
      <button disabled={busy || uncertain} onClick={() => void refresh()}>
        Refresh account security
      </button>
      <h3>Active sessions</h3>
      {!busy && !sessions.length && (
        <p>No active sessions are available in this view.</p>
      )}
      {sessions.map((s) => (
        <article key={s.id}>
          <p>
            <strong>{s.current ? "This session" : "Other session"}</strong> ·{" "}
            {s.auth_method} · {s.mfa ? "MFA verified" : "Development password"}
          </p>
          <p>
            Created {new Date(s.created_at).toLocaleString()} · Last used{" "}
            {new Date(s.last_seen_at).toLocaleString()} · Expires{" "}
            {new Date(s.expires_at).toLocaleString()}
          </p>
          <small>Session reference: {s.id}</small>
          {!s.current && (
            <button
              disabled={busy || uncertain}
              onClick={() => void revoke(s.id, false)}
            >
              Revoke session {s.id}
            </button>
          )}
        </article>
      ))}
      {nextSessions && (
        <button
          disabled={busy || uncertain}
          onClick={() =>
            void load("sessions", nextSessions).catch((e) =>
              setError(e.message),
            )
          }
        >
          More sessions
        </button>
      )}
      <button
        disabled={busy || uncertain}
        onClick={() => void revoke(null, true)}
      >
        Sign out other sessions
      </button>
      {!confirmAll ? (
        <button
          disabled={busy || uncertain}
          onClick={() => setConfirmAll(true)}
        >
          Review sign out everywhere
        </button>
      ) : (
        <div role="group" aria-label="Confirm sign out everywhere">
          <p>
            End every EOMS session, including this device. A later fresh sign-in
            starts a new session. Your identity-provider session is managed
            separately.
          </p>
          <button
            disabled={busy || uncertain}
            onClick={() => void onSignOutAll()}
          >
            Confirm sign out everywhere
          </button>
          <button
            disabled={busy || uncertain}
            onClick={() => setConfirmAll(false)}
          >
            Cancel sign out everywhere
          </button>
        </div>
      )}
      <h3>Change password or recover access</h3>
      {options?.securityUrl && (
        <p>
          <a href={options.securityUrl} rel="noreferrer">
            Manage password and MFA with your organization
          </a>
        </p>
      )}
      {options?.localEnabled &&
        sessions.find((s) => s.current)?.auth_method !== "oidc" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                values = new FormData(form);
              setBusy(true);
              onPending(true);
              setError("");
              void api("/auth/password", {
                currentPassword: values.get("currentPassword"),
                newPassword: values.get("newPassword"),
              })
                .then(() => {
                  form.reset();
                  onCredentialChanged();
                })
                .catch((e) => {
                  setError(
                    e instanceof RequestFailure
                      ? e.message
                      : "We could not confirm the password change. Try signing in with your new password; request recovery if needed.",
                  );
                })
                .finally(() => {
                  setBusy(false);
                  onPending(false);
                });
            }}
          >
            <label>
              Current password
              <input
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
                disabled={busy || uncertain}
              />
            </label>
            <label>
              New password
              <input
                name="newPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                disabled={busy || uncertain}
              />
            </label>
            <p>
              Use 12–128 characters and a different password. Changing it ends
              all sessions. Sync device drafts before continuing.
            </p>
            <button disabled={busy || uncertain}>
              Change password and end sessions
            </button>
          </form>
        )}
      <SecurityOperator
        api={api}
        disabled={ownBusy || uncertain || lifecyclePending || onboardingPending}
        onPending={(pending) => {
          setOperatorPending(pending);
          onPending(
            pending || uncertain || lifecyclePending || onboardingPending,
          );
        }}
      />
      <UserLifecycle
        api={api}
        disabled={ownBusy || uncertain || operatorPending || onboardingPending}
        onPending={(value) => {
          setLifecyclePending(value);
          onPending(value || uncertain || operatorPending || onboardingPending);
        }}
      />
      <Onboarding
        api={api}
        disabled={ownBusy || uncertain || operatorPending || lifecyclePending}
        onPending={(v) => {
          setOnboardingPending(v);
          onPending(v || uncertain || operatorPending || lifecyclePending);
        }}
      />
      <AccessManifest api={api} disabled={busy || uncertain} />
      <h3>Security history</h3>
      <p>
        Only events for your own account are shown. Detailed events contain safe
        references, not credentials or tokens.
      </p>
      {events.map((e) => (
        <article key={e.id}>
          <p>
            {e.action} · {new Date(e.created_at).toLocaleString()}
          </p>
          <button
            disabled={uncertain}
            onClick={() => setDetail(detail === e.id ? null : e.id)}
          >
            Details for security event {e.id}
          </button>
          {detail === e.id && (
            <dl>
              <dt>Actor</dt>
              <dd>{e.actor_id ?? "Authorized support / system event"}</dd>
              <dt>Request reference</dt>
              <dd>{e.request_id ?? "Operator event; no HTTP request"}</dd>
              <dt>Session reference</dt>
              <dd>{e.session_id ?? "Account event"}</dd>
              <dt>Recorded detail</dt>
              <dd>
                <pre>{JSON.stringify(e.detail, null, 2)}</pre>
              </dd>
            </dl>
          )}
        </article>
      ))}
      {nextEvents && (
        <button
          disabled={busy || uncertain}
          onClick={() =>
            void load("events", nextEvents).catch((e) => setError(e.message))
          }
        >
          More security events
        </button>
      )}
    </section>
  );
}
