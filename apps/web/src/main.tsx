import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { Maintenance } from "./Maintenance";
type Row = Record<string, any>;
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
function App() {
  const submission = useRef<{ payload: string; key: string } | null>(null);
  function submissionKey(body: unknown) {
    const payload = JSON.stringify(body);
    if (submission.current?.payload !== payload)
      submission.current = { payload, key: crypto.randomUUID() };
    return submission.current!.key;
  }
  const [user, setUser] = useState<Row | null>(null),
    [csrf, setCsrf] = useState(""),
    [estates, setEstates] = useState<Row[]>([]),
    [estate, setEstate] = useState(""),
    [rows, setRows] = useState<Row[]>([]),
    [workers, setWorkers] = useState<Row[]>([]),
    [tasks, setTasks] = useState<Row[]>([]),
    [audit, setAudit] = useState<Row[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [detail, setDetail] = useState<Row | null>(null),
    [tab, setTab] = useState("Muster register"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [creating, setCreating] = useState(false),
    [selected, setSelected] = useState<string[]>([]);
  const [workerSearch, setWorkerSearch] = useState(""),
    [taskSearch, setTaskSearch] = useState(""),
    [workerNext, setWorkerNext] = useState<string | null>(null),
    [taskNext, setTaskNext] = useState<string | null>(null),
    [workerFilter, setWorkerFilter] = useState(""),
    [taskFilter, setTaskFilter] = useState("");
  async function searchRefs(kind: "workers" | "occurrences", more = false) {
    const isWorker = kind === "workers";
    const query = more
      ? isWorker
        ? workerFilter
        : taskFilter
      : isWorker
        ? workerSearch
        : taskSearch;
    const params = new URLSearchParams({ q: query });
    const next = isWorker ? workerNext : taskNext;
    if (more && next) params.set("cursor", next);
    const result = await api(base + "/catalog/" + kind + "?" + params);
    if (isWorker) {
      setWorkers((s) => (more ? [...s, ...result.items] : result.items));
      setWorkerNext(result.nextCursor);
      setWorkerFilter(query);
      if (!more) setSelected([]);
    } else {
      setTasks((s) => (more ? [...s, ...result.items] : result.items));
      setTaskNext(result.nextCursor);
      setTaskFilter(query);
    }
  }
  async function api(path: string, body?: unknown, key?: string) {
    const r = await fetch("/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf,
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.status === 204) return null;
    const value = await r.json();
    if (!r.ok) {
      if (r.status === 401) setUser(null);
      throw new Error(value.error || "Request failed");
    }
    return value;
  }
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    api("/auth/session")
      .then((v) => {
        setUser(v.user);
        setCsrf(v.csrf);
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (user)
      api("/estates")
        .then((v) => {
          setEstates(v);
          setEstate(v[0]?.id || "");
        })
        .catch((e) => setError(e.message));
  }, [user]);
  const base = "/estates/" + estate;
  async function refresh() {
    const [list, w, t, a] = await Promise.all([
      api(base + "/musters"),
      api(base + "/catalog/workers"),
      api(base + "/catalog/occurrences"),
      api(base + "/audit"),
    ]);
    setRows(list.items);
    setCursor(list.nextCursor);
    setWorkers(w.items);
    setWorkerNext(w.nextCursor);
    setWorkerFilter("");
    setWorkerSearch("");
    setTasks(t.items);
    setTaskNext(t.nextCursor);
    setTaskFilter("");
    setTaskSearch("");
    setAudit(a);
  }
  useEffect(() => {
    setDetail(null);
    setCreating(false);
    setRows([]);
    if (estate) void act(refresh);
  }, [estate]);
  const role = estates.find((e) => e.id === estate)?.role,
    canWrite = ["manager", "supervisor"].includes(role || "");
  if (!ready)
    return (
      <main className="login">
        <p>Connecting to estate operations…</p>
      </main>
    );
  if (!user)
    return (
      <main className="login">
        <section>
          <div className="brand">
            STM <span>ESTATE OPERATIONS</span>
          </div>
          <p className="eyebrow">CONNECTED OPERATIONS</p>
          <h1>
            Your estate.
            <br />
            One working view.
          </h1>
          <p>
            Sign in to securely record field work and review estate activity.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void act(async () => {
                const v = await api("/auth/login", {
                  email: f.get("email"),
                  password: f.get("password"),
                });
                setUser(v.user);
                setCsrf(v.csrf);
              });
            }}
          >
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button disabled={busy}>Sign in</button>
          </form>
          <small>Development environment · Synthetic estate data</small>
        </section>
      </main>
    );
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          STM <span>ESTATE OPERATIONS</span>
        </div>
        <small>WORKSPACE</small>
        {[
          "Muster register",
          "Task capacity",
          "Workers",
          "Operational periods",
          "Audit trail",
        ].map((x) => (
          <button
            className={tab === x ? "nav active" : "nav"}
            key={x}
            onClick={() => {
              setTab(x);
              setDetail(null);
              setCreating(false);
              if (x === "Audit trail" || x === "Muster register")
                void act(refresh);
            }}
          >
            {x}
          </button>
        ))}
        <div className="asidefoot">
          PERN foundation
          <br />
          <small>Connected to PostgreSQL</small>
        </div>
      </aside>
      <div className="body">
        <header>
          <label className="estate">
            Estate
            <select
              aria-label="Estate"
              value={estate}
              disabled={busy}
              onChange={(e) => setEstate(e.target.value)}
            >
              {estates.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <div>
            {user.name}
            <small className="role">{role}</small>
          </div>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await api("/auth/logout", {});
                setUser(null);
                setEstate("");
                setRows([]);
              })
            }
          >
            Sign out
          </button>
        </header>
        <main>
          <div className="notice">
            DEVELOPMENT · Synthetic data · First operational workflow
          </div>
          <div className="heading">
            <div>
              <p className="eyebrow">FIELD OPERATIONS</p>
              <h1>{tab}</h1>
              <p>
                Record work with clear ownership and a traceable approval
                history.
              </p>
            </div>
            {canWrite && tab === "Muster register" && (
              <button
                disabled={busy || !estate}
                onClick={() =>
                  void act(async () => {
                    await refresh();
                    setCreating(true);
                    setDetail(null);
                    setSelected([]);
                  })
                }
              >
                + New muster
              </button>
            )}
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {busy && <p role="status">Saving or loading records…</p>}
          {creating && (
            <section className="card">
              <h2>Record field work</h2>
              <p>Equal area allocation · 1 man-day per selected worker</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void act(async () => {
                    const body = {
                      occurrenceId: f.get("task"),
                      businessDate: f.get("date"),
                      gangCode: f.get("gang"),
                      quantityHa: Number(f.get("quantity")),
                      workerIds: selected,
                    };
                    await api(base + "/musters", body, submissionKey(body));
                    submission.current = null;
                    setCreating(false);
                    await refresh();
                  });
                }}
              >
                <div className="searchbar">
                  <label>
                    Find task
                    <input
                      value={taskSearch}
                      onChange={(e) => setTaskSearch(e.target.value)}
                      maxLength={100}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    className="secondary"
                    onClick={() => void act(() => searchRefs("occurrences"))}
                  >
                    Search tasks
                  </button>
                  {taskNext && (
                    <button
                      type="button"
                      disabled={busy}
                      className="secondary"
                      onClick={() =>
                        void act(() => searchRefs("occurrences", true))
                      }
                    >
                      More tasks
                    </button>
                  )}
                </div>
                <div className="grid">
                  <label>
                    Task / activity
                    <select name="task" required>
                      {tasks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.block_code} / {t.task_code} · {t.activity} ·{" "}
                          {t.round_code}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Work date
                    <input
                      name="date"
                      type="date"
                      defaultValue={today}
                      required
                    />
                  </label>
                  <label>
                    Gang code
                    <input
                      name="gang"
                      defaultValue="G-01"
                      required
                      maxLength={30}
                    />
                  </label>
                  <label>
                    Area (Ha)
                    <input
                      name="quantity"
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                    />
                  </label>
                </div>
                <fieldset>
                  <legend>Workers</legend>
                  <div className="searchbar">
                    <label>
                      Find worker
                      <input
                        value={workerSearch}
                        onChange={(e) => setWorkerSearch(e.target.value)}
                        maxLength={100}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={busy}
                      className="secondary"
                      onClick={() => void act(() => searchRefs("workers"))}
                    >
                      Search workers
                    </button>
                    {workerNext && (
                      <button
                        type="button"
                        disabled={busy}
                        className="secondary"
                        onClick={() =>
                          void act(() => searchRefs("workers", true))
                        }
                      >
                        More workers
                      </button>
                    )}
                  </div>
                  <small>
                    A new worker search clears the current selection. Load more
                    preserves it.
                  </small>
                  {workers.map((w) => (
                    <label className="check" key={w.id}>
                      <input
                        type="checkbox"
                        checked={selected.includes(w.id)}
                        onChange={(e) =>
                          setSelected((s) =>
                            e.target.checked
                              ? [...s, w.id]
                              : s.filter((id) => id !== w.id),
                          )
                        }
                      />
                      {w.code} · {w.name}
                    </label>
                  ))}
                </fieldset>
                <div className="actions">
                  <button disabled={busy || !selected.length}>
                    Save draft
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => setCreating(false)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </section>
          )}
          {tab === "Muster register" && (
            <section className="card">
              <div className="cardtitle">
                <h2>Operational records</h2>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void act(refresh)}
                >
                  Refresh
                </button>
              </div>
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Task / activity</th>
                      <th>Gang</th>
                      <th>Area</th>
                      <th>Status</th>
                      <th>Record</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td>{r.business_date}</td>
                        <td>
                          <strong>
                            {r.block_code} / {r.task_code}
                          </strong>
                          <small>
                            {r.activity} · {r.round_code}
                          </small>
                        </td>
                        <td>{r.gang_code}</td>
                        <td>{r.quantity_ha} Ha</td>
                        <td>
                          <span className={"badge " + r.status}>
                            {r.status}
                          </span>
                        </td>
                        <td>
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() =>
                              void act(async () =>
                                setDetail(await api(base + "/musters/" + r.id)),
                              )
                            }
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!rows.length && (
                <p className="empty">
                  No records yet. Create the first muster for this estate.
                </p>
              )}
              {cursor && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const v = await api(
                        base + "/musters?cursor=" + encodeURIComponent(cursor),
                      );
                      setRows((s) => [...s, ...v.items]);
                      setCursor(v.nextCursor);
                    })
                  }
                >
                  Load more
                </button>
              )}
              <small>Records are loaded in pages of 25.</small>
            </section>
          )}
          {detail && (
            <section className="card">
              <div className="cardtitle">
                <h2>Muster detail · {detail.status}</h2>
                <button className="secondary" onClick={() => setDetail(null)}>
                  Close
                </button>
              </div>
              <p>
                {detail.business_date} · {detail.gang_code} ·{" "}
                {detail.quantity_ha} Ha
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Worker</th>
                    <th>Allocated area</th>
                    <th>Man-days</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.shares.map((s: Row) => (
                    <tr key={s.worker_id}>
                      <td>{s.name}</td>
                      <td>{s.quantity_ha} Ha</td>
                      <td>{s.man_days}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {detail.status === "draft" && canWrite && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await api(base + "/musters/" + detail.id + "/confirm", {
                        version: detail.version,
                      });
                      setDetail(await api(base + "/musters/" + detail.id));
                      await refresh();
                    })
                  }
                >
                  Confirm muster
                </button>
              )}
              <small>
                Confirmation checks available task area and the operational
                period.
              </small>
            </section>
          )}
          {["Task capacity", "Workers", "Operational periods"].includes(tab) &&
            estate && (
              <Maintenance
                key={estate + tab}
                base={base}
                api={api}
                manager={role === "manager"}
                kind={
                  tab === "Workers"
                    ? "workers"
                    : tab === "Task capacity"
                      ? "occurrences"
                      : "periods"
                }
              />
            )}
          {tab === "Audit trail" && (
            <section className="card">
              <h2>Latest 50 estate events</h2>
              {!audit.length && (
                <p className="empty">Events appear when work is recorded.</p>
              )}
              {audit.map((a) => (
                <div className="event" key={a.id}>
                  <span className="dot" />
                  <div>
                    <strong>{a.action}</strong>
                    <small>
                      {a.actor} · {new Date(a.created_at).toLocaleString()}
                    </small>
                    <code>{a.record_id || a.detail?.month}</code>
                    {a.detail?.reason && <p>{a.detail.reason}</p>}
                  </div>
                </div>
              ))}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
