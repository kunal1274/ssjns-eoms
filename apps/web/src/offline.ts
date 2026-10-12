import type { Draft, Store } from "../../../packages/domain/sync";
const DATABASE = "eoms-device-drafts";
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DATABASE, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore("drafts", { keyPath: "id" });
      store.createIndex("owner", "ownerId");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("drafts", mode),
      req = action(tx.objectStore("drafts"));
    tx.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || Error("Device storage transaction aborted"));
    };
  });
}
export const draftStore: Store = {
  list: (owner) =>
    transaction("readonly", (s) => s.index("owner").getAll(owner)),
  put: async (draft) => {
    await transaction("readwrite", (s) => s.put(draft));
  },
  remove: async (id) => {
    await transaction("readwrite", (s) => s.delete(id));
  },
};
export async function enqueue(draft: Draft) {
  const existing = await transaction<Draft | undefined>("readonly", (s) =>
    s.get(draft.id),
  );
  if (existing) {
    if (
      existing.ownerId !== draft.ownerId ||
      existing.estateId !== draft.estateId ||
      JSON.stringify(existing.payload) !== JSON.stringify(draft.payload)
    )
      throw Error("Draft request identity already belongs to different input");
    return;
  }
  await transaction("readwrite", (s) => s.add(draft));
}
export async function clearDeviceDrafts() {
  await transaction("readwrite", (s) => s.clear());
}
export async function deviceDraftCount() {
  return transaction("readonly", (s) => s.count());
}
