import { useEffect, useRef, useState } from "react";
import { RequestFailure } from "./feedback";
type Api = (path: string, body?: unknown) => Promise<any>;
export function CustomerInvitations({
  api,
  onPending,
  disabled,
}: {
  api: Api;
  onPending: (value: boolean) => void;
  disabled: boolean;
}) {
  const [context, setContext] = useState<any>(null),
    [customer, setCustomer] = useState(""),
    [own, setOwn] = useState<any>({ items: [], nextCursor: null }),
    [admin, setAdmin] = useState<any>({ items: [], nextCursor: null }),
    [choices, setChoices] = useState<any[]>([]),
    [nextEstate, setNextEstate] = useState<string | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [replacement, setReplacement] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [unknown, setUnknown] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [detail, setDetail] = useState<string | null>(null);
  const pending = useRef<any>(null),
    live = useRef(true),
    form = useRef<HTMLFormElement>(null);
  const locked = disabled || busy || unknown;
  useEffect(() => {
    live.current = true;
    void initial();
    return () => {
      live.current = false;
    };
  }, []);
  async function list(scope: string, more = false) {
    const current = scope ? admin : own;
    const v = await api(
      "/auth/customer-invitations?" +
        new URLSearchParams({
          ...(scope ? { customerId: scope } : {}),
          ...(more && current.nextCursor ? { cursor: current.nextCursor } : {}),
        }),
    );
    if (live.current)
      (scope ? setAdmin : setOwn)((old: any) => ({
        ...v,
        items: more ? [...old.items, ...v.items] : v.items,
      }));
  }
  async function initial() {
    setBusy(true);
    setError("");
    try {
      const c = await api("/auth/onboarding/context");
      if (live.current) setContext(c);
      await list("");
    } catch (e) {
      if (live.current) setError((e as Error).message);
    } finally {
      if (live.current) setBusy(false);
    }
  }
  async function read(scope: string, more = false) {
    setBusy(true);
    setError("");
    try {
      await list(scope, more);
    } catch (e) {
      if (live.current) {
        setError((e as Error).message);
        if (e instanceof RequestFailure && [401, 403].includes(e.status)) {
          (scope ? setAdmin : setOwn)({ items: [], nextCursor: null });
          setChoices([]);
          setReplacement(null);
        }
      }
    } finally {
      if (live.current) setBusy(false);
    }
  }
  async function estates(scope: string, after?: string) {
    setBusy(true);
    setError("");
    try {
      const v = await api(
        "/auth/onboarding/estates?" +
          new URLSearchParams({
            customerId: scope,
            ...(after ? { after } : {}),
          }),
      );
      if (live.current) {
        setChoices((old) => (after ? [...old, ...v.items] : v.items));
        setNextEstate(v.next);
      }
    } catch (e) {
      if (live.current) setError((e as Error).message);
    } finally {
      if (live.current) setBusy(false);
    }
  }
  async function selectScope(scope: string) {
    setCustomer(scope);
    setAdmin({ items: [], nextCursor: null });
    setChoices([]);
    setSelected([]);
    setNextEstate(null);
    setReplacement(null);
    setBusy(true);
    setError("");
    try {
      await list(scope);
      const v = await api("/auth/onboarding/estates?customerId=" + scope);
      if (live.current) {
        setChoices(v.items);
        setNextEstate(v.next);
      }
    } catch (e) {
      if (live.current) setError((e as Error).message);
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
      const { scope: _scope, ...envelope } = pending.current;
      const result = await api("/auth/customer-invitations", envelope);
      const scope = pending.current.scope;
      pending.current = null;
      setUnknown(false);
      onPending(false);
      if (!live.current) return;
      setNotice(
        `Invitation ${result.state}. Audit event ${result.eventId}; request ${result.requestId}. ${result.replayed ? "Recovered the original receipt." : ""} ${result.state === "accepted" ? "Refresh device access status and use estate search or reload the app to select your new estate context." : ""}`,
      );
      setReplacement(null);
      form.current?.reset();
      setSelected([]);
      // Read failure after an acknowledged write is not an unknown write outcome.
      await read(scope);
    } catch (e) {
      if (!live.current) return;
      if (e instanceof RequestFailure && e.status < 500) {
        pending.current = null;
        setUnknown(false);
        onPending(false);
        setError(e.message + " Refresh invitations before another decision.");
        if ([401, 403].includes(e.status)) {
          setOwn({ items: [], nextCursor: null });
          setAdmin({ items: [], nextCursor: null });
          setChoices([]);
          setReplacement(null);
        }
      } else {
        setUnknown(true);
        setError(
          "Result unknown. Keep this page open and retry the same invitation decision to recover its receipt.",
        );
      }
    } finally {
      if (live.current) setBusy(false);
    }
  }
  function prepare(operation: string, input: any, scope: string) {
    // The transport envelope excludes the local refresh scope.
    const envelope = { operation, key: crypto.randomUUID(), input };
    pending.current = { ...envelope, scope };
    void write();
  }
  const references = (prefix: string) => (
    <>
      <label>
        {prefix} reference
        <input
          name="reference"
          required
          minLength={5}
          maxLength={200}
          disabled={locked}
        />
      </label>
      <label>
        {prefix} reason
        <textarea
          name="reason"
          required
          minLength={10}
          maxLength={500}
          disabled={locked}
        />
      </label>
      <label>
        <input type="checkbox" name="reviewed" required disabled={locked} />I
        reviewed the customer, recipient, estate roles and effect of this
        decision.
      </label>
    </>
  );
  const history = (i: any) => (
    <>
      {i.history.map((h: any) => (
        <article key={h.id}>
          <p>
            {h.action} · {new Date(h.created_at).toLocaleString()}
          </p>
          <button
            type="button"
            disabled={locked}
            onClick={() => setDetail(detail === h.id ? null : h.id)}
          >
            Details for customer invitation event {h.id}
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
              <dt>Proposal</dt>
              <dd>
                {i.estates
                  .map((e: any) => e.name + " (" + e.role + ")")
                  .join(", ")}
              </dd>
              <dt>Recorded state</dt>
              <dd>{h.detail.afterState}</dd>
            </dl>
          )}
        </article>
      ))}
    </>
  );
  return (
    <section className="card" aria-label="Existing account invitations">
      <h3>Join another customer with your existing account</h3>
      <p>
        Use one account across customers. Only the signed-in recipient can
        accept a reviewed estate proposal. Preparing an invitation grants no
        access and sends no email. No password or identity-provider link is
        changed.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {busy && <p role="status">Loading or recording customer invitations…</p>}
      <h4>Invitations to my account</h4>
      <button disabled={locked} onClick={() => void read("")}>
        Refresh my customer invitations
      </button>
      {!own.items.length && !busy && (
        <p>No customer invitations are available for your account.</p>
      )}
      <div aria-label="My customer invitation list">
        {own.items.map((i: any) => (
          <article key={i.id}>
            <h5>
              {i.customer_name} · {i.state}
            </h5>
            <p>
              Invitation {i.id} · User ID: {i.user_code} · Employee reference
              supplied by administrator: {i.employee_reference} · Expires{" "}
              {new Date(i.expires_at).toLocaleString()}
            </p>
            <ul>
              {i.estates.map((e: any) => (
                <li key={e.estateId}>
                  {e.name}: {e.role}
                </li>
              ))}
            </ul>
            {i.state === "pending" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const d = new FormData(e.currentTarget);
                  prepare(
                    String(d.get("decision")),
                    {
                      customerId: i.customer_id,
                      invitationId: i.id,
                      reference: d.get("reference"),
                      reason: d.get("reason"),
                      reviewed: true,
                    },
                    "",
                  );
                }}
              >
                <p>
                  {i.accept_available
                    ? "Review this proposal before accepting. Existing customers and your account credentials are retained."
                    : "This invitation expired or its issuing authority changed. Request a fresh proposal or decline it; no access has been granted."}
                </p>
                <label>
                  Customer invitation decision
                  <select
                    aria-label="Customer invitation decision"
                    name="decision"
                    required
                    defaultValue=""
                    disabled={locked}
                  >
                    <option value="" disabled>
                      Choose accept or decline
                    </option>
                    {i.accept_available && (
                      <option value="accept">
                        Accept proposed customer access
                      </option>
                    )}
                    <option value="decline">Decline this invitation</option>
                  </select>
                </label>
                {references("Consent")}
                <button disabled={locked}>
                  Record my customer invitation decision
                </button>
              </form>
            )}
            {history(i)}
          </article>
        ))}
      </div>
      {own.nextCursor && (
        <button disabled={locked} onClick={() => void read("", true)}>
          More invitations to my account
        </button>
      )}
      {!!context?.customers.length && (
        <>
          <h4>Invite an existing account to this customer</h4>
          <p>
            Ask the recipient to share their account UUID from Account and
            device access sync through your agreed verification channel. This is
            not a global user search. Verify the recipient before preparing
            access.
          </p>
          <label>
            Existing-account invitation customer
            <select
              aria-label="Existing-account invitation customer"
              value={customer}
              disabled={locked}
              onChange={(e) => void selectScope(e.target.value)}
            >
              <option value="" disabled>
                Choose your customer
              </option>
              {context.customers.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {customer && (
            <>
              <form
                ref={form}
                key={replacement?.id ?? customer}
                onSubmit={(e) => {
                  e.preventDefault();
                  const d = new FormData(e.currentTarget);
                  prepare(
                    "prepare",
                    {
                      customerId: customer,
                      targetId: replacement?.user_id ?? d.get("targetId"),
                      userCode: d.get("userCode"),
                      employeeReference: d.get("employeeReference"),
                      replaceId: replacement?.id ?? null,
                      estates: [...selected]
                        .sort()
                        .map((estateId) => ({ estateId, role: d.get("role") })),
                      reference: d.get("reference"),
                      reason: d.get("reason"),
                      reviewed: true,
                    },
                    customer,
                  );
                }}
              >
                <label>
                  Existing recipient account UUID
                  <input
                    name="targetId"
                    defaultValue={replacement?.user_id ?? ""}
                    required
                    pattern="[a-fA-F0-9-]{36}"
                    disabled={locked || !!replacement}
                  />
                </label>
                <label>
                  Customer user ID
                  <input
                    name="userCode"
                    defaultValue={replacement?.user_code ?? ""}
                    required
                    maxLength={50}
                    disabled={locked}
                  />
                </label>
                <label>
                  Customer employee reference
                  <input
                    name="employeeReference"
                    defaultValue={replacement?.employee_reference ?? ""}
                    required
                    maxLength={100}
                    disabled={locked}
                  />
                </label>
                <label>
                  Invited estate role
                  <select
                    aria-label="Invited estate role"
                    name="role"
                    defaultValue={replacement?.estates[0]?.role ?? "clerk"}
                    disabled={locked}
                  >
                    <option value="clerk">Clerk</option>
                    <option value="supervisor">Supervisor</option>
                    <option value="manager">Manager</option>
                  </select>
                </label>
                <fieldset disabled={locked}>
                  <legend>Existing account proposed estates</legend>
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
                  {nextEstate && (
                    <button
                      type="button"
                      onClick={() => void estates(customer, nextEstate)}
                    >
                      More existing-account estates
                    </button>
                  )}
                  <p>
                    {selected.length} estate(s) proposed. At least one explicit
                    selection is required.
                  </p>
                </fieldset>
                {references("Existing-account invitation")}
                <button disabled={locked || !selected.length}>
                  Prepare existing-account invitation
                </button>
                {replacement && (
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => {
                      setReplacement(null);
                      setSelected([]);
                    }}
                  >
                    Clear replacement proposal
                  </button>
                )}
              </form>
              <button disabled={locked} onClick={() => void read(customer)}>
                Refresh customer invitation list
              </button>
              <div aria-label="Administrative customer invitation list">
                {admin.items.map((i: any) => (
                  <article key={i.id}>
                    <p>
                      Invitation {i.id} · Declared account {i.user_id} ·{" "}
                      {i.user_code} · {i.state}
                    </p>
                    <ul>
                      {i.estates.map((e: any) => (
                        <li key={e.estateId}>
                          {e.name}: {e.role}
                        </li>
                      ))}
                    </ul>
                    {i.state === "pending" && (
                      <>
                        <button
                          disabled={locked}
                          onClick={() => {
                            setReplacement(i);
                            setSelected(i.estates.map((e: any) => e.estateId));
                          }}
                        >
                          Review replacement for invitation {i.id}
                        </button>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const d = new FormData(e.currentTarget);
                            prepare(
                              "cancel",
                              {
                                customerId: customer,
                                invitationId: i.id,
                                reference: d.get("reference"),
                                reason: d.get("reason"),
                                reviewed: true,
                              },
                              customer,
                            );
                          }}
                        >
                          {references("Customer invitation cancellation")}
                          <button disabled={locked}>
                            Cancel customer invitation {i.id}
                          </button>
                        </form>
                      </>
                    )}
                    {history(i)}
                  </article>
                ))}
              </div>
              {admin.nextCursor && (
                <button
                  disabled={locked}
                  onClick={() => void read(customer, true)}
                >
                  More administrative customer invitations
                </button>
              )}
            </>
          )}
        </>
      )}
      {unknown && (
        <button disabled={busy} onClick={() => void write()}>
          Retry same customer invitation decision
        </button>
      )}
    </section>
  );
}
