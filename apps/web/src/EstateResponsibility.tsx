import { SearchSelect } from "./SearchSelect";
import { ResponsibilityGovernance } from "./ResponsibilityGovernance";
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
    [estateReady, setEstateReady] = useState(false),
    [companyReady, setCompanyReady] = useState(false),
    [needsRefresh, setNeedsRefresh] = useState(false),
    [data, setData] = useState<any>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [company, setCompany] = useState(""),
    [effective, setEffective] = useState(""),
    [reason, setReason] = useState(""),
    [review, setReview] = useState(""),
    [replaces, setReplaces] = useState("");
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
    setReplaces("");
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
      setNeedsRefresh(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const lastCompany = data?.lastActiveCompanyId || data?.baseline.id;
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
      <SearchSelect
        api={api}
        path={`/navigation/estates?customerId=${customerId}`}
        label="Responsibility estate"
        value={estate}
        onChange={setEstate}
        onReady={setEstateReady}
        seed={estates}
        disabled={busy}
      />
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
                      replacesId: replaces || null,
                    });
                    committed = true;
                    setMessage(
                      "Responsibility change saved. Existing work retained.",
                    );
                    setCompany("");
                    setEffective("");
                    setReason("");
                    setReplaces("");
                    const value = await api(
                      path + "?on=" + saved.effective_from,
                    );
                    setData(value);
                    setReview(value.asOf);
                  } catch (e) {
                    if (committed) setNeedsRefresh(true);
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
                changes are append-only. Future cancellation requires
                independent review below; retroactive correction and
                movement/deactivation approvals remain planned.
              </p>
              <fieldset disabled={busy || needsRefresh || !estateReady}>
                <label>
                  Correction source
                  <select
                    aria-label="Correction source"
                    value={replaces}
                    onChange={(e) => setReplaces(e.target.value)}
                  >
                    <option value="">New schedule (no replacement)</option>
                    {data.items
                      .filter(
                        (row: any) =>
                          row.cancelled &&
                          !data.items.some(
                            (other: any) =>
                              other.replaces_responsibility_id === row.id,
                          ),
                      )
                      .map((row: any) => (
                        <option key={row.id} value={row.id}>
                          {row.effective_from} · {row.company_name} · approved
                          cancellation
                        </option>
                      ))}
                  </select>
                </label>
                <p>
                  Search for a different accessible company in this customer. A
                  company label does not grant access to its other estates;
                  provisioning remains separate.
                </p>
                <SearchSelect
                  api={api}
                  path={`/navigation/customers/${customerId}/companies?excludeId=${lastCompany}`}
                  label="Next responsible company"
                  value={company}
                  onChange={setCompany}
                  onReady={setCompanyReady}
                  seed={data.companies.filter(
                    (row: any) => row.id !== lastCompany,
                  )}
                  required
                />
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
                    aria-label="Responsibility reason"
                    required
                    minLength={3}
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <button disabled={!company || !companyReady}>
                  Save responsibility change
                </button>
              </fieldset>
            </form>
          )}
          {data.truncated && (
            <p>
              The recent history/correction-source window is bounded. Searchable
              company choices are available above; dedicated ledger navigation
              and provisioning remain pending.
            </p>
          )}
          <ResponsibilityGovernance
            key={estate}
            estate={estate}
            api={api}
            data={data}
            busy={busy || needsRefresh}
            onBusy={setBusy}
            onChanged={async () => {
              const value = await api(path + (review ? "?on=" + review : ""));
              setData(value);
              setReview(value.asOf);
            }}
          />
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
                  From {row.effective_from} · {row.company_name} ·{" "}
                  {row.cancelled
                    ? "Cancelled after independent review"
                    : "Active schedule"}
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
                    {row.replaces_responsibility_id && (
                      <>
                        <dt>Replaces approved-cancelled change</dt>
                        <dd>{row.replaces_responsibility_id}</dd>
                      </>
                    )}
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
