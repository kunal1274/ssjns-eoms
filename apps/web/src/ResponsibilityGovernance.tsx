import { SearchSelect } from "./SearchSelect";
import { DecisionLedger } from "./DecisionLedger";
import { useState } from "react";
type Api = (path: string, body?: unknown) => Promise<any>;
export function ResponsibilityGovernance({
  estate,
  api,
  data,
  onChanged,
  onBusy,
  busy,
  refreshKey,
}: {
  estate: string;
  api: Api;
  data: any;
  onChanged: () => Promise<void>;
  onBusy: (busy: boolean) => void;
  busy: boolean;
  refreshKey: number;
}) {
  const [requestReason, setRequestReason] = useState(""),
    [reviewReason, setReviewReason] = useState(""),
    [request, setRequest] = useState(""),
    [decision, setDecision] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [needsRefresh, setNeedsRefresh] = useState(false),
    [requestReady, setRequestReady] = useState(false);
  const requests = data.requests || [],
    pending = requests.filter((row: any) => !row.decision),
    reviewable = pending.filter(
      (row: any) => row.requester_id !== data.actorId,
    ),
    last =
      data.lastActive ||
      data.items.find((row: any) => row.id === data.lastActiveId);
  async function act(
    action: () => Promise<any>,
    success: string,
    reset: () => void,
  ) {
    onBusy(true);
    setError("");
    setMessage("");
    let saved = false;
    try {
      await action();
      saved = true;
      reset();
      setMessage(success);
      await onChanged();
    } catch (e) {
      if (saved) setNeedsRefresh(true);
      setError(
        (saved
          ? "Action saved, but refresh failed. Refresh the saved history before another action. "
          : "") + (e as Error).message,
      );
    } finally {
      onBusy(false);
    }
  }
  return (
    <section className="editor" aria-label="Responsibility cancellation review">
      <h4>Governed future cancellation and correction</h4>
      <p>
        Request cancellation of the latest strictly future change. A different
        setup administrator must independently approve or reject it. Approval
        rechecks recorded work and the timeline; pending requests do not change
        responsibility. The original event is retained.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message &&
        (!message.startsWith("Cancellation requested") ||
          pending.some((row: any) => row.requester_id === data.actorId)) && (
          <p role="status">{message}</p>
        )}
      {needsRefresh && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            onBusy(true);
            void onChanged()
              .then(() => {
                setNeedsRefresh(false);
                setError("");
              })
              .catch((e) => setError(e.message))
              .finally(() => onBusy(false));
          }}
        >
          Refresh saved cancellation history
        </button>
      )}
      {data.canConfigure &&
        last &&
        last.effective_from > data.today &&
        !pending.some((row: any) => row.responsibility_id === last.id) && (
          <form
            aria-label="Request future cancellation"
            onSubmit={(e) => {
              e.preventDefault();
              void act(
                () =>
                  api(
                    `/estates/${estate}/responsibility/${last.id}/cancellation`,
                    { revision: data.revision, reason: requestReason },
                  ),
                "Cancellation requested. Independent review is required.",
                () => setRequestReason(""),
              );
            }}
          >
            <p>
              Latest active change: {last.effective_from} · {last.company_name}{" "}
              · revision {data.revision}. Work on or after this date prevents
              cancellation.
            </p>
            <fieldset disabled={busy || needsRefresh}>
              <label>
                Cancellation request reason
                <textarea
                  aria-label="Cancellation request reason"
                  required
                  minLength={3}
                  maxLength={500}
                  value={requestReason}
                  onChange={(e) => setRequestReason(e.target.value)}
                />
              </label>
              <button>Request cancellation</button>
            </fieldset>
          </form>
        )}
      {data.canConfigure && last && last.effective_from <= data.today && (
        <p>
          The latest active change is already effective. This flow cannot cancel
          effective history or restate recorded work.
        </p>
      )}
      {pending.some((row: any) => row.requester_id === data.actorId) && (
        <p>
          You have a pending request. A different setup administrator with
          access to this estate must review it; you cannot review your own
          request.
        </p>
      )}
      {data.canConfigure &&
        (data.hasReviewableCancellation || reviewable.length > 0) && (
          <form
            aria-label="Independent cancellation decision"
            onSubmit={(e) => {
              e.preventDefault();
              void act(
                () =>
                  api(
                    `/estates/${estate}/responsibility/requests/${request}/decision`,
                    { decision, revision: data.revision, reason: reviewReason },
                  ),
                "Independent decision recorded. Review the responsibility timeline.",
                () => {
                  setRequest("");
                  setDecision("");
                  setReviewReason("");
                },
              );
            }}
          >
            <fieldset disabled={busy || needsRefresh}>
              <SearchSelect
                api={api}
                path={`/navigation/estates/${estate}/cancellations?purpose=choice&status=pending`}
                label="Cancellation request"
                value={request}
                onChange={(id) => {
                  setRequest(id);
                  setDecision("");
                  setReviewReason("");
                }}
                onReady={setRequestReady}
                seed={reviewable.map((r: any) => ({
                  ...r,
                  name: r.requester + " · " + r.reason,
                }))}
                refreshKey={refreshKey}
                required
                placeholder="Choose a pending request from another administrator"
              />
              <label>
                Cancellation decision
                <select
                  aria-label="Cancellation decision"
                  required
                  value={decision}
                  onChange={(e) => setDecision(e.target.value)}
                >
                  <option value="">Choose an explicit decision</option>
                  <option value="approved">Approve cancellation</option>
                  <option value="rejected">Reject request</option>
                </select>
              </label>
              <label>
                Independent review reason
                <textarea
                  aria-label="Independent review reason"
                  required
                  minLength={3}
                  maxLength={500}
                  value={reviewReason}
                  onChange={(e) => setReviewReason(e.target.value)}
                />
              </label>
              <button disabled={!request || !requestReady}>
                Record independent decision
              </button>
            </fieldset>
          </form>
        )}
      <DecisionLedger
        api={api}
        path={`/navigation/estates/${estate}/cancellations`}
        label="Cancellation ledger"
        disabled={busy || needsRefresh}
        kind="cancellation"
        refreshKey={refreshKey}
        onChoose={
          data.canConfigure
            ? (row) => {
                setRequest(row.id);
                setDecision("");
                setReviewReason("");
              }
            : undefined
        }
        choiceLabel="Review cancellation"
        choiceTarget="Cancellation request"
      />
      <h4>Recent cancellation requests and decisions</h4>
      {!requests.length && (
        <p>No permitted cancellation requests in this history window.</p>
      )}
      {requests.map((row: any) => (
        <article className="event" key={row.id} data-cancel-request-id={row.id}>
          <div className="eventbody">
            <strong>
              {row.decision
                ? "Cancellation " + row.decision
                : "Pending independent review"}
            </strong>
            <small>
              {row.requester} · requested{" "}
              {new Date(row.created_at).toLocaleString()}
            </small>
            <p>{row.reason}</p>
            {row.decision && (
              <p>
                {row.reviewer} · {row.decision_reason}
              </p>
            )}
            <details>
              <summary>View cancellation review details</summary>
              <dl className="auditdetails">
                <dt>Original change / requested revision</dt>
                <dd>
                  {row.responsibility_id} · {row.expected_revision}
                </dd>
                <dt>Request support reference</dt>
                <dd>{row.request_id || "Not recorded"}</dd>
                {row.decision && (
                  <>
                    <dt>Independent decision / recorded time</dt>
                    <dd>
                      {row.decision} ·{" "}
                      {new Date(row.decided_at).toLocaleString()}
                    </dd>
                    <dt>Decision support reference</dt>
                    <dd>{row.decision_reference || "Not recorded"}</dd>
                  </>
                )}
              </dl>
            </details>
          </div>
        </article>
      ))}
      <p>
        After approval, use the correction-source selector in the scheduling
        form to create an explicitly linked replacement. Rejection leaves the
        original schedule active. Company transfers, retroactive corrections,
        operational moves and deactivation remain outside this flow.
      </p>
    </section>
  );
}
