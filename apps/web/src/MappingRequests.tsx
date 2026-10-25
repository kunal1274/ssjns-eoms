import { OverlayExecution } from "./OverlayExecution";
import { useEffect, useRef, useState } from "react";
import { RequestFailure } from "./feedback";
type Api = (path: string, body?: unknown) => Promise<any>;
export function MappingRequests({
  path,
  api,
  onPending,
}: {
  path: string;
  api: Api;
  onPending: (v: boolean) => void;
}) {
  const base = path.split("/jobs/")[0];
  const [context, setContext] = useState<any>(null),
    [list, setList] = useState<any>(null),
    [detail, setDetail] = useState<any>(null),
    [decisions, setDecisions] = useState<any>(null),
    [candidates, setCandidates] = useState<any>(null),
    [authority, setAuthority] = useState<any>(null),
    [selected, setSelected] = useState(""),
    [showExecution, setShowExecution] = useState(false),
    [overlayPending, setOverlayPending] = useState(false),
    [subject, setSubject] = useState(""),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [cursor, setCursor] = useState<string | null>(null),
    [decisionCursor, setDecisionCursor] = useState<string | null>(null),
    [candidateCursor, setCandidateCursor] = useState<string | null>(null),
    [authorityCursor, setAuthorityCursor] = useState<string | null>(null),
    [attempt, setAttempt] = useState(0),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(false),
    [readError, setReadError] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [custody, setCustody] = useState(""),
    [reason, setReason] = useState(""),
    [previous, setPrevious] = useState(""),
    [action, setAction] = useState("appointed"),
    [appointmentRef, setAppointmentRef] = useState(""),
    [appointmentReason, setAppointmentReason] = useState(""),
    [outcome, setOutcome] = useState("returned"),
    [reference, setReference] = useState(""),
    [decisionReason, setDecisionReason] = useState(""),
    [examined, setExamined] = useState(false);
  const live = useRef(true),
    epoch = useRef(0),
    write = useRef<{
      kind: "request" | "appointment" | "decision";
      path: string;
      body: any;
    } | null>(null);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      epoch.current++;
      onPending(false);
    };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setReadError("");
    setContext(null);
    setList(null);
    setDetail(null);
    setDecisions(null);
    setCandidates(null);
    setAuthority(null);
    (async () => {
      const ctx = await api(path + "/context"),
        rows = await api(
          path +
            "?limit=10" +
            (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
        );
      const people = await api(
        base +
          "/policy-authority/candidates?limit=10&q=" +
          encodeURIComponent(query) +
          (candidateCursor
            ? "&cursor=" + encodeURIComponent(candidateCursor)
            : ""),
      );
      const auth = await api(
        base +
          "/mapping-authority?limit=10" +
          (subject ? "&subjectId=" + subject : "") +
          (authorityCursor
            ? "&cursor=" + encodeURIComponent(authorityCursor)
            : ""),
      );
      const d = selected
        ? await api(base + "/mapping-requests/" + selected)
        : null;
      const audit = selected
        ? await api(
            base +
              "/mapping-requests/" +
              selected +
              "/decisions?limit=10" +
              (decisionCursor
                ? "&cursor=" + encodeURIComponent(decisionCursor)
                : ""),
          )
        : null;
      if (active) {
        setContext(ctx);
        setList(rows);
        setCandidates(people);
        setAuthority(auth);
        setDetail(d);
        setDecisions(audit);
      }
    })()
      .catch((e) => {
        if (active) setReadError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    path,
    selected,
    subject,
    query,
    cursor,
    decisionCursor,
    candidateCursor,
    authorityCursor,
    attempt,
  ]);
  const target = authority?.state?.head,
    appointmentValid =
      subject &&
      appointmentRef.trim().length >= 3 &&
      appointmentReason.trim().length >= 3 &&
      (action === "appointed"
        ? subject !== context?.actorId &&
          authority?.state?.eligible &&
          context?.acceptance?.current
        : target?.action === "appointed"),
    requestValid =
      context?.binding?.eligible &&
      custody.trim().length >= 3 &&
      reason.trim().length >= 3 &&
      (!previous || /^[a-f0-9-]{36}$/.test(previous)),
    bound =
      detail?.ownAuthority?.head?.policy_id ===
        detail?.mappingRequest.policy_id &&
      detail?.ownAuthority?.head?.acceptance_id ===
        detail?.mappingRequest.acceptance_id,
    canDecide =
      detail?.state.independent &&
      detail?.ownAuthority?.recordingAllowed &&
      bound &&
      (outcome === "withdrawn"
        ? detail.state.head?.outcome === "approved"
        : !detail.state.head &&
          (outcome !== "approved" ||
            (detail.ownAuthority.effective &&
              detail.state.bindingUnchanged &&
              detail.state.requesterScopeCurrent &&
              detail.state.current.eligible))),
    decisionValid =
      canDecide &&
      examined &&
      reference.trim().length >= 3 &&
      decisionReason.trim().length >= 3;
  async function submit(kind: "request" | "appointment" | "decision") {
    if (
      busy ||
      overlayPending ||
      loading ||
      readError ||
      (!write.current &&
        !(kind === "request"
          ? requestValid
          : kind === "appointment"
            ? appointmentValid
            : decisionValid))
    )
      return;
    const ticket = ++epoch.current;
    write.current ??=
      kind === "request"
        ? {
            kind,
            path,
            body: {
              key: crypto.randomUUID(),
              policyId: context.policy.id,
              acceptanceId: context.acceptance.head.id,
              previousId: previous || null,
              custodyRef: custody.trim(),
              reason: reason.trim(),
            },
          }
        : kind === "appointment"
          ? {
              kind,
              path: base + "/mapping-authority",
              body: {
                key: crypto.randomUUID(),
                subjectId: subject,
                policyId:
                  action === "revoked" ? target.policy_id : context.policy.id,
                acceptanceId:
                  action === "revoked"
                    ? target.acceptance_id
                    : context.acceptance.head.id,
                expectedRevision: target?.revision ?? 0,
                action,
                reference: appointmentRef.trim(),
                reason: appointmentReason.trim(),
              },
            }
          : {
              kind,
              path: base + "/mapping-requests/" + selected + "/decisions",
              body: {
                key: crypto.randomUUID(),
                expectedRevision: detail.state.head?.revision ?? 0,
                appointmentId: detail.ownAuthority.head.id,
                outcome,
                reference: reference.trim(),
                reason: decisionReason.trim(),
                examined: true,
              },
            };
    const saved = write.current;
    setBusy(true);
    setPending(true);
    onPending(true);
    setError("");
    setNotice("");
    try {
      const v = await api(saved.path, saved.body);
      if (live.current && epoch.current === ticket) {
        setNotice(
          (v.replayed ? "Recovered existing receipt. " : "Recorded. ") +
            (kind === "request"
              ? "Bound mapping request " + v.mappingRequest.id
              : kind === "appointment"
                ? "Mapping appointment revision " + v.appointment.revision
                : "Independent mapping decision revision " +
                  v.decision.revision) +
            ". Application is disabled; original business facts remain unchanged.",
        );
        write.current = null;
        setPending(false);
        onPending(false);
        if (kind === "request") {
          setSelected(v.mappingRequest.id);
          setCustody("");
          setReason("");
          setPrevious("");
        } else if (kind === "appointment") {
          setAppointmentRef("");
          setAppointmentReason("");
        } else {
          setReference("");
          setDecisionReason("");
          setExamined(false);
        }
        setCursor(null);
        setDecisionCursor(null);
        setAuthorityCursor(null);
        setAttempt((n) => n + 1);
      }
    } catch (e) {
      if (live.current && epoch.current === ticket) {
        const uncertain = !(e instanceof RequestFailure) || e.status >= 500;
        if (!uncertain) {
          write.current = null;
          setPending(false);
          onPending(false);
        }
        setError(
          (e as Error).message +
            (uncertain
              ? " Retry unchanged submission to recover a possibly committed receipt. Fields and navigation are locked."
              : " Refresh mapping workflow, inspect current bindings and authority, and correct your draft. Changed evidence requires a returned request and a new linked submission."),
        );
      }
    } finally {
      if (live.current && epoch.current === ticket) setBusy(false);
    }
  }
  const locked = loading || busy || pending || overlayPending || !!readError;
  useEffect(() => {
    onPending(busy || pending || overlayPending);
  }, [busy, pending, overlayPending]);
  const buttonDisabled = (
    kind: "request" | "appointment" | "decision",
    valid: any,
  ) =>
    busy ||
    overlayPending ||
    loading ||
    !!readError ||
    (pending ? write.current?.kind !== kind : !valid);
  return (
    <section
      aria-label="Governed mapping requests"
      style={{ overflowWrap: "anywhere", minWidth: 0 }}
    >
      <h4>Bound mapping requests and independent decisions</h4>
      <ol>
        <li>
          Resolve policy acceptance, source/custody, current independent
          observations and every work-company row. Task links continue in their
          existing guarded workflow.
        </li>
        <li>
          Submit a request bound to the exact current snapshot and controlled
          custody reference. Correct returned or withdrawn work through a new
          linked submission.
        </li>
        <li>
          A separately appointed, independent person examines the bound
          identities and records return, rejection or approval. Approval does
          not execute an overlay, change history or establish a production
          quorum.
        </li>
      </ol>
      <button
        disabled={loading || busy || pending || overlayPending}
        onClick={() => {
          setCursor(null);
          setDecisionCursor(null);
          setAuthorityCursor(null);
          setAttempt((n) => n + 1);
        }}
      >
        Refresh mapping workflow
      </button>
      {loading && (
        <p role="status">Loading mapping request bindings and authority…</p>
      )}
      {readError && <p role="alert">{readError}</p>}
      {context && list && (
        <>
          <p>
            Policy version {context.policy?.revision ?? "None"} ·{" "}
            {context.acceptance?.current
              ? "Recorded external acceptance current"
              : "Current external acceptance required"}
            . Decision recording alone: Application disabled. Separate request
            execution authorization is required.
          </p>
          {context.binding ? (
            <>
              <p>
                {context.binding.records.length} proposed rows · Source bytes{" "}
                {context.binding.sourceMatches ? "match" : "do not match"} ·{" "}
                {context.binding.estateActive
                  ? "Estate active"
                  : "Estate inactive"}{" "}
                · Current corroboration{" "}
                {context.binding.observationTotals.authorizedCorroborated} ·
                Concerns {context.binding.observationTotals.concerns} ·
                Insufficient {context.binding.observationTotals.insufficient} ·
                Reviewer access changed{" "}
                {context.binding.observationTotals.authorizationChanged}.
              </p>
              <p>
                {context.binding.eligible
                  ? "Current checks allow a separate request submission."
                  : "Submission blocked. Resolve policy, source, work-company row and current reviewer findings, then refresh. No positive statement cancels a concern."}
              </p>
            </>
          ) : (
            <p>
              Record a current external decision for a policy version in Policy
              authority and external decisions above, then refresh.
            </p>
          )}
          {context.binding && (
            <details>
              <summary>View current submission row findings</summary>
              {context.binding.records.map((r: any, i: number) => (
                <article key={i} data-mapping-row-finding={i}>
                  <strong>
                    Row {r.sourceRow} · {r.kind} ·{" "}
                    {r.valid ? "Row checks valid" : "Row blocked"}
                  </strong>
                  <p>
                    Record {r.recordId} · Proposed version {r.recordVersion} ·
                    Current version {r.currentVersion ?? "Unavailable"} · Target{" "}
                    {r.targetName ?? "Unavailable"} / {r.targetId}
                  </p>
                  {r.kind !== "work-company" ? (
                    <p>Use the existing task-link workflow for this row.</p>
                  ) : (
                    <>
                      {r.currentVersion == null && (
                        <p>The record is unavailable in this estate.</p>
                      )}
                      {r.currentVersion != null &&
                        r.currentVersion !== r.recordVersion && (
                          <p>
                            The record version changed; save a corrected
                            manifest.
                          </p>
                        )}
                      {r.recordedCompany && (
                        <p>
                          Company attribution is already recorded and remains
                          unchanged.
                        </p>
                      )}
                      {!r.targetName && (
                        <p>
                          The company target is unavailable in this customer
                          scope.
                        </p>
                      )}
                    </>
                  )}
                </article>
              ))}
              {(new Set(context.binding.records.map((r: any) => r.recordId))
                .size !== context.binding.records.length ||
                new Set(context.binding.records.map((r: any) => r.sourceRow))
                  .size !== context.binding.records.length) && (
                <p>
                  Duplicate record or source-row references block the complete
                  request. Save a corrected manifest.
                </p>
              )}
            </details>
          )}
          <form
            aria-label="Submit bound mapping request"
            onSubmit={(e) => {
              e.preventDefault();
              void submit("request");
            }}
          >
            <fieldset disabled={locked || !context.binding?.eligible}>
              <label>
                Mapping custody reference
                <input
                  aria-label="Mapping custody reference"
                  minLength={3}
                  maxLength={240}
                  required
                  value={custody}
                  onChange={(e) => setCustody(e.target.value)}
                />
              </label>
              <label>
                Mapping request reason
                <textarea
                  aria-label="Mapping request reason"
                  minLength={3}
                  maxLength={500}
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <label>
                Previous returned or withdrawn request (optional)
                <input
                  aria-label="Previous returned or withdrawn request"
                  maxLength={36}
                  value={previous}
                  onChange={(e) => setPrevious(e.target.value.toLowerCase())}
                />
              </label>
            </fieldset>
            <button disabled={buttonDisabled("request", requestValid)}>
              Submit bound mapping request
            </button>
          </form>
          {list.items.map((r: any) => (
            <article key={r.id} data-mapping-request={r.id}>
              <strong>Submitted request {r.id}</strong>
              <p>
                {r.reason} · {r.custody_ref} · {r.created_at}
              </p>
              <button
                disabled={locked}
                onClick={() => {
                  setSelected(r.id);
                  setDecisionCursor(null);
                  setReference("");
                  setDecisionReason("");
                  setExamined(false);
                }}
              >
                Inspect mapping request {r.id}
              </button>
            </article>
          ))}
          <button
            disabled={locked || !list.nextCursor}
            onClick={() => setCursor(list.nextCursor)}
          >
            Next mapping requests
          </button>
        </>
      )}
      {context && authority && candidates && (
        <section aria-label="Mapping decision appointments">
          <h5>Explicit mapping decision appointments</h5>
          <p>
            This grants decision recording only for an exact policy and external
            acceptance. Self appointment is denied. Production staffing/quorum
            and application remain separate.
          </p>
          <label>
            Search mapping recorder
            <input
              aria-label="Search mapping recorder"
              disabled={locked}
              maxLength={100}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <button
            disabled={locked}
            onClick={() => {
              setQuery(search.trim());
              setCandidateCursor(null);
              setAttempt((n) => n + 1);
            }}
          >
            Find mapping recorder
          </button>
          {candidates.items.map((c: any) => (
            <button
              key={c.id}
              disabled={locked || c.id === context.actorId}
              onClick={() => {
                setSubject(c.id);
                setAuthorityCursor(null);
              }}
            >
              Select mapping recorder {c.name} {c.id}
            </button>
          ))}
          <button
            disabled={locked || !candidates.nextCursor}
            onClick={() => setCandidateCursor(candidates.nextCursor)}
          >
            Next mapping recorder candidates
          </button>
          <p>
            Selected person {subject || "None"} · Appointment revision{" "}
            {target?.revision ?? 0} ·{" "}
            {authority.state?.effective
              ? "Approval recording authority current"
              : authority.state?.recordingAllowed
                ? "Negative decision recording only — policy changed"
                : "No current recording authority"}
          </p>
          <form
            aria-label="Record mapping appointment"
            onSubmit={(e) => {
              e.preventDefault();
              void submit("appointment");
            }}
          >
            <fieldset disabled={locked || !subject}>
              <label>
                Mapping appointment action
                <select
                  aria-label="Mapping appointment action"
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                >
                  <option value="appointed">Appoint decision recorder</option>
                  <option value="revoked">Revoke appointment</option>
                </select>
              </label>
              <label>
                Mapping appointment reference
                <input
                  aria-label="Mapping appointment reference"
                  required
                  minLength={3}
                  maxLength={240}
                  value={appointmentRef}
                  onChange={(e) => setAppointmentRef(e.target.value)}
                />
              </label>
              <label>
                Mapping appointment reason
                <textarea
                  aria-label="Mapping appointment reason"
                  required
                  minLength={3}
                  maxLength={500}
                  value={appointmentReason}
                  onChange={(e) => setAppointmentReason(e.target.value)}
                />
              </label>
            </fieldset>
            <button disabled={buttonDisabled("appointment", appointmentValid)}>
              Record mapping appointment
            </button>
          </form>
          {authority.items.map((a: any) => (
            <article key={a.id} data-mapping-appointment={a.id}>
              <strong>
                {a.action} · Mapping appointment revision {a.revision}
              </strong>
              <p>
                {a.subject_id} · {a.reason}
              </p>
              <button
                disabled={locked}
                onClick={() => {
                  setSubject(a.subject_id);
                  setAuthorityCursor(null);
                }}
              >
                Inspect mapping appointment subject {a.subject_id}
              </button>
              <details>
                <summary>View detailed mapping appointment</summary>
                <p>
                  Appointment {a.id} · Previous{" "}
                  {a.previous_id ?? "First appointment"} · Actor {a.actor_id} ·
                  Policy {a.policy_id} · Acceptance {a.acceptance_id}
                </p>
                <p>
                  {a.reference} · Support {a.request_id} · {a.created_at}
                </p>
              </details>
            </article>
          ))}
          <button
            disabled={locked || !authority.nextCursor}
            onClick={() => setAuthorityCursor(authority.nextCursor)}
          >
            Next mapping appointment history
          </button>
        </section>
      )}
      {detail && decisions && (
        <section aria-label="Selected mapping decision">
          <h5>Request {detail.mappingRequest.id}</h5>
          <button disabled={locked} onClick={() => setShowExecution((v) => !v)}>
            {showExecution
              ? "Close overlay execution and reconciliation"
              : "Open overlay execution and reconciliation"}
          </button>
          <p>
            Decision:{" "}
            {detail.state.head?.outcome ?? "Awaiting independent decision"} ·{" "}
            {detail.state.approvalCurrent
              ? "Recorded approval current"
              : "No current approval"}{" "}
            ·{" "}
            {detail.state.bindingUnchanged
              ? "Binding unchanged"
              : "Bound evidence or records changed"}
            . Decision recording alone: Application disabled. Separate request
            execution authorization is required.
          </p>
          <p>
            {detail.state.independent
              ? "Independent identity confirmed."
              : "The requester, manifest preparer, source uploader and bound provenance reviewers cannot decide this request."}{" "}
            {detail.ownAuthority.recordingAllowed
              ? "Check the exact appointment/policy binding before deciding."
              : "Ask a separate setup manager to appoint or renew your mapping recording authority, then refresh."}
          </p>
          <details>
            <summary>View bound mapping snapshot and provenance</summary>
            <p>
              Previous request{" "}
              {detail.mappingRequest.previous_id ?? "First submission"} ·
              Custody {detail.mappingRequest.custody_ref} · Reason{" "}
              {detail.mappingRequest.reason}
            </p>
            <p>
              Prepared by {detail.mappingRequest.created_by} · Support{" "}
              {detail.mappingRequest.request_id} · Snapshot SHA-256{" "}
              {detail.mappingRequest.snapshot_sha256}
            </p>
            <p>
              Policy {detail.mappingRequest.policy_id} · Acceptance{" "}
              {detail.mappingRequest.acceptance_id} · Manifest SHA-256{" "}
              {detail.mappingRequest.manifest_sha256}
            </p>
            {detail.mappingRequest.snapshot.records.map((r: any) => (
              <p key={r.sourceRow}>
                Row {r.sourceRow} · Record {r.recordId} · Version{" "}
                {r.currentVersion} · Target {r.targetName} / {r.targetId} ·{" "}
                {r.valid ? "Valid at submission" : "Blocked at submission"}
              </p>
            ))}
            <p>
              The immutable snapshot retains all{" "}
              {detail.mappingRequest.snapshot.observations.length} current
              reviewer identities/revisions. Source authenticity remains
              unverified. Read-only current inspection is not a reusable
              application permit.
            </p>
            {detail.mappingRequest.snapshot.observations
              .slice(0, 25)
              .map((o: any) => (
                <p key={o.id}>
                  Observation {o.id} · Reviewer {o.reviewerId} · Revision{" "}
                  {o.revision} · {o.outcome}
                </p>
              ))}
          </details>
          <button
            disabled={
              locked ||
              detail.mappingRequest.created_by !== detail.actorId ||
              !["returned", "withdrawn"].includes(detail.state.head?.outcome)
            }
            onClick={() => {
              setPrevious(detail.mappingRequest.id);
              setReason("");
            }}
          >
            Prepare linked mapping correction
          </button>
          <form
            aria-label="Record independent mapping decision"
            onSubmit={(e) => {
              e.preventDefault();
              void submit("decision");
            }}
          >
            <fieldset
              disabled={
                locked ||
                !detail.state.independent ||
                !detail.ownAuthority.recordingAllowed
              }
            >
              <label>
                Mapping decision outcome
                <select
                  aria-label="Mapping decision outcome"
                  value={outcome}
                  onChange={(e) => {
                    setOutcome(e.target.value);
                    setExamined(false);
                  }}
                >
                  <option value="returned">Return for linked correction</option>
                  <option value="rejected">Reject request</option>
                  <option value="approved">
                    Record approval — application disabled
                  </option>
                  <option value="withdrawn">Withdraw recorded approval</option>
                </select>
              </label>
              <label>
                Mapping decision reference
                <input
                  aria-label="Mapping decision reference"
                  required
                  minLength={3}
                  maxLength={240}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </label>
              <label>
                Mapping decision reason
                <textarea
                  aria-label="Mapping decision reason"
                  required
                  minLength={3}
                  maxLength={500}
                  value={decisionReason}
                  onChange={(e) => setDecisionReason(e.target.value)}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  aria-label="I examined the bound manifest custody and current observations"
                  checked={examined}
                  onChange={(e) => setExamined(e.target.checked)}
                />
                I examined the bound manifest, custody and current observations
              </label>
            </fieldset>
            <button disabled={buttonDisabled("decision", decisionValid)}>
              Record independent mapping decision
            </button>
          </form>
          {showExecution && (
            <OverlayExecution
              key={selected}
              path={base + "/mapping-requests/" + selected}
              api={api}
              disabled={loading || busy || pending || !!readError}
              onPending={setOverlayPending}
            />
          )}
          {decisions.items.map((d: any) => (
            <article key={d.id} data-mapping-decision={d.id}>
              <strong>
                {d.outcome} · Decision revision {d.revision}
              </strong>
              <p>
                {d.reason} · {d.reference} · {d.created_at}
              </p>
              <details>
                <summary>View detailed mapping decision</summary>
                <p>
                  Decision {d.id} · Previous {d.previous_id ?? "First decision"}{" "}
                  · Actor {d.actor_id} · Appointment {d.appointment_id}
                </p>
                <p>
                  Support {d.request_id} · Bound request {d.mapping_request_id}
                </p>
              </details>
            </article>
          ))}
          <button
            disabled={locked || !decisions.nextCursor}
            onClick={() => setDecisionCursor(decisions.nextCursor)}
          >
            Next mapping decision history
          </button>
        </section>
      )}
      {busy && <p role="status">Recording immutable mapping workflow audit…</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
