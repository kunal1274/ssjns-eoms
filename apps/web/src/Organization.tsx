import { HierarchySetup } from "./HierarchySetup";
import { useEffect, useState } from "react";
type Node = {
  customer_id: string;
  customer_code: string;
  customer_name: string;
  company_id: string;
  company_name: string;
  estate_id: string;
  estate_code: string;
  estate_name: string;
};
type History = {
  id: string;
  action: string;
  actor: string;
  created_at: string;
  before_name: string | null;
  before_code: string | null;
  after_name: string;
  after_code: string;
  request_id: string | null;
};
export function Organization({
  api,
  onOpenEstate,
}: {
  api: (path: string, body?: unknown) => Promise<any>;
  onOpenEstate: (id: string) => void;
}) {
  const [rows, setRows] = useState<Node[]>([]),
    [customer, setCustomer] = useState(""),
    [events, setEvents] = useState<History[]>([]),
    [loading, setLoading] = useState(true),
    [historyLoading, setHistoryLoading] = useState(false),
    [error, setError] = useState(""),
    [historyError, setHistoryError] = useState(""),
    [truncated, setTruncated] = useState(false),
    [historyTruncated, setHistoryTruncated] = useState(false);
  useEffect(() => {
    let active = true;
    api("/organization")
      .then((result) => {
        if (active) {
          setRows(result.items);
          setCustomer(result.items[0]?.customer_id || "");
          setTruncated(result.truncated);
        }
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
  }, []);
  useEffect(() => {
    let active = true;
    setEvents([]);
    setHistoryError("");
    setHistoryTruncated(false);
    if (customer) {
      setHistoryLoading(true);
      api(`/customers/${customer}/history`)
        .then((result) => {
          if (active) {
            setEvents(result.items);
            setHistoryTruncated(result.truncated);
          }
        })
        .catch((e) => {
          if (active) setHistoryError(e.message);
        })
        .finally(() => {
          if (active) setHistoryLoading(false);
        });
    }
    return () => {
      active = false;
    };
  }, [customer]);
  const customers = [
    ...new Map(rows.map((row) => [row.customer_id, row])).values(),
  ];
  const selected = rows.filter((row) => row.customer_id === customer);
  const companies = [
    ...new Map(selected.map((row) => [row.company_id, row])).values(),
  ];
  return (
    <section className="card" aria-label="Organization guide">
      <h2>Choose your operating context</h2>
      <ol>
        <li>Select a customer you can access.</li>
        <li>Review the legal company and assigned estates below.</li>
        <li>Open an estate to continue in its muster register.</li>
      </ol>
      <p>
        Only your assigned estates are shown. Seeing a customer or company does
        not grant access to its other estates. Use the hierarchy setup below to
        review or configure permitted groups, divisions, fields and blocks.
      </p>
      {loading && <p role="status">Loading your organization…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!loading && !error && !rows.length && (
        <p>
          No assigned organization is available. Ask your administrator to check
          your estate assignments.
        </p>
      )}
      {truncated && (
        <p role="status">
          Showing the first 200 accessible estates. Complete organization
          navigation for larger assignments is still pending.
        </p>
      )}
      {!!customers.length && (
        <label>
          Customer
          <select
            aria-label="Customer"
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
          >
            {customers.map((row) => (
              <option key={row.customer_id} value={row.customer_id}>
                {row.customer_name} · {row.customer_code}
              </option>
            ))}
          </select>
        </label>
      )}
      {companies.map((company) => (
        <section
          className="editor"
          key={company.company_id}
          data-company-id={company.company_id}
        >
          <h3>{company.company_name}</h3>
          <p>
            Legal company ·{" "}
            {
              selected.filter((row) => row.company_id === company.company_id)
                .length
            }{" "}
            accessible estate(s)
          </p>
          {selected
            .filter((row) => row.company_id === company.company_id)
            .map((row) => (
              <div
                className="event"
                key={row.estate_id}
                data-estate-id={row.estate_id}
              >
                <div className="eventbody">
                  <strong>
                    {row.estate_name} · {row.estate_code}
                  </strong>
                  <p>Continue with work assigned to this estate.</p>
                  <button onClick={() => onOpenEstate(row.estate_id)}>
                    Open {row.estate_name}
                  </button>
                </div>
              </div>
            ))}
        </section>
      ))}
      {customer && (
        <HierarchySetup key={customer} api={api} customerId={customer} />
      )}
      {customer && (
        <section aria-label="Customer name and code history">
          <h3>Customer name and code history</h3>
          <p>
            Recent recorded changes to this customer's display details. This is
            not a complete administrative audit.
          </p>
          {historyLoading && <p role="status">Loading customer history…</p>}
          {historyError && (
            <p role="alert" className="error">
              {historyError}
            </p>
          )}
          {!historyLoading && !historyError && !events.length && (
            <p>No recorded customer changes are available.</p>
          )}
          {historyTruncated && (
            <p role="status">Showing the latest 50 customer events.</p>
          )}
          {events.map((event) => (
            <article className="event" key={event.id}>
              <div className="eventbody">
                <strong>
                  {event.action === "customer.created"
                    ? "Customer registered"
                    : "Customer display details updated"}
                </strong>
                <small>
                  {event.actor} · {new Date(event.created_at).toLocaleString()}
                </small>
                <details>
                  <summary>View customer change details</summary>
                  <dl className="auditdetails">
                    <dt>Event ID</dt>
                    <dd>{event.id}</dd>
                    <dt>Before</dt>
                    <dd>
                      {event.before_name
                        ? `${event.before_name} · ${event.before_code}`
                        : "No previous value (creation)"}
                    </dd>
                    <dt>After</dt>
                    <dd>
                      {event.after_name} · {event.after_code}
                    </dd>
                    {event.request_id && (
                      <>
                        <dt>Support reference</dt>
                        <dd>{event.request_id}</dd>
                      </>
                    )}
                  </dl>
                </details>
              </div>
            </article>
          ))}
        </section>
      )}
    </section>
  );
}
