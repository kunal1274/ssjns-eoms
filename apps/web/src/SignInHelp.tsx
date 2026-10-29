import { useState } from "react";
export function SignInHelp({
  api,
  options,
  busy,
  onOrganizationSignIn,
}: {
  api: (path: string, body?: unknown) => Promise<any>;
  options: any;
  busy: boolean;
  onOrganizationSignIn: () => void;
}) {
  const [open, setOpen] = useState(false),
    [working, setWorking] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  return (
    <section aria-label="Sign-in help">
      {options?.oidcEnabled && (
        <button disabled={busy || working} onClick={onOrganizationSignIn}>
          Sign in with your organization
        </button>
      )}
      <button disabled={busy || working} onClick={() => setOpen(!open)}>
        Recover access
      </button>
      {open && (
        <div>
          <h2>Recover access</h2>
          <p>
            Never share your password. Use your organization identity provider,
            or contact authorized support for this development environment.
          </p>
          {options?.recoveryUrl && (
            <p>
              <a href={options.recoveryUrl} rel="noreferrer">
                Recover through your organization
              </a>
            </p>
          )}
          {message && <p role="status">{message}</p>}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setWorking(true);
              setError("");
              void api("/auth/recovery", { email: f.get("email") })
                .then((v) =>
                  setMessage(v.message + " Reference: " + v.requestId),
                )
                .catch((e) => setError(e.message))
                .finally(() => setWorking(false));
            }}
          >
            <label>
              Recovery email
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
                maxLength={254}
                disabled={working}
              />
            </label>
            <button disabled={working || busy}>
              Request recovery guidance
            </button>
          </form>
          {options?.localEnabled && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget,
                  f = new FormData(form);
                setWorking(true);
                setError("");
                setMessage("");
                void api("/auth/recovery/reset", {
                  token: f.get("token"),
                  password: f.get("password"),
                })
                  .then((v) => {
                    form.reset();
                    setMessage(v.message + " Reference: " + v.requestId);
                  })
                  .catch((e) =>
                    setError(
                      e.message ||
                        "We could not confirm the reset. Try signing in with your new password or request a new token.",
                    ),
                  )
                  .finally(() => setWorking(false));
              }}
            >
              <p>
                After support verifies your identity, paste the one-time token
                supplied through the agreed secure channel. It expires after 15
                minutes and can be used once. This page does not send email. If
                a reset result is unclear, try signing in with your new password
                before requesting another token.
              </p>
              <label>
                Recovery token
                <input
                  name="token"
                  type="password"
                  autoComplete="off"
                  required
                  pattern="[a-f0-9]{64}"
                  disabled={working}
                />
              </label>
              <label>
                Replacement password
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                  disabled={working}
                />
              </label>
              <button disabled={working || busy}>
                Reset development password
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
