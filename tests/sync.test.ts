import { test } from "node:test";
import assert from "node:assert/strict";
import { syncDrafts, type Draft, type Store } from "../packages/domain/sync.ts";
function fixture() {
  const rows: Draft[] = [
    {
      id: "stable-1",
      ownerId: "a",
      estateId: "estate-a",
      payload: { quantityHa: 1 },
      status: "pending",
      createdAt: "2026-09-30",
    },
    {
      id: "other-2",
      ownerId: "b",
      estateId: "estate-b",
      payload: { quantityHa: 2 },
      status: "pending",
      createdAt: "2026-09-30",
    },
  ];
  const store: Store = {
    list: async () => rows,
    remove: async (id) => {
      rows.splice(
        rows.findIndex((r) => r.id === id),
        1,
      );
    },
    put: async (d) => {
      rows[rows.findIndex((r) => r.id === d.id)] = d;
    },
  };
  return { rows, store };
}
test("sync submits only current account and removes only acknowledged draft", async () => {
  const { store, rows } = fixture();
  const sent: string[] = [];
  const result = await syncDrafts("a", store, async (d) => {
    sent.push(d.id);
    return { status: 201 };
  });
  assert.deepEqual(sent, ["stable-1"]);
  assert.deepEqual(result, { saved: 1, blocked: 0, stopped: false });
  assert.equal(rows[0].ownerId, "b");
});
test("lost response retains immutable key and payload for safe retry", async () => {
  const { store, rows } = fixture();
  const original = structuredClone(rows[0]);
  await syncDrafts("a", store, async () => {
    throw Error("Network lost");
  });
  assert.deepEqual(rows[0], original);
  const seen: Draft[] = [];
  await syncDrafts("a", store, async (d) => {
    seen.push(d);
    return { status: 201 };
  });
  assert.deepEqual(seen[0], original);
});
test("business conflicts are blocked; session and server failures retain pending draft", async () => {
  for (const status of [403, 409, 422]) {
    const { store, rows } = fixture();
    const r = await syncDrafts("a", store, async () => ({
      status,
      error: "Review required",
    }));
    assert.equal(r.blocked, 1);
    assert.equal(rows[0].status, "blocked");
    let called = false;
    await syncDrafts("a", store, async () => {
      called = true;
      return { status: 201 };
    });
    assert.equal(called, false);
  }
  for (const status of [401, 429, 500]) {
    const { store, rows } = fixture();
    const r = await syncDrafts("a", store, async () => ({ status }));
    assert.equal(r.stopped, true);
    assert.equal(rows[0].status, "pending");
  }
});
