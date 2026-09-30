import { useState, useEffect } from "react";
type Row = Record<string, any>;
export function Gangs({
  api,
  base,
  manager,
}: {
  api: (path: string, body?: unknown) => Promise<any>;
  base: string;
  manager: boolean;
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [staff, setStaff] = useState<Row[]>([]),
    [next, setNext] = useState<string | null>(null),
    [q, setQ] = useState(""),
    [filter, setFilter] = useState(""),
    [edit, setEdit] = useState<Row | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
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
  async function load(cursor?: string, search = filter) {
    const p = new URLSearchParams({ q: search });
    if (cursor) p.set("cursor", cursor);
    const v = await api(base + "/gangs?" + p);
    setRows((s) => (cursor ? [...s, ...v.items] : v.items));
    setNext(v.nextCursor);
  }
  useEffect(() => {
    void act(async () => {
      await load();
      if (manager) setStaff(await api(base + "/supervisors"));
    });
  }, []);
  return (
    <section className="card">
      <div className="cardtitle">
        <h2>Gang assignments</h2>
        {manager && (
          <button
            disabled={busy}
            onClick={() => {
              setEdit({});
              setSelected([]);
            }}
          >
            Add gang
          </button>
        )}
      </div>
      <p>
        Assigned supervisors may capture and confirm work for an active gang.
        Managers maintain assignments. Estate read access is unchanged.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <form
        className="searchbar"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter(q);
          void act(() => load(undefined, q));
        }}
      >
        <label>
          Search gangs
          <input
            value={q}
            maxLength={100}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <button disabled={busy}>Search</button>
      </form>
      {edit && (
        <form
          className="editor"
          key={edit.id || "new"}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void act(async () => {
              const body = edit.id
                ? {
                    name: f.get("name"),
                    active: f.get("active") === "on",
                    supervisorIds: selected,
                    version: edit.version,
                  }
                : {
                    name: f.get("name"),
                    code: f.get("code"),
                    supervisorIds: selected,
                  };
              await api(base + "/gangs" + (edit.id ? "/" + edit.id : ""), body);
              setEdit(null);
              await load();
            });
          }}
        >
          <h3>{edit.id ? "Edit" : "Add"} gang</h3>
          <div className="grid">
            {!edit.id && (
              <label>
                Gang code
                <input name="code" required maxLength={30} />
              </label>
            )}
            <label>
              Gang name
              <input
                name="name"
                defaultValue={edit.name || ""}
                required
                maxLength={100}
              />
            </label>
            {edit.id && (
              <label className="check">
                <input
                  name="active"
                  type="checkbox"
                  defaultChecked={edit.active}
                />
                Active gang
              </label>
            )}
          </div>
          <fieldset>
            <legend>Assigned supervisors</legend>
            {staff.map((s) => (
              <label className="check" key={s.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(s.id)}
                  onChange={(e) =>
                    setSelected((v) =>
                      e.target.checked
                        ? [...v, s.id]
                        : v.filter((id) => id !== s.id),
                    )
                  }
                />
                {s.name}
              </label>
            ))}
            {!staff.length && (
              <small>No active supervisors available in this estate.</small>
            )}
          </fieldset>
          <div className="actions">
            <button disabled={busy}>Save gang</button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setEdit(null)}
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
              <th>Code</th>
              <th>Name</th>
              <th>Status</th>
              <th>Supervisors</th>
              {manager && <th>Manage</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.code}</td>
                <td>{r.name}</td>
                <td>{r.active ? "Active" : "Inactive"}</td>
                <td>
                  {manager
                    ? r.supervisor_ids
                        .map(
                          (id: string) =>
                            staff.find((s) => s.id === id)?.name ||
                            "Unavailable supervisor",
                        )
                        .join(", ") || "Unassigned"
                    : r.supervisor_ids.length}
                </td>
                {manager && (
                  <td>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        setEdit(r);
                        setSelected(r.supervisor_ids);
                      }}
                    >
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p>No matching gangs.</p>}
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
