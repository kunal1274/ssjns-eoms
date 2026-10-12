import { useEffect, useState } from "react";
import { syncDrafts, type Draft } from "../../../packages/domain/sync";
import { draftStore } from "./offline";
export function SyncQueue({
  owner,
  estateNames,
  online,
  revision,
  onSynced,
}: {
  owner: string;
  estateNames: Record<string, string>;
  online: boolean;
  revision: number;
  onSynced: () => Promise<void>;
}) {
  const [rows, setRows] = useState<Draft[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function load() {
    setRows(await draftStore.list(owner));
  }
  useEffect(() => {
    void load().catch((e) =>
      setMessage("Device storage unavailable: " + e.message),
    );
  }, [owner, revision]);
  async function sync() {
    setBusy(true);
    setMessage("");
    try {
      if (!navigator.locks)
        throw Error(
          "This browser cannot safely coordinate syncing. Use a supported browser.",
        );
      await navigator.locks.request("eoms-device-sync", async () => {
        const session = await fetch("/api/auth/session", { cache: "no-store" });
        if (!session.ok)
          throw Error(
            "Sign in again before syncing. Your drafts are retained.",
          );
        const identity = await session.json();
        if (identity.user.id !== owner)
          throw Error("Account changed. Reload before syncing.");
        const result = await syncDrafts(owner, draftStore, async (draft) => {
          const r = await fetch(`/api/estates/${draft.estateId}/musters`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": identity.csrf,
              "Idempotency-Key": draft.id,
            },
            body: JSON.stringify(draft.payload),
          });
          const value = await r.json().catch(() => ({}));
          return { status: r.status, error: value.error };
        });
        setMessage(
          `${result.saved} saved to server; ${result.blocked} need review.${result.stopped ? " Sync paused. Check connection or sign in again; pending drafts are retained." : ""}`,
        );
        await load();
        if (result.saved) await onSynced();
      });
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <div className="cardtitle">
        <h2>Device drafts ({rows.length})</h2>
        <button
          disabled={
            busy || !online || !rows.some((r) => r.status === "pending")
          }
          onClick={() => void sync()}
        >
          Sync drafts
        </button>
      </div>
      <p>
        These drafts are stored on this browser only. Sync creates server
        drafts; confirmation is a separate online action.
      </p>
      <small>
        Sign out clears device drafts after a discard prompt. Browser storage
        can be removed by the browser or device owner.
      </small>
      {message && <p role="status">{message}</p>}
      {rows.map((r) => (
        <div className="event" key={r.id}>
          <div>
            <strong>
              {String(r.payload.businessDate)} · {String(r.payload.gangCode)} ·{" "}
              {String(r.payload.quantityHa)} Ha
            </strong>
            <small>
              {estateNames[r.estateId] || "Estate access requires review"} ·{" "}
              {r.status === "blocked" ? "Needs review" : "Pending sync"}
            </small>
            {r.message && <p role="alert">{r.message}</p>}
            <details>
              <summary>Sync reference</summary>
              <small>{r.id}</small>
            </details>
            {r.status === "blocked" && (
              <button
                className="secondary"
                disabled={busy || !online}
                onClick={() =>
                  void (async () => {
                    setBusy(true);
                    try {
                      await navigator.locks.request("eoms-device-sync", () =>
                        draftStore.put({
                          ...r,
                          status: "pending",
                          message: undefined,
                        }),
                      );
                      await load();
                      setMessage(
                        "Ready to retry. Sync will recheck permissions and current operational rules.",
                      );
                    } catch (e) {
                      setMessage((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  })()
                }
              >
                Retry after correction
              </button>
            )}
            <button
              className="secondary"
              disabled={busy}
              onClick={async () => {
                if (
                  !confirm(
                    "Discard this device draft? If an earlier response was lost, check the server register first.",
                  )
                )
                  return;
                await navigator.locks.request("eoms-device-sync", () =>
                  draftStore.remove(r.id),
                );
                await load();
              }}
            >
              Discard draft
            </button>
          </div>
        </div>
      ))}
      {!rows.length && <small>No pending drafts for this account.</small>}
    </section>
  );
}
