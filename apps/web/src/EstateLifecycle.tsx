import { useEffect, useState } from "react";
type Api = (path: string, body?: unknown) => Promise<any>;
export function EstateLifecycle({
  api,
  estates,
}: {
  api: Api;
  estates: { id: string; name: string }[];
}) {
  const [estate, setEstate] = useState(""),
    [data, setData] = useState<any>(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [unit, setUnit] = useState(""),
    [estateReason, setEstateReason] = useState(""),
    [unitReason, setUnitReason] = useState(""),
    [needsRefresh, setNeedsRefresh] = useState(false),
    [attempt, setAttempt] = useState(0);
  const path = `/estates/${estate}/lifecycle`;
  useEffect(() => {
    let current = true;
    setData(null);
    setError("");
    setMessage("");
    setUnit("");
    setEstateReason("");
    setUnitReason("");
    if (!estate) return;
    setLoading(true);
    api(path)
      .then((value) => {
        if (current) {
          setData(value);
          setNeedsRefresh(false);
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [estate, attempt]);
  async function save(id: string | null) {
    if (!data) return;
    const target = id ? data.units.find((u: any) => u.id === id) : data.estate;
    if (!target) return;
    setBusy(true);
    setError("");
    setMessage("");
    let committed = false;
    try {
      await api(id ? `/estates/${estate}/units/${id}/lifecycle` : path, {
        active: !target.active,
        version: id ? target.version : target.lifecycle_version,
        reason: id ? unitReason : estateReason,
      });
      committed = true;
      setData(await api(path));
      setNeedsRefresh(false);
      if (id) setUnitReason("");
      else setEstateReason("");
      setMessage("Availability saved. History and work safeguards updated.");
    } catch (e) {
      setError(
        (committed
          ? "Change saved, but refresh failed. Refresh availability before another change. "
          : "") + (e as Error).message,
      );
      if (committed) setNeedsRefresh(true);
    } finally {
      setBusy(false);
    }
  }
  const selected = data?.units.find((u: any) => u.id === unit);
  return (
    <section className="editor" aria-label="Estate and unit availability">
      <h3>Estate and unit availability</h3>
      <ol>
        <li>Select the estate and review availability and open drafts.</li>
        <li>
          Resolve valid drafts in the Muster register before deactivation.
          Deactivate blocks before their fields/divisions; no work or units are
          deleted.
        </li>
        <li>
          To resume, reactivate the estate, then division → field → block.
          Refresh work/task lists after changes.
        </li>
      </ol>
      <p>
        An estate pause keeps unit flags and memberships intact. Historical
        confirmation evidence, review and reversal remain available under
        existing access/period rules. Changes require explicit setup permission
        and a reason; configurable independent lifecycle approvals remain
        planned.
      </p>
      <label>
        Availability estate
        <select
          aria-label="Availability estate"
          value={estate}
          disabled={busy}
          onChange={(e) => setEstate(e.target.value)}
        >
          <option value="">Choose assigned estate</option>
          {estates.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      {estate && (
        <button
          type="button"
          className="secondary"
          disabled={busy || loading}
          onClick={() => setAttempt((x) => x + 1)}
        >
          Refresh availability
        </button>
      )}
      {loading && <p role="status">Loading estate and unit availability…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {data && !loading && (
        <>
          <p data-estate-availability>
            Estate: {data.estate.active ? "Active" : "Inactive — work paused"} ·
            Version {data.estate.lifecycle_version} · Open drafts: {data.drafts}
          </p>
          <p>
            Legacy unlinked tasks have no known configured block. Unit pauses
            apply to explicit block links; estate pauses protect all new
            capture. An offline draft will need review if availability changed
            before sync.
          </p>
          {data.truncated && (
            <p>
              Only the first 500 units/latest 50 lifecycle events are shown.
              Full search/history navigation remains planned.
            </p>
          )}
          {data.canConfigure ? (
            <fieldset disabled={busy || needsRefresh}>
              <div className="grid">
                <form
                  aria-label="Estate availability change"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save(null);
                  }}
                >
                  <h4>Pause or resume the estate</h4>
                  <label>
                    Estate availability reason
                    <textarea
                      aria-label="Estate availability reason"
                      required
                      minLength={3}
                      maxLength={500}
                      value={estateReason}
                      onChange={(e) => setEstateReason(e.target.value)}
                    />
                  </label>
                  <button>
                    {data.estate.active
                      ? "Deactivate estate"
                      : "Reactivate estate"}
                  </button>
                </form>
                <form
                  aria-label="Unit availability change"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save(unit);
                  }}
                >
                  <h4>Pause or resume an operating unit</h4>
                  <label>
                    Availability unit
                    <select
                      aria-label="Availability unit"
                      required
                      value={unit}
                      onChange={(e) => {
                        setUnit(e.target.value);
                        setUnitReason("");
                        setMessage("");
                      }}
                    >
                      <option value="">Choose division, field or block</option>
                      {data.units.map((u: any) => (
                        <option key={u.id} value={u.id}>
                          {u.kind} · {u.code} · {u.name} ·{" "}
                          {u.active ? "Active" : "Inactive"}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selected && (
                    <p>
                      Current: {selected.active ? "Active" : "Inactive"} ·
                      Version {selected.version}. Parent:{" "}
                      {data.units.find((u: any) => u.id === selected.parent_id)
                        ?.code || "Estate root"}
                      .
                    </p>
                  )}
                  <label>
                    Unit availability reason
                    <textarea
                      aria-label="Unit availability reason"
                      required
                      minLength={3}
                      maxLength={500}
                      value={unitReason}
                      onChange={(e) => setUnitReason(e.target.value)}
                    />
                  </label>
                  <button disabled={!selected}>
                    {selected?.active === false
                      ? "Reactivate unit"
                      : "Deactivate unit"}
                  </button>
                </form>
              </div>
            </fieldset>
          ) : (
            <p>
              View only. Changes require explicit customer setup authority and
              this estate assigned.
            </p>
          )}
          <h4>Recent availability history</h4>
          {!data.history.length && (
            <p>
              No recorded availability changes. Migration did not invent
              history.
            </p>
          )}
          {data.history.map((h: any) => (
            <article
              className="event"
              key={h.id}
              data-lifecycle-record-id={h.record_id}
            >
              <div className="eventbody">
                <strong>
                  {h.after.name} ·{" "}
                  {h.after.active ? "Reactivated" : "Deactivated"}
                </strong>
                <p>
                  {h.reason} · {h.actor}
                </p>
                <details>
                  <summary>View availability audit details</summary>
                  <dl className="auditdetails">
                    <dt>Before / after status</dt>
                    <dd>
                      {h.before.active ? "Active" : "Inactive"} →{" "}
                      {h.after.active ? "Active" : "Inactive"}
                    </dd>
                    <dt>Before / after version</dt>
                    <dd>
                      {h.before.version} → {h.after.version}
                    </dd>
                    <dt>Record / actor / time</dt>
                    <dd>
                      {h.record_id} · {h.actor} · {h.created_at}
                    </dd>
                    <dt>Support reference</dt>
                    <dd>{h.request_id || "Not recorded"}</dd>
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
export function WorkAvailability({
  api,
  estate,
  onSetup,
}: {
  api: Api;
  estate: string;
  onSetup: () => void;
}) {
  const [value, setValue] = useState<any>(null),
    [error, setError] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setValue(null);
    setError(false);
    api(`/estates/${estate}/lifecycle`)
      .then((d) => {
        if (live) setValue(d.estate);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [estate, attempt]);
  return (
    <div className="notice" role="note" aria-label="Work availability">
      {value
        ? value.active
          ? "Estate active. Task choices exclude inactive configured blocks."
          : "Estate inactive — new work is paused. Recorded work remains available."
        : error
          ? "Availability could not be refreshed. Server safeguards still apply."
          : "Checking estate availability…"}{" "}
      <button
        type="button"
        className="secondary"
        onClick={() => setAttempt((x) => x + 1)}
      >
        Refresh work availability
      </button>
      <button type="button" className="secondary" onClick={onSetup}>
        Open availability setup
      </button>
    </div>
  );
}
