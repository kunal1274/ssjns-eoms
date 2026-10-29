import { useEffect, useRef, useState } from "react";
import { RequestFailure } from "./feedback";
type Api = (path: string, body?: unknown) => Promise<any>;
export function CustomerSetupAccess({
  api,
  customerId,
  actorId,
  onPending,
  disabled,
}: {
  api: Api;
  customerId: string;
  actorId: string;
  onPending: (v: boolean) => void;
  disabled: boolean;
}) {
  const [subject, setSubject] = useState(""),
    [state, setState] = useState<any>(null),
    [action, setAction] = useState("granted"),
    [reference, setReference] = useState(""),
    [reason, setReason] = useState(""),
    [attempt, setAttempt] = useState(0),
    [loading, setLoading] = useState(false),
    [readError, setReadError] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [receipt, setReceipt] = useState<any>(null),
    [notice, setNotice] = useState("");
  const live = useRef(true),
    write = useRef<any>(null),
    subjectValid = /^[a-fA-F0-9-]{36}$/.test(subject);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      onPending(false);
    };
  }, []);
  useEffect(() => {
    let active = true;
    setState(null);
    setReadError("");
    setLoading(false);
    if (subjectValid) {
      setLoading(true);
      api("/customers/" + customerId + "/setup-subject?subjectId=" + subject)
        .then((s) => {
          if (active) setState(s);
        })
        .catch((e) => {
          if (active) {
            setReadError(e.message);
            setReceipt(null);
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }
    return () => {
      active = false;
    };
  }, [customerId, subject, attempt]);
  const locked = disabled || loading || busy || pending || !!readError,
    valid =
      state &&
      subject !== actorId &&
      reference.trim().length >= 3 &&
      reason.trim().length >= 3 &&
      state.granted !== (action === "granted");
  async function save() {
    if (disabled || loading || busy || readError || (!write.current && !valid))
      return;
    write.current ??= {
      key: crypto.randomUUID(),
      customerId,
      subjectId: subject,
      action,
      expectedGranted: state.granted,
      reference: reference.trim(),
      reason: reason.trim(),
    };
    setBusy(true);
    setPending(true);
    onPending(true);
    setError("");
    setNotice("");
    try {
      const r = await api("/provisioning/setup-grant", write.current);
      if (live.current) {
        setReceipt(r.receipt);
        setNotice(
          (r.replayed ? "Recovered existing receipt. " : "Recorded. ") +
            "Customer setup " +
            r.receipt.result.action +
            ". Work access remains unchanged.",
        );
        write.current = null;
        setPending(false);
        onPending(false);
        setReference("");
        setReason("");
        setAttempt((n) => n + 1);
      }
    } catch (e) {
      if (live.current) {
        const uncertain = !(e instanceof RequestFailure) || e.status >= 500;
        if (!uncertain) {
          write.current = null;
          setPending(false);
          onPending(false);
        }
        if (e instanceof RequestFailure && [401, 403, 404].includes(e.status)) {
          setState(null);
          setReceipt(null);
          setReference("");
          setReason("");
        }
        setError(
          (e as Error).message +
            (uncertain
              ? " Retry unchanged submission to recover a possibly committed receipt. Fields and navigation are locked."
              : " Refresh setup recipient and inspect the current assignment before correcting the draft."),
        );
      }
    } finally {
      if (live.current) setBusy(false);
    }
  }
  return (
    <section
      aria-label="Customer setup access handover"
      style={{ overflowWrap: "anywhere" }}
    >
      <h4>Hand over customer setup access</h4>
      <p>
        Name an existing active user. This grants customer configuration
        metadata access; estate work membership is separate. Ask another
        administrator to change your own setup authority.
      </p>
      <label>
        Setup recipient ID
        <input
          aria-label="Setup recipient ID"
          disabled={locked}
          maxLength={36}
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value);
            setReceipt(null);
          }}
        />
      </label>
      <button
        disabled={disabled || loading || busy || pending}
        onClick={() => setAttempt((n) => n + 1)}
      >
        Refresh setup recipient
      </button>
      {loading && <p role="status">Checking named setup recipient…</p>}
      {readError && <p role="alert">{readError}</p>}
      {state && (
        <p data-setup-recipient>
          Recipient {subject} · Setup{" "}
          {state.granted ? "granted" : "not granted"} ·{" "}
          {subject === actorId
            ? "Self changes require another administrator"
            : "Separate recipient"}
        </p>
      )}
      <form
        aria-label="Change customer setup access"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={locked || !state || subject === actorId}>
          <label>
            Setup assignment action
            <select
              aria-label="Setup assignment action"
              value={action}
              onChange={(e) => setAction(e.target.value)}
            >
              <option value="granted">Grant customer setup only</option>
              <option value="revoked">Revoke customer setup only</option>
            </select>
          </label>
          <label>
            Setup authority reference
            <input
              aria-label="Setup authority reference"
              required
              minLength={3}
              maxLength={240}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </label>
          <label>
            Setup handover reason
            <textarea
              aria-label="Setup handover reason"
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
            disabled || loading || busy || !!readError || (!pending && !valid)
          }
        >
          Record setup access change
        </button>
      </form>
      {receipt && (
        <article data-setup-receipt={receipt.id}>
          <strong>
            {receipt.result.action} · {receipt.created_at}
          </strong>
          <p>{receipt.payload.reason}</p>
          <details>
            <summary>View detailed setup access receipt</summary>
            <p>
              Receipt {receipt.id} · Actor {receipt.actor_id} · Subject{" "}
              {receipt.result.subjectId} · Reference {receipt.payload.reference}{" "}
              · Support {receipt.request_id} · No work membership granted
            </p>
          </details>
        </article>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
