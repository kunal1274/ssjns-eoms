import { useEffect, useRef, useState } from "react";
import { SearchSelect } from "./SearchSelect";
type Api = (path: string, body?: unknown) => Promise<any>;
export function OperationalSites({
  api,
  customerId,
  onOpenEstate,
}: {
  api: Api;
  customerId: string;
  onOpenEstate: (id: string) => void;
}) {
  const [allowed, setAllowed] = useState(false),
    [permissionError, setPermissionError] = useState(""),
    [permissionAttempt, setPermissionAttempt] = useState(0);
  const [id, setId] = useState(""),
    [data, setData] = useState<any>(null),
    [kindFilter, setKindFilter] = useState(""),
    [status, setStatus] = useState("all");
  const [company, setCompany] = useState(""),
    [estate, setEstate] = useState("unlinked"),
    [companyReady, setCompanyReady] = useState(false),
    [estateReady, setEstateReady] = useState(false);
  const [creating, setCreating] = useState(false),
    [editing, setEditing] = useState(false),
    [kind, setKind] = useState("mill"),
    [code, setCode] = useState(""),
    [name, setName] = useState(""),
    [active, setActive] = useState(true),
    [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [blocked, setBlocked] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0);
  const [history, setHistory] = useState<any[]>([]),
    [next, setNext] = useState<string | null>(null),
    [historyBusy, setHistoryBusy] = useState(false),
    [historyError, setHistoryError] = useState(""),
    [historyTerm, setHistoryTerm] = useState(""),
    [historyQuery, setHistoryQuery] = useState(""),
    [historyAttempt, setHistoryAttempt] = useState(0);
  const generation = useRef(0),
    historyGeneration = useRef(0),
    currentId = useRef(id);
  currentId.current = id;
  const root = `/customers/${customerId}/sites`,
    path = `${root}/${id}`;
  useEffect(() => {
    let live = true;
    setPermissionError("");
    api(root + "/context")
      .then((r) => {
        if (live) setAllowed(r.canConfigure);
      })
      .catch((e) => {
        if (live) {
          setAllowed(false);
          setPermissionError(e.message);
        }
      });
    return () => {
      live = false;
    };
  }, [customerId, permissionAttempt]);
  useEffect(() => {
    const ticket = ++generation.current;
    setData(null);
    setHistory([]);
    setNext(null);
    setError("");
    setEditing(false);
    setHistoryQuery("");
    setHistoryTerm("");
    if (!id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setBlocked(true);
    api(path)
      .then((r) => {
        if (ticket === generation.current) {
          setData(r);
          setBlocked(false);
        }
      })
      .catch((e) => {
        if (ticket === generation.current) setError(e.message);
      })
      .finally(() => {
        if (ticket === generation.current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [id, revision]);
  async function readHistory(more = false) {
    if (!id || !data) return;
    const ticket = ++historyGeneration.current,
      started = id;
    setHistoryBusy(true);
    setHistoryError("");
    try {
      const q = new URLSearchParams({ limit: "25", q: historyQuery });
      if (more && next) q.set("cursor", next);
      const r = await api(path + "/history?" + q);
      if (
        ticket === historyGeneration.current &&
        currentId.current === started
      ) {
        setHistory((old) =>
          more
            ? [...new Map([...old, ...r.items].map((x) => [x.id, x])).values()]
            : r.items,
        );
        setNext(r.nextCursor);
      }
    } catch (e) {
      if (ticket === historyGeneration.current && currentId.current === started)
        setHistoryError((e as Error).message);
    } finally {
      if (ticket === historyGeneration.current && currentId.current === started)
        setHistoryBusy(false);
    }
  }
  useEffect(() => {
    setHistory([]);
    setNext(null);
    setHistoryError("");
    if (data) void readHistory();
    return () => {
      historyGeneration.current++;
    };
  }, [data, historyQuery, historyAttempt]);
  function begin() {
    setCreating(true);
    setEditing(false);
    setId("");
    setData(null);
    setName("");
    setCode("");
    setCompany("");
    setEstate("unlinked");
    setKind("mill");
    setActive(true);
    setReason("");
    setError("");
    setNotice("");
    setBlocked(false);
  }
  async function save() {
    if (busy || blocked) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api(
        creating ? root : path,
        creating
          ? {
              kind,
              code,
              name,
              companyId: company,
              estateId: estate === "unlinked" ? null : estate,
              reason,
            }
          : { name, active, version: data.version, reason },
      );
      setCreating(false);
      setEditing(false);
      setBlocked(true);
      setReason("");
      setNotice(
        "Site saved. Checking the recorded version and history before another change.",
      );
      if (result.id === id) setRevision((n) => n + 1);
      else setId(result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="editor" aria-label="Operational sites">
      <h3>Operational sites</h3>
      <p>
        Facilities such as mills, nurseries, warehouses and workshops are
        separate from field blocks. Setup does not grant operational access or
        create stock, workshop or mill transactions.
      </p>
      <ol>
        <li>
          Find a permitted site or create a facility with its responsible
          company.
        </li>
        <li>
          Choose an optional assigned estate explicitly; unlinked facilities
          stay in this setup view.
        </li>
        <li>
          Save with a reason, review recorded history, then open a linked estate
          when permitted.
        </li>
      </ol>
      {permissionError && (
        <>
          <p role="alert">{permissionError}</p>
          <button
            type="button"
            onClick={() => setPermissionAttempt((n) => n + 1)}
          >
            Retry site permissions
          </button>
        </>
      )}
      {!allowed && !permissionError && (
        <p>
          Site setup requires an explicit customer setup grant. You can review
          sites linked to your assigned estates.
        </p>
      )}
      <label>
        Site type filter
        <select
          aria-label="Site type filter"
          value={kindFilter}
          disabled={busy}
          onChange={(e) => setKindFilter(e.target.value)}
        >
          <option value="">All types</option>
          {["mill", "nursery", "warehouse", "workshop", "other"].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>
      <label>
        Site status filter
        <select
          aria-label="Site status filter"
          value={status}
          disabled={busy}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Paused</option>
        </select>
      </label>
      <SearchSelect
        api={api}
        path={`/navigation/customers/${customerId}/sites?status=${status}${kindFilter ? "&kind=" + kindFilter : ""}`}
        label="Operational site"
        value={id}
        disabled={busy}
        refreshKey={revision}
        onChange={(v) => {
          setCreating(false);
          setNotice("");
          setId(v);
        }}
      />
      {allowed && (
        <button type="button" disabled={busy || loading} onClick={begin}>
          Create operational site
        </button>
      )}
      {id && (
        <button
          type="button"
          disabled={busy || loading}
          onClick={() => {
            setEditing(false);
            setRevision((n) => n + 1);
          }}
        >
          Refresh operational site
        </button>
      )}
      {loading && <p role="status">Loading operational site…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {id && blocked && !loading && (
        <p>
          Refresh the selected site to check its current version and access
          before another change. A saved change must not be submitted again.
        </p>
      )}
      {data && (
        <article data-site-id={data.id}>
          <h4>
            {data.name} · {data.code}
          </h4>
          <p>
            {data.kind} · {data.active ? "Active" : "Paused"} · Version{" "}
            {data.version}
          </p>
          <p>Responsible company: {data.company_name}</p>
          <p>
            {data.estate_id
              ? `Linked estate: ${data.estate_name} · ${data.estate_code}`
              : "Not linked to an estate. Operational assignments are not configured in this slice."}
          </p>
          {data.estate_id && (
            <button
              type="button"
              disabled={busy || blocked}
              onClick={() => onOpenEstate(data.estate_id)}
            >
              Open linked estate
            </button>
          )}
          {data.can_configure && (
            <button
              type="button"
              disabled={busy || blocked}
              onClick={() => {
                setEditing(true);
                setName(data.name);
                setActive(data.active);
                setReason("");
                setNotice("");
                setError("");
              }}
            >
              Edit operational site
            </button>
          )}
        </article>
      )}
      {(creating || editing) && (
        <form
          aria-label="Operational site form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h4>
            {creating
              ? "Create facility"
              : "Edit facility name or availability"}
          </h4>
          {creating && (
            <>
              <label>
                Site type
                <select
                  aria-label="Site type"
                  value={kind}
                  disabled={busy}
                  onChange={(e) => setKind(e.target.value)}
                >
                  {["mill", "nursery", "warehouse", "workshop", "other"].map(
                    (k) => (
                      <option key={k}>{k}</option>
                    ),
                  )}
                </select>
              </label>
              <label>
                Site code
                <input
                  aria-label="Site code"
                  required
                  maxLength={30}
                  pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,29}"
                  value={code}
                  disabled={busy}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                />
              </label>
              <SearchSelect
                api={api}
                path={`/navigation/customers/${customerId}/companies`}
                label="Site responsible company"
                value={company}
                onChange={setCompany}
                onReady={setCompanyReady}
                required
                disabled={busy}
              />
              <SearchSelect
                api={api}
                path={`/navigation/estates?customerId=${customerId}`}
                label="Site linked estate"
                value={estate}
                onChange={setEstate}
                onReady={setEstateReady}
                required
                localOptions={[
                  { id: "unlinked", name: "Not linked to an estate" },
                ]}
                disabled={busy}
              />
            </>
          )}
          <label>
            Site name
            <input
              aria-label="Site name"
              required
              maxLength={160}
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {editing && (
            <label>
              Site availability
              <select
                aria-label="Site availability"
                value={String(active)}
                disabled={busy}
                onChange={(e) => setActive(e.target.value === "true")}
              >
                <option value="true">Active</option>
                <option value="false">Paused</option>
              </select>
            </label>
          )}
          <label>
            Site change reason
            <textarea
              aria-label="Site change reason"
              required
              minLength={3}
              maxLength={500}
              value={reason}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button
            disabled={
              busy ||
              blocked ||
              (creating && (!company || !companyReady || !estateReady))
            }
          >
            {busy ? "Saving site…" : "Save operational site"}
          </button>
          <p>
            Identity, facility type, responsible company and estate link cannot
            be changed here. Availability controls this master only; it does not
            stop unbuilt downstream operations.
          </p>
        </form>
      )}
      {data && (
        <section aria-label="Operational site history">
          <h4>Recorded site changes</h4>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (historyTerm.trim() === historyQuery)
                setHistoryAttempt((n) => n + 1);
              else setHistoryQuery(historyTerm.trim());
            }}
          >
            <label>
              Search site history
              <input
                aria-label="Search site history"
                maxLength={100}
                value={historyTerm}
                onChange={(e) => setHistoryTerm(e.target.value)}
              />
            </label>
            <button disabled={historyBusy}>Find site history</button>
          </form>
          {historyBusy && <p role="status">Loading site history…</p>}
          {historyError && (
            <>
              <p role="alert">{historyError}</p>
              <button
                disabled={historyBusy}
                onClick={() => void readHistory(!!next)}
              >
                Retry site history
              </button>
            </>
          )}
          {!historyBusy && !historyError && !history.length && (
            <p>
              No matching recorded changes. Clear the search to review this
              site's history.
            </p>
          )}
          {history.map((h) => (
            <article className="event" key={h.id} data-site-event={h.id}>
              <div className="eventbody">
                <strong>
                  Site {h.action} · {h.after.name}
                </strong>
                <p>{h.reason}</p>
                <small>
                  {h.actor_id || "System / explicit bootstrap"} ·{" "}
                  {new Date(h.created_at).toLocaleString()}
                </small>
                <details>
                  <summary>View site change details</summary>
                  <dl className="auditdetails">
                    <dt>Event / site</dt>
                    <dd>
                      {h.id} · {h.site_id}
                    </dd>
                    <dt>Before</dt>
                    <dd>
                      {h.before
                        ? `${h.before.name} · ${h.before.active ? "Active" : "Paused"} · Version ${h.before.version}`
                        : "No previous site (creation)"}
                    </dd>
                    <dt>After</dt>
                    <dd>
                      {h.after.name} · {h.after.active ? "Active" : "Paused"} ·
                      Version {h.after.version}
                    </dd>
                    <dt>Support reference</dt>
                    <dd>{h.request_id || "Not recorded"}</dd>
                  </dl>
                </details>
              </div>
            </article>
          ))}
          {next && (
            <button
              disabled={historyBusy}
              onClick={() => void readHistory(true)}
            >
              More site history
            </button>
          )}
        </section>
      )}
    </section>
  );
}
