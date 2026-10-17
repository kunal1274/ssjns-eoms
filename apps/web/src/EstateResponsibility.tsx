import { useEffect, useState } from "react";
type Api = (path: string, body?: unknown) => Promise<any>;
export function EstateResponsibility({
  api,
  customerId,
}: {
  api: Api;
  customerId: string;
}) {
  const [estates, setEstates] = useState<any[]>([]),
    [estate, setEstate] = useState(""),
    [data, setData] = useState<any>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [company, setCompany] = useState(""),
    [effective, setEffective] = useState(""),
    [reason, setReason] = useState(""),
    [review, setReview] = useState("");
  const path = `/estates/${estate}/responsibility`;
  useEffect(() => {
    let active = true;
    api(`/customers/${customerId}/hierarchy`)
      .then((value) => {
        if (active) {
          setEstates(value.estates);
          setEstate(value.estates[0]?.id || "");
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [customerId]);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    setMessage("");
    setCompany("");
    setEffective("");
    setReason("");
    if (estate) {
      setLoading(true);
      api(path)
        .then((value) => {
          if (active) {
            setData(value);
            setReview(value.asOf);
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }
    return () => {
      active = false;
    };
  }, [estate]);
  async function read(on = review) {
    setBusy(true);
    setError("");
    try {
      const value = await api(path + (on ? "?on=" + on : ""));
      setData(value);
      setReview(value.asOf);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const lastCompany = data?.items[0]?.company_id || data?.baseline.id;
  return (
    <section className="editor" aria-label="Estate responsibility">
      <h3>Estate responsibility</h3>
      <p>
        Review the responsible company for a business date. Changes are dated
        operational/accounting responsibility records; the baseline
        legal-company link is retained. This does not grant access to the
        company's other estates or activate finance posting.
      </p>
      <ol>
        <li>
          Choose an assigned estate and review its date-based responsibility.
        </li>
        <li>
          If authorized, schedule a different accessible company from a current
          or future date, with a reason.
        </li>
        <li>
          Review the recorded change and capture work in the estate register.
          New work retains its company attribution.
        </li>
      </ol>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {loading && <p role="status">Loading estate responsibility…</p>}
      <label>
        Responsibility estate
        <select
          aria-label="Responsibility estate"
          value={estate}
          disabled={busy}
          onChange={(e) => setEstate(e.target.value)}
        >
          {estates.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="secondary"
        disabled={busy || !estate}
        onClick={() => void read()}
      >
        Refresh responsibility
      </button>
      {data && !loading && (
        <>
          <p>
            Baseline company: {data.baseline.name}. Database business date:{" "}
            {data.today}. History revision: {data.revision}.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void read();
            }}
          >
            <label>
              Responsibility review date
              <input
                type="date"
                required
                min="2000-01-01"
                max="9998-12-31"
                value={review}
                onChange={(e) => setReview(e.target.value)}
              />
            </label>
            <button disabled={busy}>View responsibility date</button>
          </form>
          <p data-responsibility-summary="true">
            <strong>
              Responsible from the timeline on {data.asOf}:{" "}
              {data.responsible.name}
            </strong>{" "}
            ·{" "}
            {data.responsible.assignmentId
              ? "Dated change"
              : "Baseline assignment"}
          </p>
          {!data.canConfigure && (
            <p>
              View only. Changes require explicit customer setup permission and
              estate membership.
            </p>
          )}
          {data.canConfigure && (
            <form
              aria-label="Schedule responsibility"
              onSubmit={(e) => {
                e.preventDefault();
                void (async () => {
                  setBusy(true);
                  setError("");
                  setMessage("");
                  let committed = false;
                  try {
                    const saved = await api(path, {
                      companyId: company,
                      effectiveFrom: effective,
                      revision: data.revision,
                      reason,
                    });
                    committed = true;
                    setMessage(
                      "Responsibility change saved. Existing work retained.",
                    );
                    setCompany("");
                    setEffective("");
                    setReason("");
                    const value = await api(
                      path + "?on=" + saved.effective_from,
                    );
                    setData(value);
                    setReview(value.asOf);
                  } catch (e) {
                    setError(
                      (committed
                        ? "Change saved, but refreshing failed. Refresh before retrying. "
                        : "") + (e as Error).message,
                    );
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              <h4>Schedule the next responsibility change</h4>
              <p>
                Use a date later than the latest change. Any work already
                recorded on or after the proposed date blocks scheduling. Saved
                changes are append-only; cancellation, retroactive correction
                and movement/deactivation approvals are still planned.
              </p>
              <fieldset disabled={busy}>
                <label>
                  Next responsible company
                  <select
                    aria-label="Next responsible company"
                    required
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                  >
                    <option value="">
                      Choose an accessible company in this customer
                    </option>
                    {data.companies
                      .filter((row: any) => row.id !== lastCompany)
                      .map((row: any) => (
                        <option key={row.id} value={row.id}>
                          {row.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Responsibility effective date
                  <input
                    type="date"
                    required
                    min={data.today}
                    max="9998-12-31"
                    value={effective}
                    onChange={(e) => setEffective(e.target.value)}
                  />
                </label>
                <label>
                  Responsibility reason
                  <textarea
                    required
                    minLength={3}
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <button>Save responsibility change</button>
              </fieldset>
            </form>
          )}
          {data.truncated && (
            <p>
              A bounded company/history window is shown. Full navigation and
              company provisioning remain pending.
            </p>
          )}
          <h4>Recorded responsibility changes</h4>
          <p>
            Each date applies until the next recorded change. Capture time and
            business-effective date are separate. Existing work with a saved
            attribution is never recalculated; old records without a snapshot
            are marked as legacy.
          </p>
          {!data.items.length && (
            <p>
              No dated changes. New work uses the configured baseline company.
            </p>
          )}
          {data.items.map((row: any) => (
            <article
              className="event"
              key={row.id}
              data-responsibility-id={row.id}
            >
              <div className="eventbody">
                <strong>
                  From {row.effective_from} · {row.company_name}
                </strong>
                <small>
                  {row.actor} · recorded{" "}
                  {new Date(row.created_at).toLocaleString()}
                </small>
                <p>{row.reason}</p>
                <details>
                  <summary>View responsibility change details</summary>
                  <dl className="auditdetails">
                    <dt>Previous company</dt>
                    <dd>
                      {row.previous_company_name} · {row.previous_company_id}
                    </dd>
                    <dt>Responsible company</dt>
                    <dd>
                      {row.company_name} · {row.company_id}
                    </dd>
                    <dt>Effective from / revision</dt>
                    <dd>
                      {row.effective_from} · {row.revision}
                    </dd>
                    <dt>Support reference</dt>
                    <dd>{row.request_id || "Not recorded"}</dd>
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
