import { useEffect, useRef, useState } from "react";
import { RequestFailure } from "./feedback";
type Api = (path: string, body?: unknown) => Promise<any>;
export function PolicyGovernance({
  path,
  policyId,
  api,
  blocked,
  onPending,
  onChanged,
}: {
  path: string;
  policyId: string | null;
  api: Api;
  blocked: boolean;
  onPending: (v: boolean) => void;
  onChanged: () => void;
}) {
  const authorityPath = path.replace(/\/policies$/, "/policy-authority");
  const [subject, setSubject] = useState(""),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [candidateCursor, setCandidateCursor] = useState<string | null>(null),
    [cursor, setCursor] = useState<string | null>(null),
    [decisionCursor, setDecisionCursor] = useState<string | null>(null),
    [attempt, setAttempt] = useState(0),
    [candidates, setCandidates] = useState<any>(null),
    [history, setHistory] = useState<any>(null),
    [acceptance, setAcceptance] = useState<any>(null),
    [loading, setLoading] = useState(true),
    [readError, setReadError] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(false),
    [action, setAction] = useState("appointed"),
    [authorityRef, setAuthorityRef] = useState(""),
    [authorityReason, setAuthorityReason] = useState(""),
    [outcome, setOutcome] = useState("changes-requested"),
    [externalRef, setExternalRef] = useState(""),
    [decisionReason, setDecisionReason] = useState(""),
    [attested, setAttested] = useState(false);
  const live = useRef(true),
    epoch = useRef(0),
    submission = useRef<{
      kind: "authority" | "acceptance";
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
    setAcceptance(null);
    setExternalRef("");
    setDecisionReason("");
    setAttested(false);
    setOutcome("changes-requested");
    setDecisionCursor(null);
  }, [policyId]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setReadError("");
    setCandidates(null);
    setHistory(null);
    setAcceptance(null);
    (async () => {
      const c = await api(
        authorityPath +
          "/candidates?q=" +
          encodeURIComponent(query) +
          "&limit=10" +
          (candidateCursor
            ? "&cursor=" + encodeURIComponent(candidateCursor)
            : ""),
      );
      const h = await api(
        authorityPath +
          "?limit=10" +
          (subject ? "&subjectId=" + subject : "") +
          (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
      );
      const a = policyId
        ? await api(
            path +
              "/" +
              policyId +
              "/acceptance?limit=10" +
              (decisionCursor
                ? "&cursor=" + encodeURIComponent(decisionCursor)
                : ""),
          )
        : null;
      if (active) {
        setCandidates(c);
        setHistory(h);
        setAcceptance(a);
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
    subject,
    query,
    candidateCursor,
    cursor,
    policyId,
    decisionCursor,
    attempt,
  ]);
  const target = history?.state,
    authorityValid =
      !!subject &&
      authorityRef.trim().length >= 3 &&
      authorityReason.trim().length >= 3 &&
      (action === "appointed"
        ? target?.eligible && subject !== history?.actorId
        : target?.current?.action === "appointed"),
    decisionEligible =
      acceptance?.canRecord &&
      (outcome === "withdrawn"
        ? acceptance.state.head?.outcome === "accepted-externally"
        : acceptance.state.isLatestPolicy &&
          (outcome !== "accepted-externally" ||
            acceptance.state.openDesignConcerns === 0)),
    acceptanceValid =
      decisionEligible &&
      attested &&
      externalRef.trim().length >= 3 &&
      decisionReason.trim().length >= 3;
  async function submit(kind: "authority" | "acceptance") {
    if (
      busy ||
      blocked ||
      loading ||
      readError ||
      (!submission.current &&
        !(kind === "authority" ? authorityValid : acceptanceValid))
    )
      return;
    const ticket = ++epoch.current;
    submission.current ??=
      kind === "authority"
        ? {
            kind,
            path: authorityPath,
            body: {
              key: crypto.randomUUID(),
              subjectId: subject,
              expectedRevision: target?.current?.revision ?? 0,
              action,
              authorityRef: authorityRef.trim(),
              reason: authorityReason.trim(),
            },
          }
        : {
            kind,
            path: path + "/" + policyId + "/acceptance",
            body: {
              key: crypto.randomUUID(),
              expectedRevision: acceptance.state.head?.revision ?? 0,
              policySha256: acceptance.policy.sha256,
              authorityId: acceptance.authority.current.id,
              outcome,
              externalRef: externalRef.trim(),
              reason: decisionReason.trim(),
              attested: true,
            },
          };
    const saved = submission.current;
    setBusy(true);
    setPending(true);
    onPending(true);
    setError("");
    setNotice("");
    try {
      const v = await api(saved.path, saved.body);
      if (live.current && ticket === epoch.current) {
        setNotice(
          (v.replayed ? "Recovered existing receipt. " : "Recorded. ") +
            (saved.kind === "authority"
              ? "Policy recording appointment revision " + v.authority.revision
              : "External policy decision revision " + v.acceptance.revision) +
            ". Mapping approval and application remain disabled.",
        );
        submission.current = null;
        setPending(false);
        onPending(false);
        setAuthorityRef("");
        setAuthorityReason("");
        setExternalRef("");
        setDecisionReason("");
        setAttested(false);
        setCursor(null);
        setDecisionCursor(null);
        setAttempt((n) => n + 1);
        onChanged();
      }
    } catch (e) {
      if (live.current && ticket === epoch.current) {
        const uncertain = !(e instanceof RequestFailure) || e.status >= 500;
        if (!uncertain) {
          submission.current = null;
          setPending(false);
          onPending(false);
        }
        setError(
          (e as Error).message +
            (uncertain
              ? " Retry unchanged submission to recover a possibly committed receipt; policy fields and navigation are locked."
              : " Refresh governance, inspect current appointment and decision revisions, and correct the draft before submitting again."),
        );
      }
    } finally {
      if (live.current && ticket === epoch.current) setBusy(false);
    }
  }
  const locked = loading || busy || pending || blocked || !!readError;
  const choose = (id: string) => {
    setSubject(id);
    setCursor(null);
    setAuthorityRef("");
    setAuthorityReason("");
  };
  return (
    <section
      aria-label="Policy authority and external decisions"
      style={{ overflowWrap: "anywhere", minWidth: 0 }}
    >
      <h4>Policy authority and external decisions</h4>
      <ol>
        <li>
          A setup manager identifies the separately appointed recorder and
          supplies the actual delegation reference and reason.
        </li>
        <li>
          Open an exact policy version. The appointed person checks the external
          owner/client decision and records its reference, outcome and
          attestation.
        </li>
        <li>
          Inspect the audit and current authority. Withdraw acceptance with a
          separate event; refresh after authority, policy or design-review
          changes.
        </li>
      </ol>
      <p>
        Appointment grants only external policy-decision recording in this
        estate. It does not grant mapping approval or application. References
        and attestations are human declarations; this app does not authenticate
        a signature, external authority or original evidence. No acceptance is
        preloaded.
      </p>
      <button
        disabled={loading || busy || pending || blocked}
        onClick={() => {
          setCursor(null);
          setDecisionCursor(null);
          setAttempt((n) => n + 1);
        }}
      >
        Refresh policy governance
      </button>
      {loading && (
        <p role="status">
          Loading policy appointments and external decision history…
        </p>
      )}
      {readError && <p role="alert">{readError}</p>}
      {candidates && history && (
        <section aria-label="Policy recording appointments">
          <h5>Appoint a policy decision recorder</h5>
          <label>
            Search policy recorder
            <input
              aria-label="Search policy recorder"
              maxLength={100}
              disabled={locked}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <button
            disabled={locked}
            onClick={() => {
              setCandidateCursor(null);
              setQuery(search.trim());
              setAttempt((n) => n + 1);
            }}
          >
            Find policy recorder
          </button>
          <p>
            Eligible scoped people: {candidates.items.length}. Self appointment
            is disabled. Search by name or exact user reference.
          </p>
          {candidates.items.map((c: any) => (
            <button
              key={c.id}
              disabled={locked || c.id === candidates.actorId}
              onClick={() => choose(c.id)}
            >
              Select policy recorder {c.name} {c.id}
            </button>
          ))}
          <button
            disabled={locked || !candidates.nextCursor}
            onClick={() => setCandidateCursor(candidates.nextCursor)}
          >
            Next policy recorder candidates
          </button>
          {subject && (
            <p data-policy-authority-state>
              Selected person {subject} · Current appointment revision{" "}
              {target?.current?.revision ?? 0} ·{" "}
              {target?.effective
                ? "Appointment current"
                : target?.current?.action === "revoked"
                  ? "Appointment revoked"
                  : target?.current
                    ? "Underlying access changed"
                    : "No appointment"}
            </p>
          )}
          <form
            aria-label="Record policy appointment"
            onSubmit={(e) => {
              e.preventDefault();
              void submit("authority");
            }}
          >
            <fieldset disabled={locked || !subject}>
              <label>
                Policy appointment action
                <select
                  aria-label="Policy appointment action"
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                >
                  <option value="appointed">Appoint recorder</option>
                  <option value="revoked">Revoke appointment</option>
                </select>
              </label>
              <label>
                Policy authority reference
                <input
                  aria-label="Policy authority reference"
                  required
                  minLength={3}
                  maxLength={240}
                  value={authorityRef}
                  onChange={(e) => setAuthorityRef(e.target.value)}
                />
              </label>
              <label>
                Policy authority reason
                <textarea
                  aria-label="Policy authority reason"
                  required
                  minLength={3}
                  maxLength={500}
                  value={authorityReason}
                  onChange={(e) => setAuthorityReason(e.target.value)}
                />
              </label>
            </fieldset>
            <button
              disabled={
                busy ||
                blocked ||
                loading ||
                !!readError ||
                (pending
                  ? submission.current?.kind !== "authority"
                  : !authorityValid)
              }
            >
              Record policy appointment
            </button>
          </form>
          {history.items.map((h: any) => (
            <article key={h.id} data-policy-authority={h.id}>
              <strong>
                {h.action} · Appointment revision {h.revision}
              </strong>
              <p>
                Person {h.subject_id} · {h.reason} · {h.created_at}
              </p>
              <button disabled={locked} onClick={() => choose(h.subject_id)}>
                Inspect appointment subject {h.subject_id}
              </button>
              <details>
                <summary>View detailed policy appointment</summary>
                <p>
                  Appointment {h.id} · Previous{" "}
                  {h.previous_id ?? "First appointment"} · Recorded by{" "}
                  {h.actor_id}
                </p>
                <p>
                  Authority reference {h.authority_ref} · Support reference{" "}
                  {h.request_id}
                </p>
              </details>
            </article>
          ))}
          <button
            disabled={locked || !history.nextCursor}
            onClick={() => setCursor(history.nextCursor)}
          >
            Next policy appointment history
          </button>
          <button
            disabled={locked || !subject}
            onClick={() => {
              setSubject("");
              setCursor(null);
            }}
          >
            Show all policy appointments
          </button>
        </section>
      )}
      {!policyId && (
        <p>
          Inspect a policy version above to record or view external decisions.
        </p>
      )}
      {acceptance && (
        <section aria-label="External policy decision">
          <h5>
            External decision for proposal version {acceptance.policy.revision}
          </h5>
          <p>
            Current decision revision {acceptance.state.head?.revision ?? 0} ·{" "}
            {acceptance.state.head?.outcome ?? "No recorded external decision"}{" "}
            ·{" "}
            {acceptance.state.current
              ? "Recorded acceptance current"
              : "No current acceptance"}
            . Mapping approval and application disabled.
          </p>
          <p>
            Open design concerns: {acceptance.state.openDesignConcerns}. Resolve
            current adverse design observations through linked reviews before
            recording acceptance. Superseded proposals cannot receive new
            decisions other than withdrawal of previously recorded acceptance.
          </p>
          <p>
            Your appointment:{" "}
            {acceptance.authority.effective
              ? "Current"
              : "Missing, revoked or underlying access changed"}
            .{" "}
            {acceptance.independent
              ? "Separate policy author confirmed."
              : "The policy author cannot record independent external decisions."}
          </p>
          <details>
            <summary>View acceptance authority and policy identity</summary>
            <p>
              Policy {acceptance.policy.id} · SHA-256 {acceptance.policy.sha256}
            </p>
            <p>
              Your appointment {acceptance.authority.current?.id ?? "None"} ·
              Acceptance authority current:{" "}
              {acceptance.state.authorityCurrent ? "Yes" : "No"}
            </p>
          </details>
          <form
            aria-label="Record external policy decision"
            onSubmit={(e) => {
              e.preventDefault();
              void submit("acceptance");
            }}
          >
            <fieldset disabled={locked || !acceptance.canRecord}>
              <label>
                External policy outcome
                <select
                  aria-label="External policy outcome"
                  value={outcome}
                  onChange={(e) => {
                    setOutcome(e.target.value);
                    setAttested(false);
                  }}
                >
                  <option value="changes-requested">
                    External changes requested
                  </option>
                  <option value="rejected">External rejection</option>
                  <option value="accepted-externally">
                    External acceptance recorded
                  </option>
                  <option value="withdrawn">
                    Withdraw recorded acceptance
                  </option>
                </select>
              </label>
              <label>
                External policy decision reference
                <input
                  aria-label="External policy decision reference"
                  required
                  minLength={3}
                  maxLength={240}
                  value={externalRef}
                  onChange={(e) => setExternalRef(e.target.value)}
                />
              </label>
              <label>
                External policy decision reason
                <textarea
                  aria-label="External policy decision reason"
                  required
                  minLength={3}
                  maxLength={500}
                  value={decisionReason}
                  onChange={(e) => setDecisionReason(e.target.value)}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  aria-label="I checked my appointment and the referenced external policy decision"
                  checked={attested}
                  onChange={(e) => setAttested(e.target.checked)}
                />
                I checked my appointment and the referenced external policy
                decision
              </label>
            </fieldset>
            <button
              disabled={
                busy ||
                blocked ||
                loading ||
                !!readError ||
                (pending
                  ? submission.current?.kind !== "acceptance"
                  : !acceptanceValid)
              }
            >
              Record external policy decision
            </button>
          </form>
          {acceptance.items.map((a: any) => (
            <article key={a.id} data-policy-acceptance={a.id}>
              <strong>
                {a.outcome} · Decision revision {a.revision} ·{" "}
                {a.id === acceptance.state.head?.id
                  ? "Latest recorded decision"
                  : "Earlier decision preserved"}
              </strong>
              <p>
                {a.external_ref} · {a.reason} · {a.created_at}
              </p>
              <details>
                <summary>View detailed external policy decision</summary>
                <p>
                  Decision {a.id} · Previous {a.previous_id ?? "First decision"}{" "}
                  · Actor {a.actor_id}
                </p>
                <p>
                  Policy {a.policy_id} · SHA-256 {a.policy_sha256} · Appointment{" "}
                  {a.authority_id}
                </p>
                <p>
                  Support reference {a.request_id} · Attestation recorded: Yes
                </p>
              </details>
            </article>
          ))}
          <button
            disabled={locked || !acceptance.nextCursor}
            onClick={() => setDecisionCursor(acceptance.nextCursor)}
          >
            Next external policy decisions
          </button>
        </section>
      )}
      {busy && <p role="status">Recording policy governance audit…</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
