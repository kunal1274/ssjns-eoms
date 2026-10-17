import { useState } from "react";
type Api = (path: string, body?: unknown) => Promise<any>;
export function PlacementGovernance({
  api,
  customerId,
  data,
  moves,
  onChanged,
  busy,
  onBusy,
}: {
  api: Api;
  customerId: string;
  data: any;
  moves: any;
  onChanged: () => Promise<void>;
  busy: boolean;
  onBusy: (value: boolean) => void;
}) {
  const [estate, setEstate] = useState(""),
    [target, setTarget] = useState(""),
    [reason, setReason] = useState(""),
    [request, setRequest] = useState(""),
    [decision, setDecision] = useState(""),
    [reviewReason, setReviewReason] = useState(""),
    [area, setArea] = useState(""),
    [lifecycleReason, setLifecycleReason] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [needsRefresh, setNeedsRefresh] = useState(false);
  const selected = data.estates.find((e: any) => e.id === estate),
    chosen = data.areas.find((a: any) => a.id === area),
    pending = moves.items.filter((q: any) => !q.decision),
    reviewable = pending.filter((q: any) => q.requester_id !== moves.actorId),
    item = reviewable.find((q: any) => q.id === request),
    reviewEstate = data.estates.find((e: any) => e.id === item?.estate_id);
  const label = (id: string | null) =>
    id
      ? data.areas.find((a: any) => a.id === id)?.name ||
        "Area outside displayed window"
      : "Customer root";
  async function save(
    action: () => Promise<any>,
    success: string,
    clear: () => void,
  ) {
    onBusy(true);
    setError("");
    setMessage("");
    let committed = false;
    try {
      await action();
      committed = true;
      clear();
      await onChanged();
      setMessage(success);
    } catch (e) {
      setError(
        (committed
          ? "Change saved, but refresh failed. Refresh saved movement history before another change. "
          : "") + (e as Error).message,
      );
      if (committed) setNeedsRefresh(true);
    } finally {
      onBusy(false);
    }
  }
  return (
    <section className="editor" aria-label="Movement and area lifecycle">
      <h3>Move an estate or change area availability</h3>
      <ol>
        <li>
          Choose the estate and destination, then request a move with a reason.
        </li>
        <li>
          A different setup administrator reviews the current placement and
          approves or rejects. Approval moves it immediately.
        </li>
        <li>
          After estates have moved out, deactivate empty areas from business
          unit to region. Reactivate the region before its business units.
        </li>
      </ol>
      <p>
        Estate identity, memberships, legal company, tasks and recorded work
        stay attached to the same estate. Operating placement grants no
        additional access. These are immediate changes; scheduled moves and
        estate/field/block deactivation remain planned.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {needsRefresh && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            onBusy(true);
            try {
              await onChanged();
              setNeedsRefresh(false);
              setError("");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              onBusy(false);
            }
          }}
        >
          Refresh saved movement history
        </button>
      )}
      {moves.truncated && (
        <p>
          Only the latest 50 permitted move requests are shown. Older pending
          requests may require administrator assistance; full history navigation
          remains planned.
        </p>
      )}
      {data.canConfigure ? (
        <fieldset disabled={busy || needsRefresh}>
          <div className="grid">
            <form
              aria-label="Request estate move"
              onSubmit={(e) => {
                e.preventDefault();
                if (selected)
                  void save(
                    () =>
                      api(`/estates/${estate}/placement-moves`, {
                        toAreaId: target === "root" ? null : target,
                        version: selected.placement_version,
                        reason,
                      }),
                    "Move requested. Current placement is unchanged until independent approval.",
                    () => {
                      setReason("");
                      setTarget("");
                    },
                  );
              }}
            >
              <h4>1. Request estate move</h4>
              <label>
                Move estate
                <select
                  aria-label="Move estate"
                  required
                  value={estate}
                  onChange={(e) => {
                    setEstate(e.target.value);
                    setTarget("");
                    setReason("");
                    setMessage("");
                  }}
                >
                  <option value="">Choose estate</option>
                  {data.estates.map((e: any) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
              {selected && (
                <p>
                  Current placement: {label(selected.area_id)} · Version{" "}
                  {selected.placement_version}
                </p>
              )}
              <label>
                Move destination
                <select
                  aria-label="Move destination"
                  required
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">Choose a different destination</option>
                  {selected?.area_id && (
                    <option value="root">
                      Customer root (remove operating placement)
                    </option>
                  )}
                  {data.areas
                    .filter((a: any) => a.active && a.id !== selected?.area_id)
                    .map((a: any) => (
                      <option key={a.id} value={a.id}>
                        {a.kind} · {a.code} · {a.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Move reason
                <textarea
                  aria-label="Move reason"
                  required
                  minLength={3}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button
                disabled={
                  !selected || pending.some((q: any) => q.estate_id === estate)
                }
              >
                Request estate move
              </button>
              {pending.some((q: any) => q.estate_id === estate) && (
                <p>
                  A move is already pending. Independent review must close it
                  before another request.
                </p>
              )}
            </form>
            {reviewable.length > 0 && (
              <form
                aria-label="Independent move decision"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (item && reviewEstate)
                    void save(
                      () =>
                        api(
                          `/estates/${item.estate_id}/placement-moves/${item.id}/decision`,
                          {
                            decision,
                            version: reviewEstate.placement_version,
                            reason: reviewReason,
                          },
                        ),
                      "Independent move decision saved.",
                      () => {
                        setRequest("");
                        setDecision("");
                        setReviewReason("");
                      },
                    );
                }}
              >
                <h4>2. Independent review</h4>
                <label>
                  Move request
                  <select
                    aria-label="Move request"
                    required
                    value={request}
                    onChange={(e) => {
                      setRequest(e.target.value);
                      setDecision("");
                      setReviewReason("");
                    }}
                  >
                    <option value="">Choose pending request</option>
                    {reviewable.map((q: any) => (
                      <option key={q.id} value={q.id}>
                        {data.estates.find((e: any) => e.id === q.estate_id)
                          ?.name || q.estate_id}{" "}
                        · {q.reason}
                      </option>
                    ))}
                  </select>
                </label>
                {item && (
                  <p>
                    Requested: {label(item.from_area_id)} →{" "}
                    {label(item.to_area_id)} · Expected version{" "}
                    {item.expected_version}. Current:{" "}
                    {label(reviewEstate?.area_id)} · Version{" "}
                    {reviewEstate?.placement_version}. Destination and revision
                    are rechecked at approval; reject requests that are no
                    longer valid.
                  </p>
                )}
                <label>
                  Move decision
                  <select
                    aria-label="Move decision"
                    required
                    value={decision}
                    onChange={(e) => setDecision(e.target.value)}
                  >
                    <option value="">Choose decision</option>
                    <option value="approved">Approve immediate move</option>
                    <option value="rejected">
                      Reject and preserve placement
                    </option>
                  </select>
                </label>
                <label>
                  Move review reason
                  <textarea
                    aria-label="Move review reason"
                    required
                    minLength={3}
                    maxLength={500}
                    value={reviewReason}
                    onChange={(e) => setReviewReason(e.target.value)}
                  />
                </label>
                <button disabled={!item || !reviewEstate}>
                  Record move decision
                </button>
              </form>
            )}
            <form
              aria-label="Area availability"
              onSubmit={(e) => {
                e.preventDefault();
                if (chosen)
                  void save(
                    () =>
                      api(`/customers/${customerId}/areas/${area}/lifecycle`, {
                        active: !chosen.active,
                        version: chosen.version,
                        reason: lifecycleReason,
                      }),
                    "Area availability saved.",
                    () => setLifecycleReason(""),
                  );
              }}
            >
              <h4>3. Area availability</h4>
              <p>
                Deactivation keeps the area and audit history. Assigned estates
                or active child areas block it, including dependencies outside
                your estate access. Inactive destinations cannot receive new
                placements or approved moves.
              </p>
              <label>
                Lifecycle area
                <select
                  aria-label="Lifecycle area"
                  required
                  value={area}
                  onChange={(e) => {
                    setArea(e.target.value);
                    setLifecycleReason("");
                    setMessage("");
                  }}
                >
                  <option value="">Choose area</option>
                  {data.areas.map((a: any) => (
                    <option key={a.id} value={a.id}>
                      {a.code} · {a.name} · {a.active ? "Active" : "Inactive"}
                    </option>
                  ))}
                </select>
              </label>
              {chosen && (
                <p>
                  Current status: {chosen.active ? "Active" : "Inactive"} ·
                  Version {chosen.version}. Next action:{" "}
                  {chosen.active ? "Deactivate" : "Reactivate"}.
                </p>
              )}
              <label>
                Lifecycle reason
                <textarea
                  aria-label="Lifecycle reason"
                  required
                  minLength={3}
                  maxLength={500}
                  value={lifecycleReason}
                  onChange={(e) => setLifecycleReason(e.target.value)}
                />
              </label>
              <button disabled={!chosen}>
                {chosen?.active === false
                  ? "Reactivate area"
                  : "Deactivate area"}
              </button>
            </form>
          </div>
        </fieldset>
      ) : (
        <p>
          View only. Changes require explicit customer setup permission and
          estate membership for moves.
        </p>
      )}
      {pending.some((q: any) => q.requester_id === moves.actorId) && (
        <p>
          You cannot review your own move request. Ask a different authorized
          setup administrator with this estate assigned.
        </p>
      )}
      <h4>Move requests and decisions</h4>
      {!moves.items.length && (
        <p>No permitted move requests in the recent window.</p>
      )}
      {moves.items.map((q: any) => (
        <article className="event" key={q.id} data-move-request-id={q.id}>
          <div className="eventbody">
            <strong>
              {q.decision || "Pending"} ·{" "}
              {data.estates.find((e: any) => e.id === q.estate_id)?.name ||
                "Assigned estate"}
            </strong>
            <p>
              {label(q.from_area_id)} → {label(q.to_area_id)}
            </p>
            <p>
              {q.reason} · Requested by {q.requester}
            </p>
            {q.decision && (
              <p>
                {q.decision_reason} · Reviewed by {q.reviewer}
              </p>
            )}
            <details>
              <summary>View move audit details</summary>
              <dl className="auditdetails">
                <dt>Request / source / destination</dt>
                <dd>
                  {q.id} · {q.from_area_id || "Customer root"} →{" "}
                  {q.to_area_id || "Customer root"}
                </dd>
                <dt>Expected version / requester / time</dt>
                <dd>
                  {q.expected_version} · {q.requester_id} · {q.created_at}
                </dd>
                <dt>Decision / reviewer / time</dt>
                <dd>
                  {q.decision_id || "Pending"} ·{" "}
                  {q.reviewer_id || "Awaiting independent review"} ·{" "}
                  {q.decided_at || "—"}
                </dd>
                <dt>Request / decision support references</dt>
                <dd>
                  {q.request_id || "Not recorded"} ·{" "}
                  {q.decision_request_id || "Pending"}
                </dd>
              </dl>
            </details>
          </div>
        </article>
      ))}
    </section>
  );
}
