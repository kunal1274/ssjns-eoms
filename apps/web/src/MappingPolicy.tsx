import { useEffect, useRef, useState } from "react";
import { RequestFailure } from "./feedback";
type Api = (path: string, body?: unknown) => Promise<any>;
const empty = {
  custodyCriteria: "",
  approverCriteria: "",
  evidenceCriteria: "",
};
const fields = {
  custodyCriteria: "Proposed custody criteria",
  approverCriteria: "Proposed independent approver criteria",
  evidenceCriteria: "Proposed evidence and concern resolution criteria",
};
export function MappingPolicy({ path, api }: { path: string; api: Api }) {
  const [list, setList] = useState<any>(null),
    [detail, setDetail] = useState<any>(null),
    [reviews, setReviews] = useState<any>(null),
    [selected, setSelected] = useState<string | null>(null),
    [cursor, setCursor] = useState<string | null>(null),
    [reviewCursor, setReviewCursor] = useState<string | null>(null),
    [attempt, setAttempt] = useState(0),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [readError, setReadError] = useState(""),
    [notice, setNotice] = useState(""),
    [content, setContent] = useState(empty),
    [reason, setReason] = useState(""),
    [outcome, setOutcome] = useState("changes-requested"),
    [reference, setReference] = useState(""),
    [reviewReason, setReviewReason] = useState("");
  const live = useRef(true),
    epoch = useRef(0),
    write = useRef<{
      path: string;
      body: any;
      kind: "proposal" | "review";
    } | null>(null);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      epoch.current++;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setReadError("");
    setList(null);
    setDetail(null);
    setReviews(null);
    (async () => {
      const l = await api(
        path +
          "?limit=10" +
          (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
      );
      const d = selected ? await api(path + "/" + selected) : null;
      const r = selected
        ? await api(
            path +
              "/" +
              selected +
              "/reviews?limit=10" +
              (reviewCursor
                ? "&cursor=" + encodeURIComponent(reviewCursor)
                : ""),
          )
        : null;
      if (active) {
        setList(l);
        setDetail(d);
        setReviews(r);
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
  }, [path, selected, cursor, reviewCursor, attempt]);
  const proposalValid =
    Object.values(content).every(
      (v) => v.trim().length >= 10 && v.trim().length <= 2000,
    ) && reason.trim().length >= 3;
  const reviewValid =
    reviews?.canReview &&
    reference.trim().length >= 3 &&
    reviewReason.trim().length >= 3;
  async function submit(kind: "proposal" | "review") {
    if (
      busy ||
      loading ||
      readError ||
      (!write.current && !(kind === "proposal" ? proposalValid : reviewValid))
    )
      return;
    const ticket = ++epoch.current;
    write.current ??=
      kind === "proposal"
        ? {
            kind,
            path,
            body: {
              key: crypto.randomUUID(),
              expectedRevision: list.latest?.revision ?? 0,
              reason: reason.trim(),
              content: {
                version: 1,
                basis: "mapping-policy-r0",
                scope: "design-review-only",
                ...Object.fromEntries(
                  Object.entries(content).map(([k, v]) => [k, v.trim()]),
                ),
              },
            },
          }
        : {
            kind,
            path: path + "/" + selected + "/reviews",
            body: {
              key: crypto.randomUUID(),
              expectedRevision: reviews.ownRevision,
              policySha256: detail.policy.sha256,
              outcome,
              reference: reference.trim(),
              reason: reviewReason.trim(),
            },
          };
    const submission = write.current;
    setBusy(true);
    setPending(true);
    setError("");
    setNotice("");
    try {
      const v = await api(submission.path, submission.body);
      if (live.current && epoch.current === ticket) {
        setNotice(
          (v.replayed ? "Recovered existing receipt. " : "Recorded. ") +
            (submission.kind === "proposal"
              ? "Policy proposal version " + v.policy.revision
              : "Policy review revision " + v.review.revision) +
            ". Design review only; business approval and application remain disabled.",
        );
        write.current = null;
        setPending(false);
        setCursor(null);
        setReviewCursor(null);
        if (submission.kind === "proposal") {
          setSelected(v.policy.id);
          setContent(empty);
          setReason("");
        } else {
          setReference("");
          setReviewReason("");
          setOutcome("changes-requested");
        }
        setAttempt((n) => n + 1);
      }
    } catch (e) {
      if (live.current && epoch.current === ticket) {
        const uncertain = !(e instanceof RequestFailure) || e.status >= 500;
        if (!uncertain) {
          write.current = null;
          setPending(false);
        }
        setError(
          (e as Error).message +
            (uncertain
              ? " Retry unchanged submission to recover a possibly committed receipt. Fields and navigation are locked."
              : " Refresh policy history, inspect the latest version and correct your draft before submitting again."),
        );
      }
    } finally {
      if (live.current && epoch.current === ticket) setBusy(false);
    }
  }
  const locked = busy || pending || loading || !!readError;
  return (
    <section
      aria-label="Mapping policy design review"
      style={{ overflowWrap: "anywhere", minWidth: 0 }}
    >
      <h4>Mapping policy design review</h4>
      <ol>
        <li>
          Write concrete custody, independent approver and evidence criteria for
          R0. Save a reasoned proposal version.
        </li>
        <li>
          A separate authorized estate manager with customer setup access
          reviews that exact version and digest.
        </li>
        <li>
          Inspect short and detailed history. Request changes, record a linked
          review correction, or copy criteria into a new proposal version.
        </li>
        <li>
          Obtain authoritative client/owner acceptance and implement governed
          decisions before enabling any application.
        </li>
      </ol>
      <p>
        These are recorded design proposals and individual review statements.
        Support for design is not client sign-off, source certification,
        production policy activation or mapping approval. Review counts do not
        imply a voting threshold; authority is checked when each statement is
        recorded.
      </p>
      <button
        disabled={busy || pending || loading}
        onClick={() => {
          setCursor(null);
          setReviewCursor(null);
          setAttempt((n) => n + 1);
        }}
      >
        Refresh policy history
      </button>
      {loading && (
        <p role="status">Loading policy access and version history…</p>
      )}
      {readError && <p role="alert">{readError}</p>}
      {list && (
        <>
          <p>
            Latest proposal version: {list.latest?.revision ?? "None"}. Approval
            and application disabled.
          </p>
          <details>
            <summary>View fixed R0 safeguards</summary>
            <ul>
              {list.guardrails.map((v: string) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
          </details>
          <form
            aria-label="Propose mapping policy"
            onSubmit={(e) => {
              e.preventDefault();
              void submit("proposal");
            }}
          >
            <fieldset disabled={locked}>
              {Object.entries(fields).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <textarea
                    aria-label={label}
                    required
                    minLength={10}
                    maxLength={2000}
                    value={content[key as keyof typeof empty]}
                    onChange={(e) =>
                      setContent((v) => ({ ...v, [key]: e.target.value }))
                    }
                  />
                </label>
              ))}
              <label>
                Policy proposal reason
                <textarea
                  aria-label="Policy proposal reason"
                  required
                  minLength={3}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            </fieldset>
            <button
              disabled={
                busy ||
                loading ||
                !!readError ||
                (pending ? write.current?.kind !== "proposal" : !proposalValid)
              }
            >
              Save policy proposal
            </button>
          </form>
          {list.items.map((p: any) => (
            <article key={p.id} data-policy-version={p.id}>
              <strong>Proposal version {p.revision}</strong>
              <p>
                {p.reason} · {p.created_at}
              </p>
              <button
                disabled={locked}
                onClick={() => {
                  setSelected(p.id);
                  setReviewCursor(null);
                  setReference("");
                  setReviewReason("");
                }}
              >
                Inspect policy version {p.revision}
              </button>
            </article>
          ))}
          <button
            disabled={locked || !list.nextCursor}
            onClick={() => setCursor(list.nextCursor)}
          >
            Next policy versions
          </button>
        </>
      )}
      {detail && reviews && (
        <section aria-label="Selected policy version">
          <h5>Selected proposal version {detail.policy.revision}</h5>
          <p>
            {detail.isLatest
              ? "Latest proposal"
              : "Superseded proposal — new reviews disabled"}
            . Proposal author cannot independently review their own version.
          </p>
          <dl>
            {Object.entries(fields).map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{detail.policy.content[key]}</dd>
              </div>
            ))}
          </dl>
          <details>
            <summary>View detailed policy provenance</summary>
            <p>
              Policy {detail.policy.id} · Previous{" "}
              {detail.policy.previous_id ?? "First version"} · Author{" "}
              {detail.policy.actor_id}
            </p>
            <p style={{ overflowWrap: "anywhere" }}>
              SHA-256 {detail.policy.sha256}
            </p>
            <p>
              Support reference {detail.policy.request_id} ·{" "}
              {detail.policy.reason}
            </p>
          </details>
          <button
            disabled={locked}
            onClick={() => {
              setContent({
                custodyCriteria: detail.policy.content.custodyCriteria,
                approverCriteria: detail.policy.content.approverCriteria,
                evidenceCriteria: detail.policy.content.evidenceCriteria,
              });
              setReason("");
            }}
          >
            Copy criteria into new proposal
          </button>
          <p>
            Your review revision: {reviews.ownRevision}. Current individual
            statements:{" "}
            {reviews.totals
              .map((t: any) => `${t.outcome}: ${t.count}`)
              .join(" · ") || "None"}
            . These counts do not activate policy.
          </p>
          <form
            aria-label="Review mapping policy"
            onSubmit={(e) => {
              e.preventDefault();
              void submit("review");
            }}
          >
            <fieldset disabled={locked || !reviews.canReview}>
              <label>
                Policy review outcome
                <select
                  aria-label="Policy review outcome"
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                >
                  <option value="changes-requested">Changes requested</option>
                  <option value="not-supported">Not supported</option>
                  <option value="support-for-design">
                    Support for design only
                  </option>
                </select>
              </label>
              <label>
                Policy review reference
                <input
                  aria-label="Policy review reference"
                  required
                  minLength={3}
                  maxLength={240}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </label>
              <label>
                Policy review reason
                <textarea
                  aria-label="Policy review reason"
                  required
                  minLength={3}
                  maxLength={500}
                  value={reviewReason}
                  onChange={(e) => setReviewReason(e.target.value)}
                />
              </label>
            </fieldset>
            <button
              disabled={
                busy ||
                loading ||
                !!readError ||
                (pending ? write.current?.kind !== "review" : !reviewValid)
              }
            >
              Record policy review
            </button>
          </form>
          {reviews.items.map((r: any) => (
            <article key={r.id} data-policy-review={r.id}>
              <strong>
                {r.outcome} · Review revision {r.revision} ·{" "}
                {r.is_current
                  ? "Current for this reviewer"
                  : "Superseded review"}
              </strong>
              <p>
                {r.reason} · {r.reference} · {r.created_at}
              </p>
              <details>
                <summary>View detailed policy review</summary>
                <p>
                  Review {r.id} · Previous {r.previous_id ?? "First review"} ·
                  Reviewer {r.actor_id}
                </p>
                <p style={{ overflowWrap: "anywhere" }}>
                  Policy {r.policy_id} · SHA-256 {r.policy_sha256}
                </p>
                <p>Support reference {r.request_id}</p>
              </details>
            </article>
          ))}
          <button
            disabled={locked || !reviews.nextCursor}
            onClick={() => setReviewCursor(reviews.nextCursor)}
          >
            Next policy reviews
          </button>
        </section>
      )}
      {busy && <p role="status">Recording policy history…</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
