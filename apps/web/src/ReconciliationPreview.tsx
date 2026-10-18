import { useEffect, useRef, useState } from "react";
import { RequestFailure } from "./feedback";
type Api = (path: string, body?: unknown) => Promise<any>;
export function ReconciliationPreview({
  base,
  api,
}: {
  base: string;
  api: Api;
}) {
  const [allowed, setAllowed] = useState(false),
    [checking, setChecking] = useState(true),
    [attempt, setAttempt] = useState(0),
    [permissionError, setPermissionError] = useState(""),
    [draft, setDraft] = useState(""),
    [fileName, setFileName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<any>(null);
  const generation = useRef(0),
    alive = useRef(true),
    file = useRef<HTMLInputElement>(null);
  function clear() {
    generation.current++;
    setDraft("");
    setFileName("");
    setResult(null);
    setBusy(false);
    if (file.current) file.current.value = "";
  }
  useEffect(() => {
    alive.current = true;
    let live = true;
    setChecking(true);
    setPermissionError("");
    api(base + "/reconciliation/context")
      .then((v) => {
        if (live) {
          setAllowed(v.canPreview);
          if (!v.canPreview) clear();
        }
      })
      .catch((e) => {
        if (live) {
          setPermissionError(e.message);
          if (
            e instanceof RequestFailure &&
            [401, 403, 404].includes(e.status)
          ) {
            setAllowed(false);
            clear();
          }
        }
      })
      .finally(() => {
        if (live) setChecking(false);
      });
    return () => {
      live = false;
    };
  }, [base, attempt]);
  useEffect(
    () => () => {
      alive.current = false;
      generation.current++;
    },
    [],
  );
  async function preview() {
    if (!allowed || checking || permissionError || busy) return;
    const ticket = ++generation.current;
    setError("");
    setResult(null);
    let value: unknown;
    try {
      value = JSON.parse(draft);
    } catch {
      setError(
        "This is not valid JSON. Review the manifest format and try again. No records were changed.",
      );
      return;
    }
    setBusy(true);
    try {
      const v = await api(base + "/reconciliation/preview", value);
      if (alive.current && ticket === generation.current) setResult(v);
    } catch (e) {
      if (alive.current && ticket === generation.current) {
        if (e instanceof RequestFailure && [401, 403, 404].includes(e.status)) {
          setAllowed(false);
          clear();
        }
        setError((e as Error).message);
      }
    } finally {
      if (alive.current && ticket === generation.current) setBusy(false);
    }
  }
  return (
    <section className="editor" aria-label="Source mapping preview">
      <h4>Preview source mappings</h4>
      <ol>
        <li>
          Prepare a version 1 JSON manifest with source system, document
          reference, declared source SHA-256 and up to 50 mapping rows.
        </li>
        <li>
          Upload or paste it, then preview against current records and
          permissions.
        </li>
        <li>
          Resolve blocked rows and verify original source evidence with the
          migration owner. Preview does not approve or apply a mapping.
        </li>
      </ol>
      <p>
        The source hash is declared, not authenticated. This preview does not
        upload the original evidence document or save an approval/audit record.
        Historical facts remain unchanged.
      </p>
      <p>
        Use reviewed source mappings with explicit record and target IDs. Review
        task and historical record references show the record identities; the
        migration owner must supply verified target mappings. Replace every
        sample placeholder before previewing. Names alone are not matched
        automatically.
      </p>
      <details>
        <summary>View manifest format</summary>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {JSON.stringify(
            {
              version: 1,
              source: {
                system: "Legacy export",
                documentRef: "Reviewed document reference",
                sha256: "64 hexadecimal characters from the original source",
              },
              rows: [
                {
                  sourceRow: "Sheet1:2",
                  kind: "task-block or work-company",
                  recordId: "existing record UUID",
                  recordVersion: 1,
                  targetId: "explicit block or company UUID",
                  reason: "Reason and source review context",
                },
              ],
            },
            null,
            2,
          )}
        </pre>
        <p>
          task-block requires an exact matching active configured block in this
          estate. work-company requires a company in this customer and never
          rewrites the historical record. A manifest is limited to 50 rows and
          60 KB in this form. Revalidate before any separately governed write.
        </p>
      </details>
      <button
        type="button"
        disabled={busy || checking}
        onClick={() => {
          setResult(null);
          setAttempt((n) => n + 1);
        }}
      >
        Refresh mapping access
      </button>
      {checking && <p role="status">Checking mapping-review access…</p>}
      {permissionError && <p role="alert">{permissionError}</p>}
      {!checking && !permissionError && !allowed && (
        <p>
          Read-only access. Estate-manager and customer setup permissions are
          required to preview mappings.
        </p>
      )}
      <form
        aria-label="Mapping manifest preview"
        onSubmit={(e) => {
          e.preventDefault();
          void preview();
        }}
      >
        <fieldset disabled={!allowed || checking || !!permissionError || busy}>
          <label>
            Mapping manifest file
            <input
              ref={file}
              aria-label="Mapping manifest file"
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                const selected = e.target.files?.[0],
                  ticket = ++generation.current;
                setResult(null);
                setError("");
                setDraft("");
                setFileName("");
                if (!selected) return;
                if (selected.size > 60000) {
                  setError(
                    "Select a JSON manifest no larger than 60 KB. No records were changed.",
                  );
                  e.target.value = "";
                  return;
                }
                void selected
                  .text()
                  .then((text) => {
                    if (alive.current && ticket === generation.current) {
                      setDraft(text);
                      setFileName(selected.name);
                    }
                  })
                  .catch(() => {
                    if (alive.current && ticket === generation.current)
                      setError("The file could not be read. Select it again.");
                  });
              }}
            />
          </label>
          {fileName && <p>Loaded manifest: {fileName}</p>}
          <label>
            Mapping manifest JSON
            <textarea
              aria-label="Mapping manifest JSON"
              required
              maxLength={60000}
              value={draft}
              onChange={(e) => {
                generation.current++;
                setDraft(e.target.value);
                setFileName("");
                if (file.current) file.current.value = "";
                setResult(null);
                setError("");
              }}
            />
          </label>
          <button disabled={!draft.trim()}>Preview source mappings</button>
        </fieldset>
      </form>
      {busy && (
        <p role="status">
          Checking proposed mappings. No changes are being applied…
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {result && (
        <section aria-label="Reconciliation preview results">
          <p role="status">
            {result.summary.total} rows · {result.summary.blocked} blocked ·{" "}
            {result.summary.reviewRequired} require review. No changes applied.
          </p>
          <p>
            All unblocked rows still require source verification and a separate
            governed decision. This preview is not import authorization.
          </p>
          <details>
            <summary>View preview provenance</summary>
            <dl>
              <dt>Source system / document reference</dt>
              <dd>
                {result.source.system} · {result.source.documentRef}
              </dd>
              <dt>Declared source SHA-256 — not verified</dt>
              <dd style={{ overflowWrap: "anywhere" }}>
                {result.source.sha256}
              </dd>
              <dt>Validated manifest SHA-256</dt>
              <dd style={{ overflowWrap: "anywhere" }}>
                {result.manifestSha256}
              </dd>
              <dt>Actor / estate</dt>
              <dd>
                {result.actorId} · {result.estateId}
              </dd>
              <dt>Evaluated / support reference</dt>
              <dd>
                {result.evaluatedAt} · {result.requestId}
              </dd>
            </dl>
          </details>
          {result.rows.map((r: any, i: number) => (
            <article key={i} data-mapping-row={i} className="event">
              <div className="eventbody">
                <strong>
                  {r.sourceRow} · {r.kind} ·{" "}
                  {r.status === "blocked"
                    ? "Blocked"
                    : "Requires source review"}
                </strong>
                {r.issues.map((issue: any) => (
                  <p key={issue.code}>{issue.message}</p>
                ))}
                <p>{r.action}</p>
                <details>
                  <summary>View mapping details</summary>
                  <dl>
                    <dt>Record / proposed version</dt>
                    <dd>
                      {r.recordId} · {r.recordVersion}
                    </dd>
                    <dt>Current accessible record</dt>
                    <dd>
                      {r.current
                        ? `${r.current.label} · Version ${r.current.version}`
                        : "Not available in scope"}
                    </dd>
                    <dt>Proposed target</dt>
                    <dd>
                      {r.target
                        ? `${r.target.name} · ${r.target.id}`
                        : "Not available in scope"}
                    </dd>
                    <dt>Source review reason</dt>
                    <dd>{r.reason}</dd>
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
