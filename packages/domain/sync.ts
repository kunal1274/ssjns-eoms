export type Draft = {
  id: string;
  ownerId: string;
  estateId: string;
  payload: Record<string, unknown>;
  status: "pending" | "blocked";
  message?: string;
  createdAt: string;
};
export type Store = {
  list: (owner: string) => Promise<Draft[]>;
  remove: (id: string) => Promise<void>;
  put: (draft: Draft) => Promise<void>;
};
export async function syncDrafts(
  owner: string,
  store: Store,
  send: (draft: Draft) => Promise<{ status: number; error?: string }>,
): Promise<{ saved: number; blocked: number; stopped: boolean }> {
  const result = { saved: 0, blocked: 0, stopped: false };
  for (const draft of await store.list(owner)) {
    if (draft.ownerId !== owner || draft.status !== "pending") continue;
    let response;
    try {
      response = await send(draft);
    } catch {
      result.stopped = true;
      break;
    }
    if (response.status === 201) {
      await store.remove(draft.id);
      result.saved++;
      continue;
    }
    if ([403, 409, 422].includes(response.status)) {
      await store.put({
        ...draft,
        status: "blocked",
        message: response.error || "Server validation requires review",
      });
      result.blocked++;
      continue;
    }
    result.stopped = true;
    break;
  }
  return result;
}
