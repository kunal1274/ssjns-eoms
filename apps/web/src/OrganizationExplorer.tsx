import { useEffect, useRef, useState } from "react";
type Api = (path: string, body?: unknown) => Promise<any>;
function usePage(path: string | null, api: Api) {
  const [items, setItems] = useState<any[]>([]),
    [next, setNext] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false),
    [failedMore, setFailedMore] = useState(false);
  const generation = useRef(0),
    currentPath = useRef(path),
    apiRef = useRef(api);
  currentPath.current = path;
  apiRef.current = api;
  async function load(more = false) {
    if (!path) return;
    const requestPath = path,
      token = ++generation.current,
      cursor = more ? next : null;
    setBusy(true);
    setError("");
    try {
      const result = await apiRef.current(
        requestPath + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
      );
      if (token !== generation.current || currentPath.current !== requestPath)
        return;
      setItems((old) =>
        more
          ? [
              ...new Map(
                [...old, ...result.items].map((row) => [row.id, row]),
              ).values(),
            ]
          : result.items,
      );
      setNext(result.nextCursor);
      setLoaded(true);
    } catch (e) {
      if (token === generation.current && currentPath.current === requestPath) {
        setError((e as Error).message);
        setFailedMore(more);
      }
    } finally {
      if (token === generation.current && currentPath.current === requestPath)
        setBusy(false);
    }
  }
  useEffect(() => {
    setItems([]);
    setNext(null);
    setLoaded(false);
    setError("");
    if (path) void load();
    else setBusy(false);
    return () => {
      generation.current++;
    };
  }, [path]);
  return {
    items,
    next,
    busy,
    error,
    loaded,
    load,
    retry: () => load(failedMore),
  };
}
function Controls({
  page,
  label,
}: {
  page: ReturnType<typeof usePage>;
  label: string;
}) {
  return (
    <>
      {page.busy && <p role="status">Loading {label}…</p>}
      {page.error && (
        <p role="alert" className="error">
          {page.error}{" "}
          <button
            type="button"
            disabled={page.busy}
            onClick={() => void page.retry()}
          >
            Retry {label}
          </button>
        </p>
      )}
      {!page.busy && page.loaded && !page.items.length && (
        <p>
          No matching {label}. Check the filters and your estate assignments.
        </p>
      )}
      {page.next && (
        <button
          type="button"
          className="secondary"
          disabled={page.busy}
          onClick={() => void page.load(true)}
        >
          Load more {label}
        </button>
      )}
    </>
  );
}
const types = [
  "group",
  "company",
  "unit",
  "setup-grant",
  "task-link",
  "area",
  "estate-placement",
  "estate-lifecycle",
  "unit-lifecycle",
];
export function OrganizationExplorer({
  api,
  onOpenEstate,
}: {
  api: Api;
  onOpenEstate: (id: string) => void;
}) {
  const [term, setTerm] = useState(""),
    [search, setSearch] = useState(""),
    [limit, setLimit] = useState("25"),
    [estate, setEstate] = useState<any>(null),
    [unitTerm, setUnitTerm] = useState(""),
    [unitKind, setUnitKind] = useState("all"),
    [unitStatus, setUnitStatus] = useState("all"),
    [unitQuery, setUnitQuery] = useState({ q: "", kind: "all", status: "all" }),
    [source, setSource] = useState("hierarchy"),
    [historyTerm, setHistoryTerm] = useState(""),
    [historyType, setHistoryType] = useState(""),
    [reference, setReference] = useState(""),
    [estateOnly, setEstateOnly] = useState(true),
    [record, setRecord] = useState(""),
    [historyQuery, setHistoryQuery] = useState({
      source: "hierarchy",
      q: "",
      type: "",
      reference: "",
      estateOnly: true,
      record: "",
    });
  const estates = usePage(
      "/navigation/estates?" + new URLSearchParams({ q: search, limit }),
      api,
    ),
    units = usePage(
      estate
        ? `/navigation/estates/${estate.id}/units?` +
            new URLSearchParams({ ...unitQuery, limit })
        : null,
      api,
    );
  const params = new URLSearchParams({
    source: historyQuery.source,
    q: historyQuery.q,
    limit,
  });
  if (historyQuery.type) params.set("recordType", historyQuery.type);
  if (historyQuery.reference) params.set("requestId", historyQuery.reference);
  if (historyQuery.record) params.set("recordId", historyQuery.record);
  if (historyQuery.estateOnly && estate) params.set("estateId", estate.id);
  const history = usePage(
    estate
      ? `/navigation/customers/${estate.customer_id}/history?` + params
      : null,
    api,
  );
  function select(row: any) {
    setEstate(row);
    setUnitTerm("");
    setUnitKind("all");
    setUnitStatus("all");
    setUnitQuery({ q: "", kind: "all", status: "all" });
    setSource("hierarchy");
    setHistoryTerm("");
    setHistoryType("");
    setReference("");
    setEstateOnly(true);
    setRecord("");
    setHistoryQuery({
      source: "hierarchy",
      q: "",
      type: "",
      reference: "",
      estateOnly: true,
      record: "",
    });
  }
  return (
    <section className="editor" aria-label="Organization explorer">
      <h3>Find estates, units and recorded changes</h3>
      <ol>
        <li>
          Search by customer, company or estate name/code. Load more results
          when needed.
        </li>
        <li>
          Inspect an assigned estate to search all its units and browse recorded
          history.
        </li>
        <li>
          Continue to its Muster register. Setup selectors in the other panels
          still have separate list limits.
        </li>
      </ol>
      <p>
        Each page is checked against your current access. Parent labels grant no
        sibling access. Directory order uses stable record IDs; names may change
        during browsing. History pages retain the first page's upper event
        boundary; run Search history again to see newer events.
      </p>
      <form
        aria-label="Search assigned estates"
        onSubmit={(e) => {
          e.preventDefault();
          setEstate(null);
          if (search === term.trim()) void estates.load();
          else setSearch(term.trim());
        }}
      >
        <label>
          Find assigned estate
          <input
            aria-label="Find assigned estate"
            maxLength={100}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </label>
        <label>
          Explorer page size
          <select
            aria-label="Explorer page size"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          >
            <option value="5">5 per page</option>
            <option value="25">25 per page</option>
            <option value="50">50 per page</option>
          </select>
        </label>
        <button disabled={estates.busy}>Search estates</button>
      </form>
      <p>
        Estate search: {search || "All assigned estates"} ·{" "}
        {estates.items.length} loaded. Searching %, _ or \\ treats them as
        literal text.
      </p>
      {estates.items.map((row) => (
        <article
          key={row.id}
          className="event"
          data-explorer-estate-id={row.id}
        >
          <div className="eventbody">
            <strong>
              {row.name} · {row.code}
            </strong>
            <p>
              {row.customer_name} · {row.company_name} ·{" "}
              {row.active ? "Active" : "Inactive — work paused"}
            </p>
            <button type="button" onClick={() => select(row)}>
              Inspect {row.name}
            </button>
          </div>
        </article>
      ))}
      <Controls page={estates} label="estates" />
      {estate && (
        <section className="editor" aria-label="Selected estate explorer">
          <h4>Selected estate: {estate.name}</h4>
          <p>
            {estate.customer_name} → {estate.company_name} → {estate.code}
          </p>
          <button type="button" onClick={() => onOpenEstate(estate.id)}>
            Continue to selected estate
          </button>
          <form
            aria-label="Search estate units"
            onSubmit={(e) => {
              e.preventDefault();
              const query = {
                q: unitTerm.trim(),
                kind: unitKind,
                status: unitStatus,
              };
              if (JSON.stringify(query) === JSON.stringify(unitQuery))
                void units.load();
              else setUnitQuery(query);
            }}
          >
            <label>
              Find operating unit
              <input
                aria-label="Find operating unit"
                maxLength={100}
                value={unitTerm}
                onChange={(e) => setUnitTerm(e.target.value)}
              />
            </label>
            <label>
              Explorer unit type
              <select
                aria-label="Explorer unit type"
                value={unitKind}
                onChange={(e) => setUnitKind(e.target.value)}
              >
                {["all", "division", "field", "block"].map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Explorer unit availability
              <select
                aria-label="Explorer unit availability"
                value={unitStatus}
                onChange={(e) => setUnitStatus(e.target.value)}
              >
                {["all", "active", "inactive"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={units.busy}>Search units</button>
          </form>
          <p>
            Unit search: {unitQuery.q || "All names/codes"} · {unitQuery.kind} ·{" "}
            {unitQuery.status} · {units.items.length} loaded.
          </p>
          {units.items.map((u) => (
            <article className="event" key={u.id} data-explorer-unit-id={u.id}>
              <div className="eventbody">
                <strong>
                  {u.kind} · {u.code} · {u.name}
                </strong>
                <p>
                  {u.active ? "Active" : "Inactive"} · Parent{" "}
                  {u.parent_code || "Estate root"} · Version {u.version}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSource("hierarchy");
                    setHistoryTerm("");
                    setHistoryType("");
                    setReference("");
                    setEstateOnly(true);
                    setRecord(u.id);
                    setHistoryQuery({
                      source: "hierarchy",
                      q: "",
                      type: "",
                      reference: "",
                      estateOnly: true,
                      record: u.id,
                    });
                  }}
                >
                  Review unit history
                </button>
              </div>
            </article>
          ))}
          <Controls page={units} label="units" />
          <section aria-label="Explorer change history">
            <h4>Recorded change history</h4>
            <form
              aria-label="Search recorded history"
              onSubmit={(e) => {
                e.preventDefault();
                const hierarchy = source === "hierarchy",
                  query = {
                    source,
                    q: historyTerm.trim(),
                    type: hierarchy ? historyType : "",
                    reference: reference.trim(),
                    estateOnly: hierarchy && estateOnly,
                    record: hierarchy ? record : "",
                  };
                if (JSON.stringify(query) === JSON.stringify(historyQuery))
                  void history.load();
                else setHistoryQuery(query);
              }}
            >
              <label>
                History source
                <select
                  aria-label="History source"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                >
                  <option value="hierarchy">Hierarchy changes</option>
                  <option value="customer">Customer name/code changes</option>
                </select>
              </label>
              <label>
                Find recorded change
                <input
                  aria-label="Find recorded change"
                  maxLength={100}
                  value={historyTerm}
                  onChange={(e) => setHistoryTerm(e.target.value)}
                />
              </label>
              <label>
                History record type
                <select
                  aria-label="History record type"
                  disabled={source !== "hierarchy"}
                  value={historyType}
                  onChange={(e) => setHistoryType(e.target.value)}
                >
                  <option value="">All permitted types</option>
                  {types.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                History support reference
                <input
                  aria-label="History support reference"
                  maxLength={36}
                  pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  disabled={source !== "hierarchy"}
                  checked={estateOnly}
                  onChange={(e) => setEstateOnly(e.target.checked)}
                />
                Only selected estate history
              </label>
              <button disabled={history.busy}>Search history</button>
            </form>
            {historyQuery.record && (
              <p>
                Selected unit record: {historyQuery.record}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setRecord("");
                    setHistoryQuery((q) => ({ ...q, record: "" }));
                  }}
                >
                  Clear unit history filter
                </button>
              </p>
            )}
            <p>
              History source: {historyQuery.source} ·{" "}
              {historyQuery.estateOnly
                ? "Selected estate"
                : "Permitted customer scope"}{" "}
              · {history.items.length} loaded. General hierarchy/customer
              history is available here; dedicated responsibility and move
              request/decision ledgers remain in their own panels.
            </p>
            {history.items.map((h) => (
              <article
                className="event"
                key={h.id}
                data-explorer-event-id={h.id}
              >
                <div className="eventbody">
                  <strong>
                    {h.record_type} · {h.action} ·{" "}
                    {h.after.name || "Recorded change"}
                  </strong>
                  <p>
                    {h.reason || "Customer display change"} · {h.actor}
                  </p>
                  <details>
                    <summary>View explorer audit details</summary>
                    <dl className="auditdetails">
                      <dt>Before name / code / version</dt>
                      <dd>
                        {h.before.name || "No previous name"} ·{" "}
                        {h.before.code || "—"} ·{" "}
                        {h.before.version ?? "Not recorded"}
                      </dd>
                      <dt>After name / code / version</dt>
                      <dd>
                        {h.after.name || "—"} · {h.after.code || "—"} ·{" "}
                        {h.after.version ?? "Not recorded"}
                      </dd>
                      <dt>Before / after availability</dt>
                      <dd>
                        {h.before.active == null
                          ? "Not recorded"
                          : h.before.active
                            ? "Active"
                            : "Inactive"}{" "}
                        →{" "}
                        {h.after.active == null
                          ? "Not recorded"
                          : h.after.active
                            ? "Active"
                            : "Inactive"}
                      </dd>
                      <dt>Before / after parent and group</dt>
                      <dd>
                        {h.before.parentId || "—"} → {h.after.parentId || "—"} ·{" "}
                        {h.before.groupId || "—"} → {h.after.groupId || "—"}
                      </dd>
                      <dt>Event / record / actor / time</dt>
                      <dd>
                        {h.id} · {h.record_id} ·{" "}
                        {h.actor_id || "System / migration"} · {h.created_at}
                      </dd>
                      <dt>Approved move decision</dt>
                      <dd>{h.after.moveDecisionId || "Not recorded"}</dd>
                      <dt>Support reference</dt>
                      <dd>{h.request_id || "Not recorded"}</dd>
                    </dl>
                  </details>
                </div>
              </article>
            ))}
            <Controls page={history} label="history events" />
          </section>
        </section>
      )}
    </section>
  );
}
