import { SearchSelect } from "./SearchSelect";
import { useEffect, useState } from "react";
type Api = (path: string, body?: unknown) => Promise<any>;
type Block = {
  id: string;
  kind: string;
  code: string;
  name: string;
  active: boolean;
};
function useBlocks(base: string, api: Api, exactCode?: string) {
  const [blocks, setBlocks] = useState<Block[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [truncated, setTruncated] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api(
      "/navigation" +
        base +
        "/units?kind=block&status=active&limit=25" +
        (exactCode ? "&exactCode=" + encodeURIComponent(exactCode) : ""),
    )
      .then((data) => {
        if (active) {
          setBlocks(
            data.items.filter(
              (row: Block) => row.kind === "block" && row.active,
            ),
          );
          setTruncated(!!data.nextCursor);
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
  }, [base, attempt, exactCode]);
  return {
    blocks,
    loading,
    error,
    truncated,
    retry: () => setAttempt((value) => value + 1),
  };
}
export function TaskBlockFields({
  base,
  api,
  onReady,
}: {
  base: string;
  api: Api;
  onReady: (ready: boolean) => void;
}) {
  const { blocks, loading, error, truncated, retry } = useBlocks(base, api);
  const [mode, setMode] = useState(""),
    [block, setBlock] = useState(""),
    [ready, setReady] = useState(false);
  const selectedMode = mode || (blocks.length ? "configured" : "legacy");
  useEffect(() => {
    onReady(!loading && !error && (selectedMode !== "configured" || ready));
  }, [loading, error, onReady, selectedMode, ready]);
  return (
    <fieldset>
      <legend>1. Choose the task's block</legend>
      <p>
        Configure blocks in Organization → Hierarchy setup. Select a block here
        to keep a stable link; the task retains its recorded block code if that
        block is later renamed.
      </p>
      {loading && <p role="status">Loading configured blocks…</p>}
      {error && (
        <p role="alert">
          {error}{" "}
          <button type="button" onClick={retry}>
            Retry block list
          </button>
        </p>
      )}
      {truncated && (
        <p>
          More configured blocks are available. Search or load more choices
          below.
        </p>
      )}
      {!loading && !error && (
        <>
          <label>
            Block source
            <select
              aria-label="Block source"
              value={selectedMode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="configured">Configured block</option>
              <option value="legacy">Legacy code — unlinked</option>
            </select>
          </label>
          {selectedMode === "configured" ? (
            <>
              <SearchSelect
                api={api}
                path={"/navigation" + base + "/units?kind=block&status=active"}
                label="Configured block"
                name="blockId"
                value={block}
                onChange={setBlock}
                seed={blocks}
                required
                placeholder="Choose a block in this estate"
                onReady={setReady}
              />
              {!blocks.length && (
                <p>
                  No configured blocks are available. Open hierarchy setup, or
                  explicitly use a legacy unlinked code.
                </p>
              )}
              <label>
                Block link reason
                <textarea
                  name="linkReason"
                  required
                  minLength={3}
                  maxLength={500}
                />
              </label>
            </>
          ) : (
            <>
              <p>
                This compatibility path records text only. It does not establish
                a verified hierarchy relationship. A manager can review and link
                it later.
              </p>
              <label>
                Block code
                <input name="block" required maxLength={100} />
              </label>
            </>
          )}
        </>
      )}
    </fieldset>
  );
}
export function TaskBlockLink({
  base,
  api,
  task,
  onSaved,
  onCancel,
}: {
  base: string;
  api: Api;
  task: { id: string; block_code: string; task_code: string; version: number };
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const {
    blocks,
    loading,
    error: listError,
    truncated,
    retry,
  } = useBlocks(base, api, task.block_code);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [committed, setCommitted] = useState(false),
    [block, setBlock] = useState(""),
    [ready, setReady] = useState(false);
  const matches = blocks.filter((block) => block.code === task.block_code);
  async function refreshSaved() {
    setBusy(true);
    setError("");
    try {
      await onSaved();
    } catch (e) {
      setError(
        "Link saved, but refreshing failed. Refresh saved task before any further action. " +
          (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="editor"
      aria-label="Review legacy block link"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        void (async () => {
          setBusy(true);
          setError("");
          let saved = false;
          try {
            await api(`${base}/occurrences/${task.id}/block-link`, {
              blockId: form.get("blockId"),
              version: task.version,
              reason: form.get("reason"),
            });
            saved = true;
            setCommitted(true);
            await onSaved();
          } catch (e) {
            setError(
              (saved
                ? "Link saved, but refreshing failed. Refresh saved task before any further action. "
                : "") + (e as Error).message,
            );
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <h3>Review legacy block link</h3>
      <p>
        {task.task_code} · recorded block {task.block_code} · version{" "}
        {task.version}. Linking keeps the task ID, capacity and existing work
        unchanged. This reference cannot be reassigned or removed after saving.
      </p>
      {loading && <p role="status">Loading matching blocks…</p>}
      {listError && (
        <p role="alert">
          {listError}{" "}
          <button type="button" onClick={retry}>
            Retry matching blocks
          </button>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {truncated && (
        <p>
          Search or load more matching choices below; the exact recorded code
          remains required.
        </p>
      )}
      {!loading && !listError && !matches.length && (
        <p>
          No configured block exactly matches this recorded code in this estate.
          Configure or review the matching block before linking.
        </p>
      )}
      <fieldset disabled={busy || committed}>
        <SearchSelect
          api={api}
          path={
            "/navigation" +
            base +
            "/units?kind=block&status=active&exactCode=" +
            encodeURIComponent(task.block_code)
          }
          label="Matching configured block"
          name="blockId"
          value={block}
          onChange={setBlock}
          seed={matches}
          required
          disabled={busy || committed}
          placeholder="Choose the reviewed block"
          onReady={setReady}
        />
        <label>
          Link review reason
          <textarea name="reason" required minLength={3} maxLength={500} />
        </label>
        <button disabled={loading || !!listError || !block || !ready}>
          Confirm block link
        </button>
      </fieldset>
      {committed && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void refreshSaved()}
        >
          Refresh saved task
        </button>
      )}
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={onCancel}
      >
        Close link review
      </button>
    </form>
  );
}
