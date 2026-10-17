import { useEffect, useState } from "react";
type Api = (path: string, body?: unknown) => Promise<any>;
type Area = {
  id: string;
  kind: string;
  code: string;
  name: string;
  parent_id: string | null;
  version: number;
};
type Estate = {
  id: string;
  name: string;
  area_id: string | null;
  placement_version: number;
};
export function OperatingPlacement({
  api,
  customerId,
}: {
  api: Api;
  customerId: string;
}) {
  const [data, setData] = useState<{
    areas: Area[];
    estates: Estate[];
    canConfigure: boolean;
    truncated: boolean;
  }>({ areas: [], estates: [], canConfigure: false, truncated: false });
  const [changes, setChanges] = useState<any[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [attempt, setAttempt] = useState(0);
  const [kind, setKind] = useState("region"),
    [code, setCode] = useState(""),
    [name, setName] = useState(""),
    [parent, setParent] = useState(""),
    [reason, setReason] = useState(""),
    [editing, setEditing] = useState<Area | null>(null);
  const [estate, setEstate] = useState(""),
    [area, setArea] = useState(""),
    [placementReason, setPlacementReason] = useState("");
  const path = `/customers/${customerId}/placements`;
  async function read() {
    const [value, history] = await Promise.all([
      api(path),
      api(`/customers/${customerId}/hierarchy/history`),
    ]);
    return { value, history };
  }
  function apply(result: any) {
    setData(result.value);
    setChanges(
      result.history.items.filter((row: any) =>
        ["area", "estate-placement"].includes(row.record_type),
      ),
    );
    setEstate((current) =>
      result.value.estates.some((row: Estate) => row.id === current)
        ? current
        : result.value.estates[0]?.id || "",
    );
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    read()
      .then((result) => {
        if (active) apply(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [customerId, attempt]);
  function clearArea() {
    setEditing(null);
    setKind("region");
    setCode("");
    setName("");
    setParent("");
    setReason("");
  }
  async function save(
    action: () => Promise<unknown>,
    success: string,
    reset: () => void,
  ) {
    setBusy(true);
    setError("");
    setMessage("");
    let committed = false;
    try {
      await action();
      committed = true;
      setMessage(success);
      reset();
      apply(await read());
    } catch (e) {
      setError(
        (committed
          ? "Change saved, but refresh failed. Refresh before retrying. "
          : "") + (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  const selected = data.estates.find((row) => row.id === estate),
    regions = data.areas.filter((row) => row.kind === "region");
  return (
    <section className="editor" aria-label="Operating placement">
      <h3>Operating placement</h3>
      <p>
        Optional region → optional business unit → estate. A business unit may
        also sit directly under the customer. Legal company ownership and access
        grants stay separate.
      </p>
      <ol>
        <li>Create an optional region or business unit.</li>
        <li>Review the estate and choose its initial operating area.</li>
        <li>
          Review the saved relationship and change history, then open the estate
          above to continue work.
        </li>
      </ol>
      {loading && <p role="status">Loading operating placement…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <button
        type="button"
        className="secondary"
        disabled={busy || loading}
        onClick={() => {
          setMessage("");
          setAttempt((value) => value + 1);
        }}
      >
        Refresh placement lists
      </button>
      {data.truncated && (
        <p>
          Only a bounded portion of areas/estates is shown. Full large-data
          selection is pending.
        </p>
      )}
      {!loading && (
        <>
          {!data.canConfigure && (
            <p>
              View only. Only the areas above your assigned estates are visible;
              placement does not grant access to other estates. Changes require
              explicit customer setup permission.
            </p>
          )}
          {data.canConfigure && (
            <div className="grid">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void save(
                    () =>
                      api(
                        `/customers/${customerId}/areas` +
                          (editing ? "/" + editing.id : ""),
                        editing
                          ? { code, name, version: editing.version, reason }
                          : {
                              kind,
                              code,
                              name,
                              parentId: parent || null,
                              reason,
                            },
                      ),
                    "Operating area saved.",
                    clearArea,
                  );
                }}
              >
                <h4>
                  {editing
                    ? "Edit operating area"
                    : "1. Create an optional operating area"}
                </h4>
                <p>
                  Kind and parent are fixed after creation. Area names and codes
                  can be edited with a reason. After a conflict, refresh and
                  choose Edit again.
                </p>
                <fieldset disabled={busy}>
                  <label>
                    Area type
                    <select
                      aria-label="Area type"
                      value={kind}
                      disabled={!!editing}
                      onChange={(e) => {
                        setKind(e.target.value);
                        setParent("");
                      }}
                    >
                      <option value="region">Region</option>
                      <option value="business-unit">Business unit</option>
                    </select>
                  </label>
                  <label>
                    Area parent
                    <select
                      aria-label="Area parent"
                      disabled={!!editing || kind === "region"}
                      value={parent}
                      onChange={(e) => setParent(e.target.value)}
                    >
                      <option value="">Customer root</option>
                      {regions.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.code} · {row.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Area code
                    <input
                      required
                      maxLength={30}
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  </label>
                  <label>
                    Area name
                    <input
                      required
                      maxLength={160}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <label>
                    Area reason
                    <textarea
                      required
                      minLength={3}
                      maxLength={500}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <button>Save operating area</button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={clearArea}
                  >
                    Clear area form
                  </button>
                </fieldset>
              </form>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (selected)
                    void save(
                      () =>
                        api(`/estates/${estate}/placement`, {
                          areaId: area,
                          version: selected.placement_version,
                          reason: placementReason,
                        }),
                      "Estate placement saved.",
                      () => {
                        setArea("");
                        setPlacementReason("");
                      },
                    );
                }}
              >
                <h4>2. Place an estate</h4>
                <p>
                  Leaving an estate at the customer root is valid. Once placed,
                  reassignment/removal requires the governed move workflow
                  planned next.
                </p>
                <fieldset disabled={busy}>
                  <label>
                    Placement estate
                    <select
                      aria-label="Placement estate"
                      value={estate}
                      onChange={(e) => {
                        setEstate(e.target.value);
                        setArea("");
                        setPlacementReason("");
                      }}
                    >
                      {data.estates.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selected?.area_id ? (
                    <p>
                      This estate is already placed. Version{" "}
                      {selected.placement_version}. Reassignment is not
                      available in this increment.
                    </p>
                  ) : (
                    <>
                      <label>
                        Estate operating area
                        <select
                          aria-label="Estate operating area"
                          required
                          value={area}
                          onChange={(e) => setArea(e.target.value)}
                        >
                          <option value="">
                            Choose a region or business unit
                          </option>
                          {data.areas.map((row) => (
                            <option key={row.id} value={row.id}>
                              {row.kind} · {row.code} · {row.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Placement reason
                        <textarea
                          required
                          minLength={3}
                          maxLength={500}
                          value={placementReason}
                          onChange={(e) => setPlacementReason(e.target.value)}
                        />
                      </label>
                      <button disabled={!selected}>
                        Save estate placement
                      </button>
                    </>
                  )}
                </fieldset>
              </form>
            </div>
          )}
          <h4>Operating areas</h4>
          {!data.areas.length && (
            <p>
              No permitted operating areas. Your estates may remain at the
              customer root.
            </p>
          )}
          {data.areas.map((row) => (
            <article key={row.id} className="event" data-area-code={row.code}>
              <div className="eventbody">
                <strong>
                  {row.kind} · {row.code} · {row.name}
                </strong>
                <p>
                  Parent:{" "}
                  {data.areas.find((p) => p.id === row.parent_id)?.code ||
                    "Customer root"}{" "}
                  · Version {row.version}
                </p>
                {data.canConfigure && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setEditing(row);
                      setKind(row.kind);
                      setCode(row.code);
                      setName(row.name);
                      setParent(row.parent_id || "");
                      setReason("");
                    }}
                  >
                    Edit area
                  </button>
                )}
              </div>
            </article>
          ))}
          <h4>Assigned estate placement</h4>
          {data.estates.map((row) => (
            <p key={row.id} data-placement-estate-id={row.id}>
              {row.name} →{" "}
              {data.areas.find((a) => a.id === row.area_id)?.code ||
                (row.area_id
                  ? "Area outside displayed window"
                  : "Customer root (unplaced)")}{" "}
              · Version {row.placement_version}
            </p>
          ))}
          <h4>Recent placement changes</h4>
          <p>
            Recent permitted events only. Expand a summary to review the
            recorded names, relationship, version and support reference. Full
            history navigation is pending.
          </p>
          {!changes.length && (
            <p>No permitted placement changes in the recent history window.</p>
          )}
          {changes.map((change) => (
            <article
              className="event"
              key={change.id}
              data-placement-record-id={change.record_id}
            >
              <div className="eventbody">
                <strong>
                  {change.record_type === "area"
                    ? "Operating area"
                    : "Estate placement"}{" "}
                  {change.action} · {change.after.name}
                </strong>
                <small>
                  {change.actor} ·{" "}
                  {new Date(change.created_at).toLocaleString()}
                </small>
                <p>{change.reason}</p>
                <details>
                  <summary>View placement change details</summary>
                  <dl className="auditdetails">
                    <dt>Before name / version</dt>
                    <dd>
                      {change.before.name || "No previous name"} ·{" "}
                      {change.before.version || "—"}
                    </dd>
                    <dt>After name / version</dt>
                    <dd>
                      {change.after.name} · {change.after.version}
                    </dd>
                    <dt>Before / after parent reference</dt>
                    <dd>
                      {change.before.parentId || "Customer root"} →{" "}
                      {change.after.parentId || "Customer root"}
                    </dd>
                    <dt>Support reference</dt>
                    <dd>{change.request_id || "Not recorded"}</dd>
                  </dl>
                </details>
              </div>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
