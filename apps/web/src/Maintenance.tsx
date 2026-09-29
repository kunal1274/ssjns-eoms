import { useEffect, useState } from "react";
type Row = Record<string, any>;
type Api = (path: string, body?: unknown) => Promise<any>;
export function Maintenance({
  base,
  api,
  manager,
  kind,
}: {
  base: string;
  api: Api;
  manager: boolean;
  kind: "workers" | "occurrences" | "periods";
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [next, setNext] = useState<string | null>(null),
    [q, setQ] = useState(""),
    [filter, setFilter] = useState(""),
    [year, setYear] = useState(new Date().getFullYear()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [edit, setEdit] = useState<Row | null>(null),
    [create, setCreate] = useState(false),
    [message, setMessage] = useState("");
  const isWorker = kind === "workers",
    isPeriod = kind === "periods";
  async function load(cursor?: string, search = filter) {
    const params = new URLSearchParams({
      q: search,
      includeInactive: "true",
      limit: "25",
    });
    if (cursor) params.set("cursor", cursor);
    const value = await api(
      base +
        (isPeriod ? `/periods?year=${year}` : `/catalog/${kind}?${params}`),
    );
    setRows((s) =>
      cursor ? [...s, ...value.items] : isPeriod ? value : value.items,
    );
    setNext(isPeriod ? null : value.nextCursor);
  }
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void act(() => load());
  }, [year]);
  const title = isWorker
    ? "Workers"
    : isPeriod
      ? "Operational periods"
      : "Task occurrences";
  return (
    <section className="card">
      <div className="cardtitle">
        <h2>{title}</h2>
        {manager && (
          <button
            disabled={busy}
            onClick={() => {
              setEdit(null);
              setCreate(true);
            }}
          >
            Add {isWorker ? "worker" : isPeriod ? "period" : "task"}
          </button>
        )}
      </div>
      <p>
        {isPeriod
          ? "Lock a month to stop new entries and confirmations. Reopening requires a reason."
          : isWorker
            ? "Deactivate workers to remove them from new entries. Existing records are retained."
            : "Each task occurrence has its own area budget. Capacity edits preserve confirmed work."}
      </p>
      {!manager && (
        <small>Read access · An estate manager maintains these records.</small>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {!isPeriod ? (
        <form
          className="searchbar"
          onSubmit={(e) => {
            e.preventDefault();
            setFilter(q);
            void act(() => load(undefined, q));
          }}
        >
          <label>
            Search {isWorker ? "workers" : "tasks"}
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              maxLength={100}
            />
          </label>
          <button disabled={busy}>Search</button>
        </form>
      ) : (
        <label>
          Calendar year
          <input
            type="number"
            min={2000}
            max={9999}
            value={year}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (n >= 2000 && n <= 9999) setYear(n);
            }}
          />
        </label>
      )}
      {(create || edit) && (
        <form
          className="editor"
          key={edit?.id || edit?.month || "create"}
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            void act(async () => {
              let path = "/" + kind;
              let body: Row;
              if (isWorker) {
                body = edit
                  ? {
                      name: data.get("name"),
                      active: data.get("active") === "on",
                      version: edit.version,
                    }
                  : { code: data.get("code"), name: data.get("name") };
                if (edit) path += "/" + edit.id;
              } else if (isPeriod) {
                body = edit
                  ? {
                      locked: !edit.locked,
                      version: edit.version,
                      reason: data.get("reason"),
                    }
                  : { month: data.get("month") + "-01" };
                if (edit) path += "/" + edit.month;
              } else {
                body = edit
                  ? {
                      capacityHa: Number(data.get("capacity")),
                      version: edit.version,
                    }
                  : {
                      blockCode: data.get("block"),
                      taskCode: data.get("task"),
                      activity: data.get("activity"),
                      roundCode: data.get("round"),
                      capacityHa: Number(data.get("capacity")),
                    };
                if (edit) path += "/" + edit.id;
              }
              await api(base + path, body);
              setEdit(null);
              setCreate(false);
              await load();
              setMessage("Saved. Audit history updated.");
            });
          }}
        >
          <h3>
            {edit ? "Update" : "Add"}{" "}
            {isWorker ? "worker" : isPeriod ? "period" : "task"}
          </h3>
          <div className="grid">
            {isWorker ? (
              <>
                {!edit && (
                  <label>
                    Worker code
                    <input name="code" required maxLength={100} />
                  </label>
                )}
                <label>
                  Worker name
                  <input
                    name="name"
                    defaultValue={edit?.name || ""}
                    required
                    maxLength={100}
                  />
                </label>
                {edit && (
                  <label className="check">
                    <input
                      type="checkbox"
                      name="active"
                      defaultChecked={edit.active}
                    />
                    Active worker
                  </label>
                )}
              </>
            ) : isPeriod ? (
              <>
                {edit ? (
                  <>
                    <p>
                      {edit.month.slice(0, 7)} →{" "}
                      {edit.locked ? "Open" : "Locked"}
                    </p>
                    <label>
                      Reason
                      <input
                        name="reason"
                        required
                        minLength={5}
                        maxLength={500}
                      />
                    </label>
                  </>
                ) : (
                  <label>
                    Month
                    <input name="month" type="month" min="2000-01" required />
                  </label>
                )}
              </>
            ) : (
              <>
                {!edit && (
                  <>
                    <label>
                      Block code
                      <input name="block" required maxLength={100} />
                    </label>
                    <label>
                      Task code
                      <input name="task" required maxLength={100} />
                    </label>
                    <label>
                      Activity
                      <input name="activity" required maxLength={100} />
                    </label>
                    <label>
                      Round code
                      <input name="round" required maxLength={100} />
                    </label>
                  </>
                )}
                <label>
                  Capacity (Ha)
                  <input
                    name="capacity"
                    type="number"
                    min="0.01"
                    max="1000000"
                    step="0.01"
                    defaultValue={edit?.capacity_ha || ""}
                    required
                  />
                </label>
              </>
            )}
          </div>
          <div className="actions">
            <button disabled={busy}>Save changes</button>
            <button
              type="button"
              disabled={busy}
              className="secondary"
              onClick={() => {
                setEdit(null);
                setCreate(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              {(isWorker
                ? ["Code", "Name", "Status"]
                : isPeriod
                  ? ["Month", "Status"]
                  : [
                      "Task",
                      "Activity / round",
                      "Capacity",
                      "Confirmed",
                      "Remaining",
                    ]
              ).map((h) => (
                <th key={h}>{h}</th>
              ))}
              {manager && <th>Manage</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id || r.month}>
                {isWorker ? (
                  <>
                    <td>{r.code}</td>
                    <td>{r.name}</td>
                    <td>{r.active ? "Active" : "Inactive"}</td>
                  </>
                ) : isPeriod ? (
                  <>
                    <td>{r.month.slice(0, 7)}</td>
                    <td>
                      <span
                        className={"badge " + (!r.locked ? "confirmed" : "")}
                      >
                        {r.locked ? "Locked" : "Open"}
                      </span>
                    </td>
                  </>
                ) : (
                  <>
                    <td>
                      {r.block_code} / {r.task_code}
                    </td>
                    <td>
                      {r.activity}
                      <small>{r.round_code}</small>
                    </td>
                    <td>{r.capacity_ha} Ha</td>
                    <td>{r.confirmed_ha} Ha</td>
                    <td>
                      {(Number(r.capacity_ha) - Number(r.confirmed_ha)).toFixed(
                        2,
                      )}{" "}
                      Ha
                    </td>
                  </>
                )}
                {manager && (
                  <td>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        setCreate(false);
                        setEdit(r);
                      }}
                    >
                      {isPeriod ? (r.locked ? "Reopen" : "Lock") : "Edit"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="empty">No matching records.</p>}
      {next && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void act(() => load(next))}
        >
          Load more
        </button>
      )}
      <button
        className="secondary"
        disabled={busy}
        onClick={() => void act(() => load())}
      >
        Refresh list
      </button>
    </section>
  );
}
