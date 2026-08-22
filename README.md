# Schoolapp

Multi-tenant school management, LMS, and AI learning platform for UK schools (through approximately Year 8, including 11+ preparation).

**Current status:** Phase 6 attendance and student record is implemented on the Phase 1–5 foundation (tenancy, RBAC, RLS, people, school structure, parent/student portals, admissions, SaaS hostnames). LMS, AI, and mobile are not built yet.

Start here: **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)**

## Planned stack

- TypeScript, React, Next.js (web)
- PostgreSQL with Row Level Security
- Versioned HTTP API (`/api/v1`) for web and future React Native / Expo apps
- Auth behind an adapter (Phase 1: local Argon2id + JWT; GoTrue can replace it)
- Self-hostable on Linux (e.g. Plesk) via Node + Postgres + optional S3-compatible storage

## Local demo (browser testing)

After `pnpm install`, a non-developer can run:

```bash
pnpm demo:setup
pnpm demo:start
```

Then open http://localhost:3000 and the school URLs http://greenwood.localhost:3000 and http://oakacademy.localhost:3000. Logins, URLs, and what to click are in **[docs/demo.md](./docs/demo.md)**.

On Windows, install [Git for Windows](https://git-scm.com/) and start Docker Desktop first. `pnpm demo:setup` works from Git Bash, and from PowerShell it launches Git Bash when `bash.exe` is available. Docker Desktop is enough — you do not need a local PostgreSQL install. See the Windows notes in [docs/demo.md](./docs/demo.md).

`pnpm demo:reset` recreates the local `schoolapp` database and loads the same demo data again. This path will not run in production.

## Phase 1 — local setup

PostgreSQL 16 must be running (local install or `infra/docker-compose.yml`).

```bash
pnpm install
bash scripts/setup-db.sh
cp .env.example .env   # set AUTH_SECRET
pnpm db:migrate
pnpm db:seed-platform  # uses PLATFORM_ADMIN_* from the environment
pnpm test
pnpm typecheck
pnpm --filter @schoolapp/web dev
```

`pnpm test` runs API isolation tests against `schoolapp_api_test`, RLS catalog tests against `schoolapp_test`, and a Next.js smoke check (`/api/v1/health` and `/login`). `bash scripts/setup-db.sh` creates those databases.

Then:

- `GET http://127.0.0.1:3000/api/v1/health`
- `GET http://localhost:3000/api/v1/public/tenant` (platform context)
- `GET http://greenwood.localhost:3000/api/v1/public/tenant` after provisioning slug `greenwood`
- `POST /api/v1/auth/login` with the platform admin email/password
- `POST /api/v1/platform/organisations` to create a school (returns a one-time invitation token)
- `POST /api/v1/invitations/accept` then login as the school admin
- `GET /api/v1/me/memberships` then `GET /api/v1/me` with header `X-Organisation-Id` **on the platform host**, or visit `http://<slug>.localhost:3000` without spoofing another school's header

`X-Organisation-Id` is a **request**, not authority. On a school hostname it must match the resolved organisation. Memberships are revalidated in Postgres via `set_tenant_context`. See [ADR 0014](./docs/adr/0014-saas-hostname-tenancy.md) for slug rules, local `*.localhost` routing, trusted-proxy behaviour, and later wildcard DNS/TLS.

Production deployment will later require wildcard DNS similar to `*.<PLATFORM_DOMAIN>` and wildcard TLS. Do not hard-code the final domain.

## Documentation

- [Documentation index](./docs/README.md)
- [Roadmap](./docs/roadmap.md)
- [UK data protection notes](./docs/compliance/uk-schools.md)
- [Permission catalogue](./docs/permissions-catalogue.md)
