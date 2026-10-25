import { HierarchyScopes } from "./HierarchyScopes";
import { HierarchyProvisioning } from "./HierarchyProvisioning";
import { SearchSelect } from "./SearchSelect";
import { OperationalSites } from "./OperationalSites";
import { OrganizationExplorer } from "./OrganizationExplorer";
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
  onPending,
}: {
  api: (path: string, body?: unknown) => Promise<any>;
  onOpenEstate: (id: string) => void;
  onPending: (v: boolean) => void;
}) {
  const [provisioningPending, setProvisioningPending] = useState(false);
  const [scopePending, setScopePending] = useState(false);
  const [rows, setRows] = useState<Node[]>([]),
    [customer, setCustomer] = useState(""),
    [customerReady, setCustomerReady] = useState(false),
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
      <HierarchyScopes
        api={api}
        customerId={customerReady ? customer : ""}
        disabled={provisioningPending}
        onPending={(v) => {
          setScopePending(v);
          onPending(v || provisioningPending);
        }}
      />
      <HierarchyProvisioning
        disabled={scopePending}
        api={api}
        customerId={customerReady ? customer : ""}
        onOpenEstate={onOpenEstate}
        onPending={(v) => {
          setProvisioningPending(v);
          onPending(v || scopePending);
        }}
      />
      <fieldset
        disabled={provisioningPending || scopePending}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        <ol>
          <li>Select a customer you can access.</li>
          <li>Review the legal company and assigned estates below.</li>
          <li>Open an estate to continue in its muster register.</li>
        </ol>
        <p>
          Only your assigned estates are shown. Seeing a customer or company
          does not grant access to its other estates. Use the hierarchy setup
          below to review or configure permitted groups, divisions, fields and
          blocks.
        </p>
        <OrganizationExplorer api={api} onOpenEstate={onOpenEstate} />
        {customer && customerReady && (
          <p>
            <a
              href="#operational-sites"
              onClick={(event) => {
                event.preventDefault();
                const target = document.getElementById("operational-sites");
                target?.focus({ preventScroll: true });
                target?.scrollIntoView({ block: "start" });
              }}
            >
              Go to operational site setup and history
            </a>
          </p>
        )}
        {loading && <p role="status">Loading your organization…</p>}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {!loading && !error && !rows.length && (
          <p>
            No assigned organization is available. Ask your administrator to
            check your estate assignments.
          </p>
        )}
        {truncated && (
          <p role="status">
            The overview shows the first 200 accessible estates. Use the
            searchable explorer above to find other assigned estates. Search
            Customer below to configure another permitted customer. Some other
            configuration panels retain separate limits.
          </p>
        )}
        {!loading && (
          <SearchSelect
            api={api}
            path="/navigation/customers"
            label="Customer"
            value={customer}
            onChange={setCustomer}
            onReady={setCustomerReady}
            seed={customers.map((row) => ({
              id: row.customer_id,
              code: row.customer_code,
              name: row.customer_name,
            }))}
          />
        )}
        {customer && !selected.length && (
          <p>
            This customer is outside the overview. Use Hierarchy estate below or
            the Organization explorer to find its permitted estates.
          </p>
        )}
        {companies.map((company) => (
          <section
            className="editor"
            key={company.company_id}
            data-company-id={company.company_id}
          >
            <h3>{company.company_name}</h3>
            <p>
              Baseline legal company ·{" "}
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
          <fieldset
            disabled={!customerReady}
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
          >
            <HierarchySetup key={customer} api={api} customerId={customer} />
            <OperationalSites
              key={customer + "-sites"}
              api={api}
              customerId={customer}
              onOpenEstate={onOpenEstate}
            />
          </fieldset>
        )}
        {customer && (
          <section aria-label="Customer name and code history">
            <h3>Customer name and code history</h3>
            <p>
              Recent recorded changes to this customer's display details. This
              is not a complete administrative audit.
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
                    {event.actor} ·{" "}
                    {new Date(event.created_at).toLocaleString()}
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
      </fieldset>
    </section>
  );
}
