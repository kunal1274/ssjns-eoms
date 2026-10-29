import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const text = (path: string) => readFileSync(path, "utf8");
test("Docker runtime and dependency metadata agree on Node 24 and lockfile installation", () => {
  const pkg = JSON.parse(text("package.json")),
    lock = JSON.parse(text("package-lock.json"));
  assert.equal(pkg.engines.node, ">=24.0.0 <25");
  assert.equal(lock.packages[""].engines.node, pkg.engines.node);
  assert.match(
    text("Dockerfile"),
    /FROM node:24-bookworm-slim@sha256:[a-f0-9]{64}/,
  );
  assert.match(text("Dockerfile"), /npm ci/);
  assert.match(text("Dockerfile"), /USER node/);
});
test("Docker secrets and local artifacts are excluded from the build context", () => {
  const ignore = text(".dockerignore").split("\n");
  for (const value of [".git", "node_modules", ".env", ".env.*", ".local"])
    assert.ok(ignore.includes(value));
  const compose = text("compose.yaml");
  const api = compose.slice(
    compose.indexOf("  api:"),
    compose.indexOf("  web:"),
  );
  const web = compose.slice(
    compose.indexOf("  web:"),
    compose.indexOf("  seed:"),
  );
  assert.doesNotMatch(
    api,
    /ADMIN_DATABASE_URL|POSTGRES_PASSWORD|APP_DB_PASSWORD:/,
  );
  assert.doesNotMatch(web, /DATABASE_URL|POSTGRES_PASSWORD/);
  assert.match(api, /127\.0\.0\.1:4100:4100/);
  assert.match(web, /127\.0\.0\.1:5174:5174/);
  assert.match(compose, /127\.0\.0\.1:55432:5432/);
});
test("startup requires successful migration and actual dependency health; seed is explicit", () => {
  const c = text("compose.yaml");
  assert.match(
    c,
    /migrate: \{\s*condition: service_completed_successfully\s*\}/,
  );
  assert.match(c, /api: \{\s*condition: service_healthy\s*\}/);
  assert.match(c, /profiles: \[tools\]/);
  assert.match(c, /eoms_pg:\/var\/lib\/postgresql/);
  const api = c.slice(c.indexOf("  api:"), c.indexOf("  web:"));
  assert.doesNotMatch(api, /db:seed/);
  assert.match(c, /network_mode: service:postgres/);
  assert.match(c, /NODE_ENV=production npm run build/);
  assert.match(
    text("apps/api/src/server.ts"),
    /Production deployment is gated/,
  );
});

test("PostgreSQL image identity is immutable and identical in CI and Compose", () => {
  const compose = text("compose.yaml").match(
    /postgres:18@sha256:[a-f0-9]{64}/,
  )?.[0];
  assert.ok(compose);
  assert.ok(text(".github/workflows/verify.yml").includes(compose));
});
