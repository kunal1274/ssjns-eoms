export type AuditEvent = {
  id: string | number;
  action: string;
  actor: string;
  created_at: string;
  record_id?: string | null;
  detail?: Record<string, unknown>;
};
const labels: Record<string, string> = {
  "muster.created": "Muster draft saved",
  "muster.confirmed": "Muster confirmed",
  "muster.approved": "Muster approved",
  "muster.reversed": "Muster reversed",
  "worker.created": "Worker added",
  "worker.updated": "Worker updated",
  "task.created": "Task added",
  "task.updated": "Task updated",
  "period.created": "Period added",
  "period.updated": "Period updated",
  "gang.created": "Gang added",
  "gang.updated": "Gang updated",
};
// Explicit presentation allowlist. Never dump audit payloads or employee snapshots.
const fields = {
  month: "Period",
  reason: "Reason",
  previousVersion: "Previous version",
  version: "Recorded version",
  quantityHa: "Area (Ha)",
  workers: "Worker count",
  requestId: "Support reference",
};
export function AuditTrail({ events }: { events: AuditEvent[] }) {
  return (
    <section className="card" aria-label="Estate audit trail">
      <h2>Latest 50 estate events</h2>
      <p>
        Read the summary, then expand an event for its recorded details. Times
        use your device time zone (
        {Intl.DateTimeFormat().resolvedOptions().timeZone}). This list is a
        recent window, not the complete history.
      </p>
      {!events.length && (
        <p className="empty">
          Events appear when work is recorded. Choose the Muster register to
          begin.
        </p>
      )}
      {events.map((event) => (
        <article className="event" key={event.id}>
          <span className="dot" aria-hidden="true" />
          <div className="eventbody">
            <strong>
              {labels[event.action] || "Estate activity recorded"}
            </strong>
            <small>
              {event.actor} ·{" "}
              <time dateTime={event.created_at}>
                {new Date(event.created_at).toLocaleString()}
              </time>
            </small>
            <details>
              <summary>View event details</summary>
              <dl className="auditdetails">
                <dt>Event ID</dt>
                <dd>{event.id}</dd>
                <dt>Event type</dt>
                <dd>{event.action}</dd>
                {event.record_id && (
                  <>
                    <dt>Record ID</dt>
                    <dd>{event.record_id}</dd>
                  </>
                )}
                {Object.entries(fields).map(([key, label]) => {
                  const value = event.detail?.[key];
                  return (
                    (typeof value === "string" ||
                      typeof value === "number") && (
                      <div key={key}>
                        <dt>{label}</dt>
                        <dd>{String(value).slice(0, 1000)}</dd>
                      </div>
                    )
                  );
                })}
              </dl>
              <small>
                Only fields captured for this event are shown. Complete
                before/after history and permission-controlled audit views are
                planned.
              </small>
            </details>
          </div>
        </article>
      ))}
    </section>
  );
}
