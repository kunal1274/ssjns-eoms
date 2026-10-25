import { useEffect, useRef, useState } from "react";
import { RequestFailure } from "./feedback";
import { SearchSelect } from "./SearchSelect";
type Api = (path: string, body?: unknown) => Promise<any>;
export function HierarchyProvisioning({
  api,
  customerId,
  onPending,
  onOpenEstate,
}: {
  api: Api;
  customerId: string;
  onPending: (v: boolean) => void;
  onOpenEstate: (id: string) => void;
}) {
  const [caps, setCaps] = useState<any>(null),
    [history, setHistory] = useState<any>(null),
    [operation, setOperation] = useState("company"),
    [input, setInput] = useState<Record<string, string>>({}),
    [attempt, setAttempt] = useState(0),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [readError, setReadError] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(false),
    [last, setLast] = useState<any>(null);
  const live = useRef(true),
    write = useRef<{ path: string; body: any } | null>(null);
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
    setCaps(null);
    setHistory(null);
    (async () => {
      const c = await api(
          "/provisioning/capabilities" +
            (customerId ? "?customerId=" + customerId : ""),
        ),
        h = c.canManageCustomer
          ? await api(
              "/customers/" +
                customerId +
                "/provisioning?limit=10" +
                (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
            )
          : null;
      if (active) {
        setCaps(c);
        setHistory(h);
      }
    })()
      .catch((e) => {
        if (active) {
          setReadError(e.message);
          setLast(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [customerId, cursor, attempt]);
  const fields =
      operation === "customer"
        ? [
            "customerCode",
            "customerName",
            "companyCode",
            "companyName",
            "estateCode",
            "estateName",
            "initialAdminId",
            "reference",
            "reason",
          ]
        : operation === "company"
          ? ["companyCode", "companyName", "reference", "reason"]
          : [
              "companyId",
              "estateCode",
              "estateName",
              "initialManagerId",
              "reference",
              "reason",
            ],
    labels: Record<string, string> = {
      customerCode: "New customer code",
      customerName: "New customer name",
      companyCode: "New company code",
      companyName: "New company name",
      estateCode: "New estate code",
      estateName: "New estate name",
      initialAdminId: "Named initial administrator ID",
      initialManagerId: "Named initial estate manager ID",
      companyId: "Provision estate company",
      reference: "Provisioning authority reference",
      reason: "Provisioning reason",
    },
    permitted =
      operation === "customer" ? caps?.canBootstrap : caps?.canManageCustomer,
    valid =
      permitted &&
      fields.every((k) => {
        const v = (input[k] ?? "").trim();
        return k.endsWith("Id")
          ? /^[a-fA-F0-9-]{36}$/.test(v)
          : k.endsWith("Code")
            ? /^[A-Z0-9][A-Z0-9_-]{0,29}$/.test(v)
            : v.length >= (["reference", "reason"].includes(k) ? 3 : 1);
      }),
    locked = loading || busy || pending || !!readError;
  async function submit() {
    if (loading || busy || readError || (!write.current && !valid)) return;
    write.current ??= {
      path: "/provisioning/" + operation,
      body: {
        key: crypto.randomUUID(),
        ...(operation === "customer" ? {} : { customerId }),
        ...Object.fromEntries(fields.map((k) => [k, input[k].trim()])),
      },
    };
    const saved = write.current;
    setBusy(true);
    setPending(true);
    onPending(true);
    setError("");
    setNotice("");
    try {
      const r = await api(saved.path, saved.body);
      if (live.current) {
        setLast(r.receipt);
        setNotice(
          (r.replayed ? "Recovered existing receipt. " : "Recorded. ") +
            "Provisioning receipt " +
            r.receipt.id,
        );
        write.current = null;
        setPending(false);
        onPending(false);
        setInput({});
        setCursor(null);
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
              : " Refresh provisioning and inspect current records before correcting the retained draft."),
        );
        if (e instanceof RequestFailure && [401, 403, 404].includes(e.status)) {
          setCaps(null);
          setHistory(null);
          setLast(null);
        }
      }
    } finally {
      if (live.current) setBusy(false);
    }
  }
  return (
    <section
      aria-label="Hierarchy provisioning"
      style={{ overflowWrap: "anywhere", minWidth: 0 }}
    >
      <h3>Provision customer, company and estate</h3>
      <p>
        Platform bootstrap authority is separate from customer setup and estate
        work access. Name an existing active initial administrator explicitly.
        Parent creation never grants sibling or descendant work access.
      </p>
      <button
        disabled={loading || busy || pending}
        onClick={() => setAttempt((n) => n + 1)}
      >
        Refresh provisioning
      </button>
      {loading && <p role="status">Checking provisioning authority…</p>}
      {readError && <p role="alert">{readError}</p>}
      {caps && (
        <>
          <p data-provision-customer>
            Selected customer {customerId || "None"} · Setup authority{" "}
            {caps.canManageCustomer ? "current" : "not current"}
          </p>
          <p>
            Your actor ID {caps.actorId}.{" "}
            {caps.canBootstrap
              ? "Explicit platform bootstrap authority is active."
              : "Platform bootstrap requires a separately authorized operator."}
          </p>
          {caps.canBootstrap || caps.canManageCustomer ? (
            <>
              <ol>
                <li>Select the operation and verify the customer boundary.</li>
                <li>
                  Enter unique business codes, names, a named administrator and
                  the actual authority reference/reason.
                </li>
                <li>
                  Save once, inspect the receipt and explicitly open the new
                  estate only if it was assigned to you. Unknown results require
                  unchanged retry.
                </li>
              </ol>
              <label>
                Provisioning operation
                <select
                  aria-label="Provisioning operation"
                  disabled={locked}
                  value={operation}
                  onChange={(e) => {
                    setOperation(e.target.value);
                    setInput({});
                    setLast(null);
                  }}
                >
                  <option value="company" disabled={!caps.canManageCustomer}>
                    Create company in selected customer
                  </option>
                  <option value="estate" disabled={!caps.canManageCustomer}>
                    Create estate in selected customer
                  </option>
                  <option value="customer" disabled={!caps.canBootstrap}>
                    Bootstrap customer with initial company and estate
                  </option>
                </select>
              </label>
              <form
                aria-label="Provision hierarchy"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <fieldset disabled={locked || !permitted}>
                  {fields.map((k) =>
                    k === "companyId" ? (
                      <SearchSelect
                        key={k}
                        api={api}
                        path={
                          "/navigation/customers/" + customerId + "/companies"
                        }
                        label={labels[k]}
                        value={input[k] ?? ""}
                        onChange={(v) => setInput((p) => ({ ...p, [k]: v }))}
                      />
                    ) : (
                      <label key={k}>
                        {labels[k]}
                        {k === "reason" ? (
                          <textarea
                            aria-label={labels[k]}
                            required
                            minLength={3}
                            maxLength={500}
                            value={input[k] ?? ""}
                            onChange={(e) =>
                              setInput((p) => ({ ...p, [k]: e.target.value }))
                            }
                          />
                        ) : (
                          <input
                            aria-label={labels[k]}
                            required
                            minLength={k === "reference" ? 3 : 1}
                            maxLength={
                              k === "reference"
                                ? 240
                                : k.endsWith("Code")
                                  ? 30
                                  : k.endsWith("Id")
                                    ? 36
                                    : 160
                            }
                            value={input[k] ?? ""}
                            onChange={(e) =>
                              setInput((p) => ({ ...p, [k]: e.target.value }))
                            }
                          />
                        )}
                      </label>
                    ),
                  )}
                </fieldset>
                <button
                  disabled={
                    loading || busy || !!readError || (!pending && !valid)
                  }
                >
                  Save hierarchy provision
                </button>
              </form>
            </>
          ) : (
            <p>
              You can inspect your assigned hierarchy. Creating
              companies/estates requires explicit customer setup authority;
              customer bootstrap requires a separate platform capability.
            </p>
          )}
          {last && (
            <article data-provision-receipt={last.id}>
              <strong>{last.operation} created</strong>
              <p>
                Receipt {last.id} · {last.created_at} · {last.payload.reason}
              </p>
              <details>
                <summary>View detailed provisioning receipt</summary>
                <p>
                  Actor {last.actor_id} · Authority {last.payload.reference} ·
                  Support {last.request_id} · Customer {last.result.customerId}{" "}
                  · Company {last.result.companyId} · Estate{" "}
                  {last.result.estateId ?? "Not created by this operation"} ·
                  Named administrator{" "}
                  {last.result.initialAdminId ??
                    last.result.initialManagerId ??
                    "Unchanged"}
                </p>
                <p>No inherited work access was granted.</p>
              </details>
              {last.result.estateId &&
                (last.result.initialAdminId === caps.actorId ||
                  last.result.initialManagerId === caps.actorId) && (
                  <button
                    disabled={locked}
                    onClick={() => onOpenEstate(last.result.estateId)}
                  >
                    Open newly assigned estate
                  </button>
                )}
            </article>
          )}
          {history && (
            <section aria-label="Provisioning history">
              {history.items.map((r: any) => (
                <article key={r.id} data-provision-history={r.id}>
                  <strong>
                    {r.operation} · {r.created_at}
                  </strong>
                  <p>{r.payload.reason}</p>
                  <details>
                    <summary>View provisioning history detail</summary>
                    <p>
                      Receipt {r.id} · Actor {r.actor_id} · Reference{" "}
                      {r.payload.reference} · Support {r.request_id} · Company{" "}
                      {r.result.companyId} · Estate{" "}
                      {r.result.estateId ?? "Not created"}
                    </p>
                  </details>
                </article>
              ))}
              <button
                disabled={locked || !history.nextCursor}
                onClick={() => setCursor(history.nextCursor)}
              >
                Next provisioning history
              </button>
            </section>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
