# F04 — Shared Docker environment

Status: implementation prepared; clean container execution and retained-volume restart checks must pass before closure.

## Boundaries

This is the shared development/integration environment for the production implementation. It does not enable production startup, production passwords, OIDC, TLS or live enterprise posting. Node 24.x is used consistently by package metadata, CI and the Dockerfile; the image tag follows security patches in that line. Immutable image digest promotion and formal supply-chain gates belong to F05/release engineering.

Services: PostgreSQL 18, one-time migration, restricted-role API, web development server; explicit tools profile for synthetic seed, isolated database verification and HTTP smoke tests. Only loopback host ports 55432/4100/5174 are published. The web service proxies `/api` to the internal API. The browser uses `http://localhost:5174`, matching the Origin/CSRF contract.

The API/web run as the non-root image user. API and migration root filesystems are read-only with temporary storage. The API receives only its restricted connection URL; the web receives no database credentials. Administrative DB credentials are confined to migration/seed/verification tools. `.env`, generated accounts, Git metadata, dependencies and build output are excluded from the image context. Do not share `docker compose config` output: interpolation can expose local secrets.

## Clean setup

From the repository root with Node 24.x and Docker Compose v2 available:

```sh
node scripts/setup-env.mjs
docker compose up --build -d --wait api web
docker compose --profile tools run --rm seed
```

The generator preserves an existing `.env`; no fixed credentials are committed. Migrations run under an advisory lock after PostgreSQL health succeeds; the API starts only after successful migration. Synthetic seed is explicit, never part of an API restart. It creates development accounts and stores their credentials in the dedicated `eoms_local` volume.

Read those credentials locally only:

```sh
docker compose --profile tools run --rm --no-deps seed cat .local/dev-accounts.json
```

Open `http://localhost:5174`. Do not use a different host spelling without updating the accepted Origin contract. This environment has no source bind mount: rebuild after changes with `docker compose up --build -d --wait api web`. API/web share one repository/image and the application database. Node dependencies are installed from the lockfile during the image build.

## Verification and persistence

```sh
docker compose --profile tools run --rm verify
docker compose --profile tools run --rm smoke
docker compose down
docker compose up -d --wait api web
docker compose --profile tools run --rm smoke node scripts/docker-smoke.mjs verify
```

`verify` uses a separate `eoms_test` database and separate account volume. It joins the PostgreSQL network namespace so the existing test scripts retain their loopback-only destructive-test safeguard. It runs isolated migrations/seed, unit/sync/configuration tests, PostgreSQL/API integration tests and build. It does not relax the database role or tenant boundary.

`smoke` exercises the real web proxy, health, authentication, draft creation and duplicate-key replay using synthetic data. It stores only the created record reference, then verifies that record after container removal/recreation. The API/web do not mount the seed account volume. Failed smoke responses omit passwords, session cookies and payload dumps.

CI runs the existing PostgreSQL/browser/security checks followed by these container checks. A successful source/configuration test alone is not Docker execution evidence. Browser checks continue on the host CI harness; the container smoke is an HTTP journey, not a claim of browser/production UAT.

## Operations and recovery

- `docker compose ps` shows health and lifecycle status; web readiness calls the proxied API health route, which checks PostgreSQL connectivity.
- `docker compose logs --tail=100 api web migrate` diagnoses startup failures. Existing API error logging/redaction gaps remain assigned to F05/security hardening; this phase does not certify all logs as safe.
- `docker compose down` preserves database and account volumes. Do not add `--volumes` unless intentionally discarding this isolated development data after backup. Reset is destructive, never an automatic recovery action.
- Restart and rebuild do not rotate generated account passwords. Existing `.env` and volumes must remain together; do not regenerate secrets against a retained database. Back up both with appropriate access controls. Production encrypted backups/restore rehearsal remain a separate acceptance gate.
- A migration failure blocks application startup. Inspect its cause; do not edit an applied migration or delete volumes to conceal the failure. Add a forward migration after review.
- No schema changes are introduced by F04. Existing numbered migrations remain immutable.

## Acceptance evidence

- [x] Architecture/Node target accepted by project owner on 16 October 2026.
- [x] Compose/image, loopback bindings, credential separation, non-root execution and explicit seed behavior reviewed at source level.
- [x] Local clean dependency install, eight unit/sync/configuration tests and TypeScript/web/PWA build pass.
- [ ] Fresh CI clean Docker build, migration, API/web health and seed pass.
- [ ] Container isolated PostgreSQL/API tests and build pass.
- [ ] Login/draft/replay smoke passes through the container web proxy.
- [ ] Container removal/recreation retains the saved record and account credentials.

CI run URL and exact tested commit must be recorded before marking this phase Complete. Production release and F05 security/quality gates remain separate.
