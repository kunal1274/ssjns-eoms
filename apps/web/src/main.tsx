import { SignInHelp } from "./SignInHelp";
import { AccountSecurity } from "./AccountSecurity";
import { SearchSelect } from "./SearchSelect";
import { WorkAvailability } from "./EstateLifecycle";
import { Organization } from "./Organization";
import { AuditTrail } from "./AuditTrail";
import { requestFailure, connectionFailure, RequestFailure } from "./feedback";
import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { SyncQueue } from "./SyncQueue";
import { PwaInstall } from "./PwaInstall";
import { enqueue, clearDeviceDrafts, deviceDraftCount } from "./offline";
import { allocateHundredths } from "../../../packages/domain/allocation";
import { Gangs } from "./Gangs";
import { Maintenance } from "./Maintenance";
type Row = Record<string, any>;
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
function App() {
  const [online, setOnline] = useState(navigator.onLine),
    [queueRevision, setQueueRevision] = useState(0),
    [deviceMessage, setDeviceMessage] = useState("");
  useEffect(() => {
    const connected = () => setOnline(true),
      disconnected = () => setOnline(false);
    window.addEventListener("online", connected);
    window.addEventListener("offline", disconnected);
    return () => {
      window.removeEventListener("online", connected);
      window.removeEventListener("offline", disconnected);
    };
  }, []);
  useEffect(() => {
    const logout = (e: StorageEvent) => {
      if (e.key === "eoms-logout") {
        clearIdentity();
      }
    };
    window.addEventListener("storage", logout);
    return () => window.removeEventListener("storage", logout);
  }, []);

  const [gangs, setGangs] = useState<Row[]>([]),
    [gangSearch, setGangSearch] = useState(""),
    [gangNext, setGangNext] = useState<string | null>(null),
    [gangFilter, setGangFilter] = useState(""),
    [reviewAction, setReviewAction] = useState<"approve" | "reverse" | null>(
      null,
    );
  async function searchGangs(more = false) {
    const q = more ? gangFilter : gangSearch;
    const params = new URLSearchParams({ q, assignable: "true" });
    if (more && gangNext) params.set("cursor", gangNext);
    const v = await api(base + "/gangs?" + params);
    setGangs((s) => (more ? [...s, ...v.items] : v.items));
    setGangNext(v.nextCursor);
    setGangFilter(q);
  }
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
    [legacyWorkEstate, setLegacyWorkEstate] = useState(""),
    [tab, setTab] = useState("Muster register"),
    [error, setError] = useState(""),
    [actionBusy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [creating, setCreating] = useState(false),
    [selected, setSelected] = useState<string[]>([]);
  const [organizationPending, setOrganizationPending] = useState(false);
  const [securityPending, setSecurityPending] = useState(false);
  const [authOptions, setAuthOptions] = useState<any>(null);
  const identityGeneration = useRef(0);
  const busy = actionBusy || organizationPending || securityPending;
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
    if (!navigator.onLine)
      throw Error(
        "Reconnect for this action. You can save a device draft using references already loaded.",
      );
    const generation = identityGeneration.current;
    let r: Response;
    try {
      r = await fetch("/api" + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf,
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error(connectionFailure);
    }
    if (path !== "/auth/options" && generation !== identityGeneration.current)
      throw Error("Your account changed. Reload this view.");
    if (r.status === 204) return null;
    const value = await r.json().catch(() => null);
    if (!r.ok) {
      if (r.status === 401 && path !== "/auth/login") {
        clearIdentity();
        if (path !== "/auth/session" || value?.error?.includes("expired"))
          setDeviceMessage(
            "Your session has ended. Sign in again to continue. Device drafts remain available to their owner after sign-in.",
          );
      }
      throw new RequestFailure(r.status, value, r.headers.get("X-Request-ID"));
    }
    if (value === null) throw new Error(connectionFailure);
    return value;
  }
  function clearIdentity() {
    identityGeneration.current++;
    setUser(null);
    setTab("Muster register");
    setCsrf("");
    setEstate("");
    setEstates([]);
    setRows([]);
    setWorkers([]);
    setTasks([]);
    setGangs([]);
    setAudit([]);
    setDetail(null);
    setCreating(false);
    setSecurityPending(false);
    setOrganizationPending(false);
    sessionStorage.removeItem("eoms-estate");
  }
  async function signOut(all: boolean) {
    await act(async () => {
      if (!online)
        throw Error("Reconnect to sign out and revoke the server session.");
      if (!navigator.locks)
        throw Error("This browser cannot coordinate device storage safely.");
      let signedOut = false;
      await navigator.locks.request("eoms-device-sync", async () => {
        const count = await deviceDraftCount();
        if (
          count &&
          !confirm(
            `Sign out and discard ${count} device draft(s)? Sync them first to retain them on the server.`,
          )
        )
          return;
        await api(all ? "/auth/sign-out-all" : "/auth/logout", {});
        await clearDeviceDrafts();
        signedOut = true;
      });
      if (!signedOut) return;
      localStorage.setItem("eoms-logout", String(Date.now()));
      clearIdentity();
      setDeviceMessage(
        all
          ? "All EOMS sessions have ended. Your identity-provider session is managed separately."
          : "You have signed out.",
      );
    });
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
    void api("/auth/options")
      .then(setAuthOptions)
      .catch(() => {});
    const currentURL = new URL(window.location.href);
    if (currentURL.searchParams.has("authError")) {
      const ref = currentURL.searchParams.get("reference") ?? "";
      setError(
        "Organization sign-in could not be completed. Start again or contact your administrator." +
          (/^[a-f0-9-]{36}$/.test(ref) ? " Reference: " + ref : ""),
      );
      window.history.replaceState({}, "", currentURL.pathname);
    }
    api("/auth/session")
      .then((v) => {
        setUser(v.user);
        setCsrf(v.csrf);
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    let current = true;
    setEstates([]);
    setEstate("");
    if (user) {
      const preferred = sessionStorage.getItem("eoms-estate");
      const params = new URLSearchParams({ limit: "25" });
      if (preferred) params.set("selectedId", preferred);
      api("/navigation/estates?" + params)
        .then((v) => {
          if (!current) return;
          setEstates(v.selected ? [...v.items, v.selected] : v.items);
          setEstate(
            (chosen) => chosen || v.selected?.id || v.items[0]?.id || "",
          );
        })
        .catch((e) => {
          if (current) setError(e.message);
        });
    }
    return () => {
      current = false;
    };
  }, [user]);
  function chooseEstate(id: string, row?: Row) {
    sessionStorage.setItem("eoms-estate", id);
    if (row) setEstates((old) => [...old.filter((e) => e.id !== id), row]);
    setEstate(id);
  }
  const currentEstate = useRef(estate);
  currentEstate.current = estate;
  const base = "/estates/" + estate;
  async function refresh() {
    const [list, w, t, a, g] = await Promise.all([
      api(base + "/musters"),
      api(base + "/catalog/workers"),
      api(base + "/catalog/occurrences"),
      api(base + "/audit"),
      api(base + "/gangs?assignable=true"),
    ]);
    if (currentEstate.current !== estate) return;
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
    setGangs(g.items);
    setGangNext(g.nextCursor);
    setGangSearch("");
    setGangFilter("");
  }
  useEffect(() => {
    setDetail(null);
    setLegacyWorkEstate("");
    setReviewAction(null);
    setCreating(false);
    setRows([]);
    setWorkers([]);
    setTasks([]);
    setGangs([]);
    setAudit([]);
    if (estate) void act(refresh);
  }, [estate]);
  useEffect(() => {
    if (detail) document.getElementById("muster-detail")?.focus();
  }, [detail?.id]);
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
          {!online && (
            <p className="notice">
              Offline. Reconnect to sign in. Previously saved device drafts are
              retained until you reconnect or clear browser data.
            </p>
          )}
          {deviceMessage && <p role="status">{deviceMessage}</p>}
          {authOptions?.localEnabled !== false && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void act(async () => {
                  const v = await api("/auth/login", {
                    email: f.get("email"),
                    password: f.get("password"),
                  });
                  identityGeneration.current++;
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
              <button disabled={busy || !online}>Sign in</button>
            </form>
          )}
          <SignInHelp
            api={api}
            options={authOptions}
            busy={busy}
            onOrganizationSignIn={() =>
              void act(async () => {
                const v = await api("/auth/oidc/start", {});
                window.location.assign(v.authorizationUrl);
              })
            }
          />
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
          "Organization",
          "Task capacity",
          "Workers",
          "Gangs",
          "Operational periods",
          "Audit trail",
          "Account security",
        ].map((x) => (
          <button
            className={tab === x ? "nav active" : "nav"}
            key={x}
            disabled={organizationPending || securityPending}
            onClick={() => {
              setTab(x);
              setLegacyWorkEstate("");
              setDetail(null);
              setReviewAction(null);
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
          <div className="estate">
            <SearchSelect
              key={user.id}
              api={api}
              path="/navigation/estates"
              label="Estate"
              value={estate}
              onChange={chooseEstate}
              onResolved={(row) =>
                setEstates((old) => [
                  ...old.filter((e) => e.id !== row.id),
                  row,
                ])
              }
              seed={estates
                .filter((e) => e.id === estate)
                .map((e) => ({ ...e, id: String(e.id), name: String(e.name) }))}
              showCode={false}
              disabled={busy || !online}
              placeholder="Choose assigned estate"
            />
          </div>
          <div>
            {user.name}
            <small className="role">{role}</small>
          </div>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void signOut(false)}
          >
            Sign out
          </button>
        </header>
        <main>
          <div className="notice">
            DEVELOPMENT · Synthetic data ·{" "}
            {online ? "Online" : "Offline — local draft capture only"}
          </div>
          <PwaInstall />
          {!estate && (
            <p role="status">
              No estate is selected or assigned. Use Organization to review your
              explicit assignments, or contact your administrator. Account
              security is available without an estate assignment.
            </p>
          )}
          {tab === "Account security" && (
            <AccountSecurity
              api={api}
              onPending={setSecurityPending}
              onSignOutAll={() => signOut(true)}
              onCredentialChanged={() => {
                clearIdentity();
                setDeviceMessage(
                  "Password changed. All previous sessions have ended. Sign in with your new password. Device drafts remain assigned to their owner.",
                );
              }}
            />
          )}
          {estate && tab === "Muster register" && (
            <WorkAvailability
              api={api}
              online={online}
              estate={estate}
              onSetup={() => {
                setTab("Organization");
                setDetail(null);
                setReviewAction(null);
                setCreating(false);
              }}
            />
          )}
          {deviceMessage && <p role="status">{deviceMessage}</p>}
          {!online && (
            <p className="notice">
              Use references loaded before disconnecting. Server actions and
              sign-out require a connection. After reload, reconnect to
              authenticate; device drafts remain stored.
            </p>
          )}
          <SyncQueue
            key={user.id}
            owner={user.id}
            estateNames={Object.fromEntries(estates.map((e) => [e.id, e.name]))}
            online={online}
            revision={queueRevision}
            onSynced={refresh}
          />
          <div className="heading">
            <div>
              <p className="eyebrow">FIELD OPERATIONS</p>
              <h1>{tab}</h1>
              <p>
                {tab === "Organization"
                  ? "Review your assigned customer, company and estate, then continue to operations."
                  : "Record work with clear ownership and a traceable approval history."}
              </p>
            </div>
            {canWrite && tab === "Muster register" && (
              <button
                disabled={busy || !estate}
                onClick={() =>
                  void act(async () => {
                    if (online) await refresh();
                    if (!workers.length || !tasks.length || !gangs.length)
                      throw Error(
                        "Load workers, tasks and an assigned gang while online before capturing offline.",
                      );
                    setCreating(true);
                    setDetail(null);
                    setReviewAction(null);
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
                  const saveOnDevice =
                    !online ||
                    (e.nativeEvent as SubmitEvent).submitter?.getAttribute(
                      "data-device",
                    ) === "true";
                  void act(async () => {
                    const body = {
                      occurrenceId: f.get("task"),
                      businessDate: f.get("date"),
                      gangCode: f.get("gang"),
                      quantityHa: Number(f.get("quantity")),
                      workerIds: selected,
                    };
                    const key = submissionKey(body);
                    allocateHundredths(body.quantityHa, body.workerIds);
                    if (
                      !body.occurrenceId ||
                      !body.gangCode ||
                      !body.businessDate
                    )
                      throw Error("Choose a task, gang and work date");
                    if (saveOnDevice) {
                      if (!navigator.locks)
                        throw Error(
                          "This browser does not support coordinated device drafts.",
                        );
                      await navigator.locks.request("eoms-device-sync", () =>
                        enqueue({
                          id: key,
                          ownerId: user.id,
                          estateId: estate,
                          payload: body,
                          status: "pending",
                          createdAt: new Date().toISOString(),
                        }),
                      );
                      setQueueRevision((v) => v + 1);
                      setDeviceMessage(
                        "Saved on this device. Reconnect and sync to create the server draft.",
                      );
                    } else {
                      await api(base + "/musters", body, key);
                      setDeviceMessage("Draft saved to server.");
                    }
                    submission.current = null;
                    setCreating(false);
                    if (!saveOnDevice) await refresh();
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
                  <p>
                    Only available tasks are listed. Reactivate paused
                    estates/blocks in Organization → Estate and unit
                    availability, then search tasks again. Legacy unlinked tasks
                    are governed by estate availability.
                  </p>
                  <label>
                    Task / activity
                    <select name="task" aria-label="Task / activity" required>
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
                    <select name="gang" aria-label="Gang code" required>
                      <option value="">Select assigned gang</option>
                      {gangs.map((g) => (
                        <option value={g.code} key={g.id}>
                          {g.code} · {g.name}
                        </option>
                      ))}
                    </select>
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
                <div className="searchbar">
                  <label>
                    Find gang
                    <input
                      value={gangSearch}
                      maxLength={100}
                      onChange={(e) => setGangSearch(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => void act(() => searchGangs())}
                  >
                    Search gangs
                  </button>
                  {gangNext && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => void act(() => searchGangs(true))}
                    >
                      More gangs
                    </button>
                  )}
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
                    {online ? "Save draft" : "Save on device"}
                  </button>
                  {online && (
                    <button
                      type="submit"
                      data-device="true"
                      className="secondary"
                      disabled={busy || !selected.length}
                    >
                      Save on device
                    </button>
                  )}
                  <small>
                    Device drafts are stored locally, not encrypted by this app.
                    Use a trusted device. Server validation occurs at sync.
                  </small>
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
                      <tr key={r.id} data-record-id={r.id}>
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
            <section className="card" id="muster-detail" tabIndex={-1}>
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
              <p data-work-attribution="true">
                {detail.legal_company_id
                  ? `Recorded responsible company: ${detail.legal_company_name} · ${detail.legal_responsibility_id ? "Dated assignment" : "Baseline assignment"}`
                  : "Legacy record: company attribution was not captured."}
              </p>
              {!detail.legal_company_id && (
                <section aria-label="Historical attribution guidance">
                  <p>
                    Company attribution was not recorded for this historical
                    work. Today's company or the task's current block link
                    cannot establish that historical fact. Ask the migration
                    owner to reconcile the source record; opening this detail
                    does not assign or correct attribution.
                  </p>
                  <details>
                    <summary>View historical record references</summary>
                    <dl>
                      <dt>Work record ID</dt>
                      <dd>{detail.id}</dd>
                      <dt>Estate ID</dt>
                      <dd>{detail.estate_id}</dd>
                      <dt>Task ID</dt>
                      <dd>{detail.occurrence_id}</dd>
                    </dl>
                  </details>
                  <button
                    type="button"
                    onClick={() => {
                      setLegacyWorkEstate(estate);
                      setDetail(null);
                      setReviewAction(null);
                      setTab("Task capacity");
                    }}
                  >
                    Return to unresolved work review
                  </button>
                </section>
              )}
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
              <p>
                Review:{" "}
                {detail.review_status === "approved" ? "Approved" : "Pending"}
                {detail.status === "reversed"
                  ? " · Original record retained"
                  : ""}
              </p>
              {detail.review_reason && (
                <p>Review reason: {detail.review_reason}</p>
              )}
              {detail.reversal_reason && (
                <p>Reversal reason: {detail.reversal_reason}</p>
              )}
              {role === "manager" && detail.status === "confirmed" && (
                <div className="actions">
                  {detail.review_status !== "approved" && (
                    <button
                      disabled={busy}
                      onClick={() => setReviewAction("approve")}
                    >
                      Approve work
                    </button>
                  )}
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => setReviewAction("reverse")}
                  >
                    Reverse work
                  </button>
                </div>
              )}
              {reviewAction && detail.status === "confirmed" && (
                <form
                  className="editor"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void act(async () => {
                      await api(
                        base + "/musters/" + detail.id + "/" + reviewAction,
                        { version: detail.version, reason: f.get("reason") },
                      );
                      setDetail(await api(base + "/musters/" + detail.id));
                      setReviewAction(null);
                      await refresh();
                    });
                  }}
                >
                  <h3>
                    {reviewAction === "approve"
                      ? "Approve confirmed work"
                      : "Reverse confirmed work"}
                  </h3>
                  <p>
                    {reviewAction === "reverse"
                      ? "This retains the original record and removes its area from current task totals. It does not reverse external payroll or SAP postings."
                      : "Record the evidence supporting this review."}
                  </p>
                  <label>
                    Action reason
                    <input
                      name="reason"
                      required
                      minLength={5}
                      maxLength={500}
                    />
                  </label>
                  <div className="actions">
                    <button disabled={busy}>
                      Submit{" "}
                      {reviewAction === "approve" ? "approval" : "reversal"}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => setReviewAction(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
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
                onOpenHierarchy={() => setTab("Organization")}
                openLegacyWork={legacyWorkEstate === estate}
                onOpenWork={(value) => {
                  if (currentEstate.current !== estate) return;
                  setDetail(value);
                  setCreating(false);
                  setReviewAction(null);
                  setTab("Muster register");
                }}
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
          {tab === "Gangs" && estate && (
            <Gangs
              key={estate}
              api={api}
              base={base}
              manager={role === "manager"}
            />
          )}
          {tab === "Organization" && (
            <Organization
              api={api}
              onPending={setOrganizationPending}
              onOpenEstate={(id) => {
                chooseEstate(id);
                setTab("Muster register");
                setDetail(null);
                setCreating(false);
                setReviewAction(null);
              }}
            />
          )}
          {tab === "Audit trail" && (
            <AuditTrail events={audit as import("./AuditTrail").AuditEvent[]} />
          )}
        </main>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/sw.js")
    .catch(() =>
      console.warn(
        "Offline shell registration failed; online app remains available.",
      ),
    );
}
