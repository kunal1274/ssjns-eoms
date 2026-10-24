import { requestFailure, connectionFailure } from "./feedback";
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
    void load().catch(() =>
      setMessage(
        "Device storage could not be read. Check browser storage access before continuing; do not clear storage while drafts may be pending.",
      ),
    );
  }, [owner, revision]);
  async function sync() {
    setBusy(true);
    setMessage("");
    try {
      if (!navigator.locks) {
        setMessage(
          "This browser cannot safely coordinate syncing. Use a supported browser on this device; drafts are stored in this browser only.",
        );
        return;
      }
      await navigator.locks.request("eoms-device-sync", async () => {
        const session = await fetch("/api/auth/session", { cache: "no-store" });
        if (!session.ok) {
          const body = await session.json().catch(() => null);
          setMessage(
            (session.status === 401
              ? "Sign in again before syncing. Your drafts are retained.\n"
              : "Sync paused. Your drafts are retained.\n") +
              requestFailure(
                session.status,
                body,
                session.headers.get("X-Request-ID"),
              ),
          );
          return;
        }
        const identity = await session.json();
        if (identity.user.id !== owner) {
          setMessage(
            "Account changed. Reload before syncing. Drafts stay with their original account.",
          );
          return;
        }
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
          return {
            status: r.status,
            error: r.ok
              ? undefined
              : requestFailure(r.status, value, r.headers.get("X-Request-ID")),
          };
        });
        setMessage(
          `${result.saved} saved to server; ${result.blocked} need review.${result.stopped ? " Sync paused. Check connection or sign in again; pending drafts are retained.\n" + (result.message || connectionFailure) : ""}`,
        );
        await load();
        if (result.saved) await onSynced();
      });
    } catch {
      setMessage(
        "Sync or the queue refresh could not finish. Check the server register and device queue before retrying; acknowledged work may already be saved. Check browser storage access if the queue cannot be read.",
      );
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
      {message && (
        <p role="status" className="feedbacktext">
          {message}
        </p>
      )}
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
            {r.message && (
              <p role="alert" className="feedbacktext">
                {r.message}
              </p>
            )}
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
                    } catch {
                      setMessage(
                        "The device draft could not be prepared for retry. Check browser storage access and refresh the queue before continuing.",
                      );
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
                setBusy(true);
                try {
                  await navigator.locks.request("eoms-device-sync", () =>
                    draftStore.remove(r.id),
                  );
                  await load();
                  setMessage(
                    "Device draft discarded. Server records are unchanged.",
                  );
                } catch {
                  setMessage(
                    "Discard or queue refresh could not finish. Check the device queue before trying again.",
                  );
                } finally {
                  setBusy(false);
                }
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
