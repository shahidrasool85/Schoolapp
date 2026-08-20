# Schoolapp

Multi-tenant school management, LMS, and AI learning platform for UK schools (through approximately Year 8, including 11+ preparation).

**Current status:** Phase 1 foundation is implemented (tenancy, auth, RBAC, RLS, audit, `/api/v1/me`). Admissions, LMS, AI, and mobile are not built yet.

Start here: **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)**

## Planned stack

- TypeScript, React, Next.js (web)
- PostgreSQL with Row Level Security
- Versioned HTTP API (`/api/v1`) for web and future React Native / Expo apps
- Auth behind an adapter (Phase 1: local Argon2id + JWT; GoTrue can replace it)
- Self-hostable on Linux (e.g. Plesk) via Node + Postgres + optional S3-compatible storage

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
- `POST /api/v1/auth/login` with the platform admin email/password
- `POST /api/v1/platform/organisations` to create a school (returns a one-time invitation token)
- `POST /api/v1/invitations/accept` then login as the school admin
- `GET /api/v1/me/memberships` then `GET /api/v1/me` with header `X-Organisation-Id`

`X-Organisation-Id` is a **request**, not authority. Memberships are revalidated in Postgres via `set_tenant_context`.

## Documentation

- [Documentation index](./docs/README.md)
- [Roadmap](./docs/roadmap.md)
- [UK data protection notes](./docs/compliance/uk-schools.md)
- [Permission catalogue](./docs/permissions-catalogue.md)
