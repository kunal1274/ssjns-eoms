import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const mode = process.argv[2];
if (!["create", "verify"].includes(mode))
  throw Error("Use create or verify. Synthetic development data only.");
const base = process.env.SMOKE_BASE_URL || "http://localhost:5174";
const accounts = JSON.parse(await readFile(".local/dev-accounts.json", "utf8"));
const account = accounts.find((a) => a.role === "manager");
if (!account) throw Error("Run the explicit synthetic seed first.");
let cookie = "",
  csrf = "";
async function call(path, method = "GET", body, extra = {}) {
  const r = await fetch(base + path, {
    method,
    signal: AbortSignal.timeout(10000),
    headers: {
      Cookie: cookie,
      Origin: "http://localhost:5174",
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (path === "/api/auth/login" && r.ok)
    cookie = r.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  if (!r.ok) throw Error(`Container smoke ${method} ${path}: HTTP ${r.status}`);
  return r.json();
}
const health = await call("/api/health");
assert.equal(health.service, "eoms-api");
const login = await call("/api/auth/login", "POST", {
  email: account.email,
  password: account.password,
});
csrf = login.csrf;
if (mode === "create") {
  const estates = await call("/api/estates");
  const estate = estates.find((e) => e.code === "SN");
  assert.ok(estate);
  const root = `/api/estates/${estate.id}`;
  const workers = await call(root + "/workers");
  const tasks = await call(root + "/occurrences");
  assert.ok(workers.length && tasks.length);
  const key = randomUUID();
  const body = {
    occurrenceId: tasks[0].id,
    businessDate: "2026-09-28",
    gangCode: "G-01",
    quantityHa: 0.01,
    workerIds: [workers[0].id],
  };
  const saved = await call(root + "/musters", "POST", body, {
    "Idempotency-Key": key,
  });
  assert.ok(saved.id);
  const replay = await call(root + "/musters", "POST", body, {
    "Idempotency-Key": key,
  });
  assert.equal(replay.id, saved.id);
  await writeFile(
    ".local/docker-smoke-record.json",
    JSON.stringify({ estateId: estate.id, id: saved.id }),
    { mode: 0o600 },
  );
  console.log(
    "Container proxy, database health, login, draft capture and duplicate replay passed.",
  );
} else {
  const saved = JSON.parse(
    await readFile(".local/docker-smoke-record.json", "utf8"),
  );
  const result = await call(
    `/api/estates/${saved.estateId}/musters/${saved.id}`,
  );
  assert.equal(result.id, saved.id);
  assert.equal(result.status, "draft");
  console.log(
    "Saved draft and development account survived container removal/recreation with retained volumes.",
  );
}
