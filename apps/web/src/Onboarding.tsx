import { useEffect, useRef, useState } from "react";
import { RequestFailure } from "./feedback";
type Api = (path: string, body?: unknown) => Promise<any>;
export function Onboarding({
  api,
  onPending,
  disabled,
}: {
  api: Api;
  onPending: (v: boolean) => void;
  disabled: boolean;
}) {
  const [context, setContext] = useState<any>(null),
    [customer, setCustomer] = useState(""),
    [choices, setChoices] = useState<any[]>([]),
    [next, setNext] = useState<string | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [targetId, setTargetId] = useState(""),
    [target, setTarget] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [unknown, setUnknown] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [invitation, setInvitation] = useState(""),
    [options, setOptions] = useState<any>(null),
    [detail, setDetail] = useState<string | null>(null);
  const [search, setSearch] = useState(""),
    [searched, setSearched] = useState(""),
    [found, setFound] = useState<any[]>([]),
    [moreUsers, setMoreUsers] = useState<string | null>(null);
  const pending = useRef<any>(null),
    secret = useRef(""),
    live = useRef(true),
    form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
      secret.current = "";
    };
  }, []);
  const query = (id = targetId) =>
    "?" +
    new URLSearchParams({
      ...(customer ? { customerId: customer } : {}),
      ...(id ? { targetId: id } : {}),
    });
  async function load() {
    setBusy(true);
    setError("");
    try {
      const [v, o] = await Promise.all([
        api("/auth/onboarding/context"),
        api("/auth/options"),
      ]);
      if (live.current) {
        setContext(v);
        setOptions(o);
      }
    } catch (e) {
      if (live.current) setError((e as Error).message);
    } finally {
      if (live.current) setBusy(false);
    }
  }
  async function estates(id: string, after?: string | null) {
    setBusy(true);
    setError("");
    try {
      const v = await api(
        "/auth/onboarding/estates?" +
          new URLSearchParams({ customerId: id, ...(after ? { after } : {}) }),
      );
      if (live.current) {
        setChoices((old) => (after ? [...old, ...v.items] : v.items));
        setNext(v.next);
      }
    } catch (e) {
      if (live.current) setError((e as Error).message);
    } finally {
      if (live.current) setBusy(false);
    }
  }
  async function preview(id = targetId, more = false) {
    setBusy(true);
    setError("");
    try {
      const v = await api(
        "/auth/onboarding/context" +
          query(id) +
          (more && target?.historyNextCursor
            ? "&cursor=" + encodeURIComponent(target.historyNextCursor)
            : ""),
      );
      if (live.current && v?.state === "staged")
        setSelected(v.proposedEstates.map((e: any) => e.estateId));
      if (live.current)
        setTarget((old: any) =>
          more ? { ...v, history: [...old.history, ...v.history] } : v,
        );
    } catch (e) {
      if (live.current) {
        setError((e as Error).message);
        if (e instanceof RequestFailure && [401, 403].includes(e.status)) {
          setTarget(null);
          setChoices([]);
        }
      }
    } finally {
      if (live.current) setBusy(false);
    }
  }
  async function findUsers(more = false) {
    setBusy(true);
    setError("");
    try {
      const q = more ? searched : search.trim();
      const v = await api(
        "/auth/onboarding/users?" +
          new URLSearchParams({
            ...(customer ? { customerId: customer } : {}),
            q,
            ...(more && moreUsers ? { cursor: moreUsers } : {}),
          }),
      );
      if (live.current) {
        setFound((old) => (more ? [...old, ...v.items] : v.items));
        setMoreUsers(v.nextCursor);
        setSearched(q);
      }
    } catch (e) {
      if (live.current) {
        setError((e as Error).message);
        if (e instanceof RequestFailure && [401, 403].includes(e.status)) {
          setFound([]);
          setTarget(null);
          setMoreUsers(null);
        }
      }
    } finally {
      if (live.current) setBusy(false);
    }
  }
  async function write() {
    setBusy(true);
    onPending(true);
    setError("");
    setNotice("");
    try {
      const r = await api("/auth/onboarding/write", pending.current);
      const op = pending.current.operation;
      pending.current = null;
      setUnknown(false);
      onPending(false);
      if (!live.current) return;
      setNotice(
        `Recorded ${op}. Audit event ${r.eventId}; request ${r.requestId}. ${r.replayed ? "Recovered the original receipt." : ""}`,
      );
      if (op === "invite") {
        setInvitation(location.origin + "/#invite=" + secret.current);
      } else {
        setInvitation("");
        secret.current = "";
      }
      setTargetId(r.targetId);
      setTarget(null);
      if (op === "stage") {
        form.current?.reset();
        setSelected([]);
      }
      await preview(r.targetId);
    } catch (e) {
      if (!live.current) return;
      if (e instanceof RequestFailure && e.status < 500) {
        pending.current = null;
        secret.current = "";
        setInvitation("");
        setUnknown(false);
        onPending(false);
        setTarget(null);
        setError(
          e.message + " Refresh the scoped account before another decision.",
        );
      } else {
        setUnknown(true);
        setError(
          "Result unknown. Keep this page open and retry the same onboarding action to recover its receipt.",
        );
      }
    } finally {
      if (live.current) setBusy(false);
    }
  }
  const locked = busy || unknown || disabled;
  if (!context)
    return error ? (
      <section aria-label="User onboarding">
        <p role="alert">{error}</p>
        <button disabled={locked} onClick={() => void load()}>
          Retry onboarding access check
        </button>
      </section>
    ) : null;
  if (!context.global && !context.customers.length) return null;
  const prepare = (operation: string, input: any) => {
    pending.current = {
      operation,
      key: crypto.randomUUID(),
      input: { customerId: customer || null, ...input },
    };
    void write();
  };
  return (
    <section className="card" aria-label="User onboarding">
      <h3>User onboarding and customer access</h3>
      <p>
        1. Choose your administrative scope. 2. Register the employee reference
        and proposed estates. 3. Prepare and securely hand over an invitation.
        4. The recipient accepts and signs in. Preparation does not send email.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {busy && <p role="status">Loading or recording onboarding…</p>}
      <label>
        Onboarding customer
        <select
          aria-label="Onboarding customer"
          value={customer}
          disabled={locked}
          onChange={(e) => {
            setCustomer(e.target.value);
            setSearch("");
            setSearched("");
            setFound([]);
            setMoreUsers(null);
            setChoices([]);
            setSelected([]);
            setNext(null);
            setTarget(null);
            setTargetId("");
            setInvitation("");
            secret.current = "";
            if (e.target.value) void estates(e.target.value);
          }}
        >
          {!context.global && (
            <option value="" disabled>
              Choose customer
            </option>
          )}
          {context.global && (
            <option value="">Platform identity only — no estate access</option>
          )}
          {context.customers.map((c: any) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {customer || context.global ? (
        <>
          <h4>Register a new user</h4>
          <p>
            Employee ID is an explicit supplied reference. HR master
            verification and the complete operational position catalogue remain
            separate integrations; this demo uses the existing manager,
            supervisor and clerk roles.
          </p>
          <form
            ref={form}
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              prepare("stage", {
                email: d.get("email"),
                name: d.get("name"),
                userCode: d.get("userCode"),
                employeeReference: d.get("employeeReference"),
                estates: [...selected]
                  .sort()
                  .map((id) => ({ estateId: id, role: d.get("role") })),
                reference: d.get("reference"),
                reason: d.get("reason"),
              });
            }}
          >
            <label>
              New user email
              <input
                name="email"
                type="email"
                required
                maxLength={254}
                disabled={locked}
              />
            </label>
            <label>
              Full name
              <input name="name" required maxLength={160} disabled={locked} />
            </label>
            <label>
              User ID
              <input
                name="userCode"
                required
                maxLength={50}
                disabled={locked}
              />
            </label>
            <label>
              Employee ID reference
              <input
                name="employeeReference"
                required
                maxLength={100}
                disabled={locked}
              />
            </label>
            <label>
              Proposed estate role
              <select
                aria-label="Proposed estate role"
                name="role"
                required
                disabled={locked || !customer}
              >
                <option value="clerk">Clerk</option>
                <option value="supervisor">Supervisor</option>
                <option value="manager">Manager</option>
              </select>
            </label>
            {customer && (
              <fieldset disabled={locked}>
                <legend>Proposed estates — select all required estates</legend>
                <button type="button" onClick={() => setSelected([])}>
                  Clear proposed estate selection
                </button>
                {choices.map((e) => (
                  <label key={e.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(e.id)}
                      onChange={(v) =>
                        setSelected((old) =>
                          v.target.checked
                            ? [...old, e.id]
                            : old.filter((id) => id !== e.id),
                        )
                      }
                    />
                    {e.name} ({e.code})
                  </label>
                ))}
                {next && (
                  <button
                    type="button"
                    onClick={() => void estates(customer, next)}
                  >
                    More onboarding estates
                  </button>
                )}
                <p>
                  {selected.length} estate(s) selected. Access is granted only
                  after acceptance.
                </p>
              </fieldset>
            )}
            <label>
              Registration reference
              <input
                name="reference"
                required
                minLength={5}
                maxLength={200}
                disabled={locked}
              />
            </label>
            <label>
              Registration reason
              <textarea
                name="reason"
                required
                minLength={10}
                maxLength={500}
                disabled={locked}
              />
            </label>
            <button disabled={locked}>Create staged user</button>
          </form>
          <h4>Find a scoped registration or existing assigned user</h4>
          <p>
            Search by name, email or user ID to recover a saved registration,
            including one whose response was lost. Only this administrative
            scope is searched.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void findUsers();
            }}
          >
            <label>
              Search onboarding users
              <input
                value={search}
                maxLength={100}
                disabled={locked}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <button disabled={locked}>Find onboarding users</button>
          </form>
          <ul aria-label="Scoped onboarding search results">
            {found.map((u) => (
              <li key={u.id}>
                {u.name} · {u.user_code ?? u.email} · {u.state}
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    setTargetId(u.id);
                    setInvitation("");
                    secret.current = "";
                    void preview(u.id);
                  }}
                >
                  Open onboarding user {u.id}
                </button>
              </li>
            ))}
          </ul>
          {moreUsers && (
            <button disabled={locked} onClick={() => void findUsers(true)}>
              More onboarding users
            </button>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              setInvitation("");
              secret.current = "";
              void preview();
            }}
          >
            <label>
              Onboarding account UUID
              <input
                value={targetId}
                required
                pattern="[a-fA-F0-9-]{36}"
                disabled={locked}
                onChange={(e) => {
                  setTargetId(e.target.value);
                  setTarget(null);
                  setInvitation("");
                  secret.current = "";
                }}
              />
            </label>
            <button disabled={locked}>Preview onboarding account</button>
          </form>
          {target && (
            <>
              <p>
                {target.name} · Account: {target.state} · Customer access:{" "}
                {target.accessState}
              </p>
              <p>
                Registration: {target.userCode ?? "Existing assigned user"} ·
                Employee reference:{" "}
                {target.employeeReference ?? "Not registered here"}
              </p>
              <h4>Current customer estate assignments</h4>
              <ul aria-label="Current customer estate assignments">
                {target.assignments?.map((e: any) => (
                  <li key={e.estateId}>
                    {e.name} ({e.estateId}) — {e.role}
                  </li>
                ))}
              </ul>
              {target.state === "active" && target.accessState !== "active" && (
                <>
                  <h4>Retained assignments for reviewed reactivation</h4>
                  <ul>
                    {target.retainedAssignments?.map((e: any) => (
                      <li key={e.estateId}>
                        {choices.find((c) => c.id === e.estateId)?.name ??
                          e.estateId}{" "}
                        — {e.role}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {target.reopenAllowed && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const d = new FormData(e.currentTarget);
                    prepare("reopen", {
                      targetId: target.id,
                      revision: target.registrationRevision,
                      reviewed: true,
                      reference: d.get("reference"),
                      reason: d.get("reason"),
                    });
                  }}
                >
                  <h4>Recover an unaccepted registration</h4>
                  <p>
                    This returns the registration to staged, invalidates pending
                    invitations and grants no sign-in or estate access. Review
                    the registration and prepare a fresh invitation afterward.
                    Both platform lifecycle and scoped onboarding authority are
                    required.
                  </p>
                  <label>
                    Registration recovery reference
                    <input
                      name="reference"
                      required
                      minLength={5}
                      maxLength={200}
                      disabled={locked}
                    />
                  </label>
                  <label>
                    Registration recovery reason
                    <textarea
                      name="reason"
                      required
                      minLength={10}
                      maxLength={500}
                      disabled={locked}
                    />
                  </label>
                  <label>
                    <input type="checkbox" required disabled={locked} />I
                    reviewed this unaccepted registration and the need to
                    restart invitation acceptance.
                  </label>
                  <button disabled={locked}>
                    Reopen registration without activating
                  </button>
                </form>
              )}
              {target.state !== "active" && target.state !== "staged" && (
                <p role="status">
                  The global account is {target.state}. Customer access does not
                  reactivate the identity. Ask an authorized platform lifecycle
                  operator to review the account.
                </p>
              )}
              {target.state === "staged" && (
                <>
                  <h4>Proposed access after invitation acceptance</h4>
                  <ul>
                    {target.proposedEstates?.map((e: any) => (
                      <li key={e.estateId}>
                        {choices.find((c) => c.id === e.estateId)?.name ??
                          e.estateId}{" "}
                        — {e.role}
                      </li>
                    ))}
                  </ul>
                  <details>
                    <summary>
                      Correct the staged registration before acceptance
                    </summary>
                    <form
                      key={"amend" + target.id + target.registrationRevision}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const d = new FormData(e.currentTarget);
                        prepare("amend", {
                          targetId: target.id,
                          revision: target.registrationRevision,
                          email: d.get("email"),
                          name: d.get("name"),
                          userCode: d.get("userCode"),
                          employeeReference: d.get("employeeReference"),
                          estates: [...selected].sort().map((id) => ({
                            estateId: id,
                            role: d.get("role"),
                          })),
                          reference: d.get("reference"),
                          reason: d.get("reason"),
                        });
                      }}
                    >
                      <p>
                        This correction replaces the staged proposal using the
                        estate checkboxes above and invalidates every pending
                        invitation. Review and prepare a new invitation
                        afterward.
                      </p>
                      <label>
                        Revised email
                        <input
                          name="email"
                          type="email"
                          defaultValue={target.email}
                          required
                          maxLength={254}
                          disabled={locked}
                        />
                      </label>
                      <label>
                        Revised full name
                        <input
                          name="name"
                          defaultValue={target.name}
                          required
                          maxLength={160}
                          disabled={locked}
                        />
                      </label>
                      <label>
                        Revised user ID
                        <input
                          name="userCode"
                          defaultValue={target.userCode}
                          required
                          maxLength={50}
                          disabled={locked}
                        />
                      </label>
                      <label>
                        Revised employee reference
                        <input
                          name="employeeReference"
                          defaultValue={target.employeeReference}
                          required
                          maxLength={100}
                          disabled={locked}
                        />
                      </label>
                      <label>
                        Revised estate role
                        <select
                          aria-label="Revised estate role"
                          name="role"
                          defaultValue={
                            target.proposedEstates?.[0]?.role ?? "clerk"
                          }
                          disabled={locked || !customer}
                        >
                          <option value="clerk">Clerk</option>
                          <option value="supervisor">Supervisor</option>
                          <option value="manager">Manager</option>
                        </select>
                      </label>
                      <label>
                        Correction reference
                        <input
                          name="reference"
                          required
                          minLength={5}
                          maxLength={200}
                          disabled={locked}
                        />
                      </label>
                      <label>
                        Correction reason
                        <textarea
                          name="reason"
                          required
                          minLength={10}
                          maxLength={500}
                          disabled={locked}
                        />
                      </label>
                      <label>
                        <input type="checkbox" required disabled={locked} />I
                        reviewed the corrected identity and replacement estate
                        proposal.
                      </label>
                      <button disabled={locked}>
                        Save staged registration correction
                      </button>
                    </form>
                  </details>
                </>
              )}
              {target.state === "staged" && target.registrationRevision && (
                <form
                  key={target.id + ":" + target.registrationRevision}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const d = new FormData(e.currentTarget);
                    const bytes = crypto.getRandomValues(new Uint8Array(32));
                    secret.current = Array.from(bytes, (b) =>
                      b.toString(16).padStart(2, "0"),
                    ).join("");
                    setInvitation("");
                    prepare("invite", {
                      targetId: target.id,
                      revision: target.registrationRevision,
                      token: secret.current,
                      method: d.get("method"),
                      ...(d.get("method") === "oidc"
                        ? { subject: d.get("subject") }
                        : {}),
                      reference: d.get("reference"),
                      reason: d.get("reason"),
                    });
                  }}
                >
                  <label>
                    Invitation method
                    <select
                      aria-label="Invitation method"
                      name="method"
                      required
                      disabled={locked}
                    >
                      {options?.localEnabled && (
                        <option value="local">
                          Development password enrollment
                        </option>
                      )}
                      {options?.oidcEnabled && (
                        <option value="oidc">
                          Approved organization identity
                        </option>
                      )}
                    </select>
                  </label>
                  <label>
                    Approved identity subject
                    <input name="subject" maxLength={255} disabled={locked} />
                  </label>
                  <p>
                    Organization enrollment requires the exact subject confirmed
                    by the identity administrator; an email address does not
                    automatically link an identity.
                  </p>
                  <label>
                    Invitation reference
                    <input
                      name="reference"
                      required
                      minLength={5}
                      maxLength={200}
                      disabled={locked}
                    />
                  </label>
                  <label>
                    Invitation reason
                    <textarea
                      name="reason"
                      required
                      minLength={10}
                      maxLength={500}
                      disabled={locked}
                    />
                  </label>
                  <button
                    disabled={
                      locked ||
                      (!options?.localEnabled && !options?.oidcEnabled)
                    }
                  >
                    Prepare or reissue invitation
                  </button>
                </form>
              )}
              {invitation && (
                <div>
                  <p role="status">
                    Invitation prepared, not sent. This secret link expires
                    after 24 hours and can be accepted once. Hand it over
                    through the agreed secure channel. Reissuing invalidates
                    older links.
                  </p>
                  <label>
                    Prepared invitation link
                    <input
                      type="password"
                      readOnly
                      value={invitation}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                  </label>
                  <button
                    disabled={locked}
                    onClick={() => {
                      setInvitation("");
                      secret.current = "";
                    }}
                  >
                    Hide invitation secret
                  </button>
                </div>
              )}
              {target.invitations?.map((i: any) => (
                <article key={i.id}>
                  <p>
                    Invitation {i.id} · {i.state} · {i.method} · Expires{" "}
                    {new Date(i.expiresAt).toLocaleString()}
                  </p>
                  {i.state === "pending" && target.state === "staged" && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const d = new FormData(e.currentTarget);
                        prepare("cancel", {
                          targetId: target.id,
                          revision: target.registrationRevision,
                          invitationId: i.id,
                          reference: d.get("reference"),
                          reason: d.get("reason"),
                        });
                      }}
                    >
                      <label>
                        Cancellation reference
                        <input
                          name="reference"
                          required
                          minLength={5}
                          maxLength={200}
                          disabled={locked}
                        />
                      </label>
                      <label>
                        Cancellation reason
                        <textarea
                          name="reason"
                          required
                          minLength={10}
                          maxLength={500}
                          disabled={locked}
                        />
                      </label>
                      <button disabled={locked}>
                        Cancel invitation {i.id}
                      </button>
                    </form>
                  )}
                </article>
              ))}
              {customer && target.state === "active" && (
                <form
                  key={"access" + target.id + target.accessRevision}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const d = new FormData(e.currentTarget);
                    prepare("access", {
                      targetId: target.id,
                      revision: target.accessRevision,
                      scopeRevision: target.scopeRevision,
                      state: d.get("state"),
                      reference: d.get("reference"),
                      reason: d.get("reason"),
                    });
                  }}
                >
                  <h4>Change access in this customer only</h4>
                  <p>
                    Other customers and the global account stay unchanged. A
                    setup administrator needs a separate setup handover first.
                    Retained estate assignments are restored only by an explicit
                    reactivation.
                  </p>
                  <label>
                    New customer access state
                    <select
                      aria-label="New customer access state"
                      name="state"
                      defaultValue=""
                      required
                      disabled={locked}
                    >
                      <option value="" disabled>
                        Choose a change
                      </option>
                      {target.state === "active" &&
                        target.accessState !== "active" && (
                          <option value="active">
                            Reactivate customer access
                          </option>
                        )}
                      {target.accessState === "active" && (
                        <option value="suspended">
                          Suspend customer access
                        </option>
                      )}
                      {target.accessState !== "deactivated" && (
                        <option value="deactivated">
                          Deactivate customer access
                        </option>
                      )}
                    </select>
                  </label>
                  <label>
                    Customer access reference
                    <input
                      name="reference"
                      required
                      minLength={5}
                      maxLength={200}
                      disabled={locked}
                    />
                  </label>
                  <label>
                    Customer access reason
                    <textarea
                      name="reason"
                      required
                      minLength={10}
                      maxLength={500}
                      disabled={locked}
                    />
                  </label>
                  <button disabled={locked}>
                    Record customer access change
                  </button>
                </form>
              )}
              {customer && target.state === "active" && (
                <form
                  key={"assign" + target.id + target.scopeRevision}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const d = new FormData(e.currentTarget);
                    prepare("assign", {
                      targetId: target.id,
                      revision: target.accessRevision,
                      scopeRevision: target.scopeRevision,
                      estates: [...selected]
                        .sort()
                        .map((id) => ({ estateId: id, role: d.get("role") })),
                      reference: d.get("reference"),
                      reason: d.get("reason"),
                    });
                  }}
                >
                  <h4>Replace estate assignments in this customer</h4>
                  <p>
                    Use the estate checkboxes above. This replaces this
                    customer's assignments with exactly {selected.length}{" "}
                    selected estate(s); other customers remain unchanged. For a
                    suspended customer account, the selection is retained until
                    explicit reactivation.
                  </p>
                  <label>
                    Replacement estate role
                    <select
                      aria-label="Replacement estate role"
                      name="role"
                      disabled={locked}
                    >
                      <option value="clerk">Clerk</option>
                      <option value="supervisor">Supervisor</option>
                      <option value="manager">Manager</option>
                    </select>
                  </label>
                  <label>
                    Assignment reference
                    <input
                      name="reference"
                      required
                      minLength={5}
                      maxLength={200}
                      disabled={locked}
                    />
                  </label>
                  <label>
                    Assignment reason
                    <textarea
                      name="reason"
                      required
                      minLength={10}
                      maxLength={500}
                      disabled={locked}
                    />
                  </label>
                  <label>
                    <input type="checkbox" required disabled={locked} />I
                    reviewed the replacement estate selection and its effect.
                  </label>
                  <button disabled={locked}>
                    Replace customer estate assignments
                  </button>
                </form>
              )}
              <h4>Registration history</h4>
              {target.history?.map((h: any) => (
                <article key={h.id}>
                  <p>
                    {h.action} · {new Date(h.created_at).toLocaleString()}
                  </p>
                  <button
                    disabled={locked}
                    onClick={() => setDetail(detail === h.id ? null : h.id)}
                  >
                    Details for registration event {h.id}
                  </button>
                  {detail === h.id && (
                    <dl>
                      <dt>Actor</dt>
                      <dd>{h.actor_id}</dd>
                      <dt>Reference</dt>
                      <dd>{h.detail.reference}</dd>
                      <dt>Reason</dt>
                      <dd>{h.detail.reason}</dd>
                      <dt>Request</dt>
                      <dd>{h.request_id}</dd>
                      <dt>Previous registration</dt>
                      <dd>
                        {h.detail.beforeIdentity
                          ? Object.values(h.detail.beforeIdentity).join(" · ")
                          : "Not applicable"}
                      </dd>
                      <dt>Recorded registration</dt>
                      <dd>
                        {h.detail.afterIdentity
                          ? Object.values(h.detail.afterIdentity).join(" · ")
                          : "Not applicable"}
                      </dd>
                      <dt>Recorded result</dt>
                      <dd>
                        {h.detail.result?.state ?? h.detail.method ?? h.action}
                      </dd>
                      <dt>Previous estate assignments</dt>
                      <dd>
                        {h.detail.beforeAssignments
                          ?.map((e: any) => e.estateId + " (" + e.role + ")")
                          .join(", ") ?? "Not applicable"}
                      </dd>
                      <dt>Recorded estate assignments</dt>
                      <dd>
                        {(h.detail.afterAssignments ?? h.detail.estatesGranted)
                          ?.map((e: any) => e.estateId + " (" + e.role + ")")
                          .join(", ") ?? "Not applicable"}
                      </dd>
                    </dl>
                  )}
                </article>
              ))}
              {target.historyNextCursor && (
                <button
                  disabled={locked}
                  onClick={() => void preview(target.id, true)}
                >
                  More registration history
                </button>
              )}
            </>
          )}
        </>
      ) : (
        <p>Choose a customer you are explicitly authorized to administer.</p>
      )}
      {unknown && (
        <button disabled={busy} onClick={() => void write()}>
          Retry same onboarding action
        </button>
      )}
    </section>
  );
}
export function AcceptInvitation({
  api,
  options,
  busy,
}: {
  api: Api;
  options: any;
  busy: boolean;
}) {
  const [opened, setOpened] = useState(() =>
      location.hash.startsWith("#invite="),
    ),
    [proof, setProof] = useState(() =>
      location.hash.startsWith("#invite=") ? location.hash.slice(8) : "",
    ),
    [working, setWorking] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (location.hash.startsWith("#invite="))
      history.replaceState({}, "", location.pathname + location.search);
  }, []);
  return (
    <section aria-label="Accept user invitation">
      <button disabled={busy || working} onClick={() => setOpened((v) => !v)}>
        Accept an invitation
      </button>
      {opened && (
        <>
          <h2>Accept your invitation</h2>
          <p>
            Use the secret supplied by your authorized administrator.
            Invitations expire, can be cancelled or replaced, and can be
            accepted once. If a result is unclear, try signing in before
            requesting another link.
          </p>
          {error && <p role="alert">{error}</p>}
          {message && <p role="status">{message}</p>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const d = new FormData(form);
              setWorking(true);
              setError("");
              void api("/auth/enrollment/accept", {
                token: proof,
                password: d.get("password"),
              })
                .then((v) => {
                  setMessage(
                    v.message +
                      " Audit event " +
                      v.eventId +
                      "; request " +
                      v.requestId,
                  );
                  setProof("");
                  form.reset();
                })
                .catch((e) => setError(e.message))
                .finally(() => setWorking(false));
            }}
          >
            <label>
              Invitation token
              <input
                type="password"
                value={proof}
                onChange={(e) => setProof(e.target.value)}
                required
                pattern="[a-f0-9]{64}"
                autoComplete="off"
                disabled={working || busy}
              />
            </label>
            {options?.localEnabled && (
              <>
                <label>
                  Choose your development password
                  <input
                    name="password"
                    type="password"
                    required
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                    disabled={working || busy}
                  />
                </label>
                <button disabled={working || busy}>
                  Accept development invitation
                </button>
              </>
            )}
          </form>
          {options?.oidcEnabled && (
            <button
              disabled={working || busy || !/^[a-f0-9]{64}$/.test(proof)}
              onClick={() => {
                setWorking(true);
                setError("");
                void api("/auth/enrollment/oidc/start", { token: proof })
                  .then((v) => location.assign(v.authorizationUrl))
                  .catch((e) => {
                    setError(e.message);
                    setWorking(false);
                  });
              }}
            >
              Accept with organization identity
            </button>
          )}
        </>
      )}
    </section>
  );
}

export function AccessManifest({
  api,
  disabled,
}: {
  api: Api;
  disabled: boolean;
}) {
  const [value, setValue] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    void refresh();
    return () => {
      live.current = false;
    };
  }, []);
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const v = await api("/auth/access-manifest");
      if (live.current) setValue(v);
    } catch (e) {
      if (live.current) {
        setError((e as Error).message);
        if (e instanceof RequestFailure && [401, 403].includes(e.status))
          setValue(null);
      }
    } finally {
      if (live.current) setBusy(false);
    }
  }
  return (
    <section aria-label="Account and device access sync">
      <h3>Account and device access sync</h3>
      <p>
        This check reads your current server-side login and customer access.
        Global deactivation ends EOMS sessions on the next protected request;
        customer suspension denies that customer's work while other authorized
        customers remain available. Offline drafts remain on the device;
        reconnect before signing in or syncing. This does not erase an offline
        device or end your identity-provider session.
      </p>
      {error && <p role="alert">{error}</p>}
      {value && (
        <>
          <p role="status">
            Account {value.accountState}. Server access checked{" "}
            {new Date(value.checkedAt).toLocaleString()}. Request{" "}
            {value.requestId}.
          </p>
          {value.registration && (
            <p>
              User ID: {value.registration.userCode} · Employee reference
              supplied by administrator: {value.registration.employeeReference}
            </p>
          )}
          {value.customerAccess.map((c: any) => (
            <p key={c.customerId}>
              {c.name}: {c.state}
            </p>
          ))}
          <ul>
            {value.estates.map((e: any) => (
              <li key={e.id}>
                {e.name}: {e.role}
              </li>
            ))}
          </ul>
        </>
      )}
      <button disabled={disabled || busy} onClick={() => void refresh()}>
        Refresh device access status
      </button>
    </section>
  );
}
