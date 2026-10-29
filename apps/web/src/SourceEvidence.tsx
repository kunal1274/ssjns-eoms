import { MappingRequests } from "./MappingRequests";
import { MappingReadiness } from "./MappingReadiness";
import { SourceReview } from "./SourceReview";
import { useEffect, useRef, useState } from "react";
import { RequestFailure } from "./feedback";
const MAX_BYTES = 2 * 1024 * 1024;
type Api = (path: string, body?: unknown) => Promise<any>;
export function SourceEvidence({
  path,
  api,
  onPending,
}: {
  path: string;
  api: Api;
  onPending: (pending: boolean) => void;
}) {
  const [fileName, setFileName] = useState(""),
    [content, setContent] = useState(""),
    [reason, setReason] = useState(""),
    [reading, setReading] = useState(false),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(false),
    [reviewPending, setReviewPending] = useState(false),
    [selectedReview, setSelectedReview] = useState<string | null>(null),
    [selectedMapping, setSelectedMapping] = useState<string | null>(null),
    [selectedReadiness, setSelectedReadiness] = useState<string | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [checks, setChecks] = useState<any[]>([]),
    [next, setNext] = useState<string | null>(null),
    [cursor, setCursor] = useState<string | null>(null),
    [refresh, setRefresh] = useState(0),
    [loading, setLoading] = useState(true),
    [listError, setListError] = useState("");
  const live = useRef(true),
    generation = useRef(0),
    input = useRef<HTMLInputElement>(null),
    payload = useRef<any>(null);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      generation.current++;
      onPending(false);
    };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setListError("");
    setChecks([]);
    setNext(null);
    api(
      path +
        "?limit=10" +
        (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
    )
      .then((v) => {
        if (active) {
          setChecks(v.items);
          setNext(v.nextCursor);
        }
      })
      .catch((e) => {
        if (active) setListError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, cursor, refresh]);
  async function select(file?: File) {
    const ticket = ++generation.current;
    setError("");
    setNotice("");
    setFileName("");
    setContent("");
    setReading(false);
    if (!file) return;
    if (file.size === 0 || file.size > MAX_BYTES) {
      setError(
        "Select a non-empty source file no larger than 2 MiB. No check was recorded.",
      );
      if (input.current) input.current.value = "";
      return;
    }
    setReading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let start = 0; start < bytes.length; start += 8192)
        binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
      if (live.current && ticket === generation.current) {
        setContent(btoa(binary));
        setFileName(file.name);
      }
    } catch {
      if (live.current && ticket === generation.current)
        setError("The source file could not be read. Select it again.");
    } finally {
      if (live.current && ticket === generation.current) setReading(false);
    }
  }
  async function submit() {
    if (
      busy ||
      reviewPending ||
      reading ||
      !content ||
      reason.trim().length < 3
    )
      return;
    const ticket = ++generation.current;
    setBusy(true);
    setError("");
    setNotice("");
    payload.current ??= {
      key: crypto.randomUUID(),
      fileName,
      reason: reason.trim(),
      contentBase64: content,
    };
    setPending(true);
    onPending(true);
    try {
      const v = await api(path, payload.current);
      if (live.current && ticket === generation.current) {
        setNotice(
          (v.replayed
            ? "Source check recovered. "
            : "Source check recorded. ") +
            (v.check.matches_declared
              ? "File bytes match the saved declaration. Authenticity still requires independent review."
              : "File bytes do not match the saved declaration. Verify the original source and save a corrected manifest if needed."),
        );
        payload.current = null;
        setPending(false);
        onPending(false);
        setContent("");
        setFileName("");
        setReason("");
        if (input.current) input.current.value = "";
        setCursor(null);
        setRefresh((n) => n + 1);
      }
    } catch (e) {
      if (live.current && ticket === generation.current) {
        const uncertain = !(e instanceof RequestFailure) || e.status >= 500;
        if (!uncertain) {
          payload.current = null;
          setPending(false);
          onPending(false);
        }
        setError(
          (e as Error).message +
            (uncertain
              ? " Retry the same source check to recover a possibly committed result. The file and reason are locked until recovery."
              : " Correct the input and try again."),
        );
      }
    } finally {
      if (live.current && ticket === generation.current) setBusy(false);
    }
  }
  return (
    <section aria-label="Source file checks">
      <h5>Compare original source bytes</h5>
      <p>
        1. Select the source file referenced by this saved manifest (up to 2
        MiB). 2. Explain its provenance. 3. Compare its SHA-256 on the server. A
        match confirms byte identity only; it does not authenticate the source,
        validate its contents or authorize changes.
      </p>
      <p>
        File bytes are processed transiently and are not retained or served by
        this feature. Keep the original in your controlled document repository.
        The audit retains file name, size, digests, actor, reason and support
        reference. Closing this review discards an uncommitted upload; reopen
        recorded checks to recover a committed one.
      </p>
      <form
        aria-label="Check source evidence"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label>
          Original source file
          <input
            ref={input}
            type="file"
            aria-label="Original source file"
            disabled={busy || pending || reviewPending}
            onChange={(e) => void select(e.target.files?.[0])}
          />
        </label>
        {fileName && <p>Selected source: {fileName}</p>}
        <label>
          Source provenance reason
          <input
            aria-label="Source provenance reason"
            value={reason}
            required
            minLength={3}
            maxLength={500}
            disabled={busy || pending || reviewPending}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <button
          disabled={
            busy ||
            reviewPending ||
            reading ||
            !content ||
            reason.trim().length < 3
          }
        >
          Check source file digest
        </button>
      </form>
      {reading && <p role="status">Reading source bytes…</p>}
      {busy && <p role="status">Comparing source bytes…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Loading recorded source checks…</p>}
      {listError && <p role="alert">{listError}</p>}
      {!loading && !listError && !checks.length && (
        <p>
          No source checks on this page. Source authenticity remains unverified.
        </p>
      )}
      {checks.map((v) => (
        <article key={v.id} data-evidence-id={v.id} className="event">
          <div className="eventbody">
            <strong>
              {v.matches_declared
                ? "Digest matches declaration"
                : "Digest mismatch"}{" "}
              · {v.file_name}
            </strong>
            <p>
              {v.reason} · {v.created_at}
            </p>
            <p>Source authenticity: Unverified. No changes applied.</p>
            <button
              disabled={busy || pending || reviewPending}
              onClick={() => {
                setSelectedMapping(null);
                setSelectedReview(v.id);
              }}
            >
              Open provenance review {v.id}
            </button>
            <button
              disabled={loading || busy || reviewPending}
              onClick={() => {
                setSelectedReview(null);
                setSelectedMapping(v.id);
              }}
            >
              Open mapping requests {v.id}
            </button>
            <button
              disabled={busy || pending || reviewPending}
              onClick={() => setSelectedReadiness(v.id)}
            >
              Inspect mapping readiness {v.id}
            </button>
            <details>
              <summary>View detailed source check</summary>
              <dl>
                <dt>Check / action</dt>
                <dd>
                  {v.id} · {v.action}
                </dd>
                <dt>Byte length / actor / support reference</dt>
                <dd>
                  {v.byte_length} · {v.actor_id} · {v.request_id}
                </dd>
                <dt>Computed file SHA-256</dt>
                <dd style={{ overflowWrap: "anywhere" }}>
                  {v.computed_sha256}
                </dd>
                <dt>Saved declared source SHA-256</dt>
                <dd style={{ overflowWrap: "anywhere" }}>
                  {v.declared_sha256}
                </dd>
                <dt>Saved manifest SHA-256</dt>
                <dd style={{ overflowWrap: "anywhere" }}>
                  {v.manifest_sha256}
                </dd>
              </dl>
            </details>
          </div>
        </article>
      ))}
      {selectedMapping && (
        <MappingRequests
          key={selectedMapping}
          path={path + "/" + selectedMapping + "/mapping-requests"}
          api={api}
          onPending={(v) => {
            setReviewPending(v);
            onPending(v);
          }}
        />
      )}
      {selectedReadiness && (
        <MappingReadiness
          key={selectedReadiness}
          path={path + "/" + selectedReadiness + "/readiness"}
          api={api}
        />
      )}
      {selectedReview && (
        <SourceReview
          key={selectedReview}
          path={path + "/" + selectedReview + "/reviews"}
          api={api}
          onPending={(v) => {
            setReviewPending(v);
            onPending(v);
          }}
        />
      )}
      <button
        disabled={loading || busy || reviewPending}
        onClick={() => {
          setCursor(null);
          setRefresh((n) => n + 1);
        }}
      >
        Refresh source checks
      </button>
      <button
        disabled={loading || busy || reviewPending || !next}
        onClick={() => setCursor(next)}
      >
        Next source checks
      </button>
    </section>
  );
}
