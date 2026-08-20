# Intended monorepo structure

Nothing under `apps/` or `packages/` is created in Phase 0 except documentation. This is the layout Phase 1 should scaffold.

```text
schoolapp/
├── apps/
│   ├── web/                      # Next.js App Router (UI + /api/v1 handlers initially)
│   └── worker/                   # Job runner (AI, email, PDFs)
├── packages/
│   ├── domain/                   # Permission keys, branded IDs, enums
│   ├── core/                     # Use cases; import domain + ports only
│   ├── db/                       # Drizzle schema, migrations, RLS SQL
│   ├── api-contract/             # OpenAPI source of truth
│   ├── api-client/               # Typed HTTP client (web + future Expo)
│   ├── auth/                     # AuthPort + GoTrue adapter
│   ├── storage/                  # FilePort + S3 adapter
│   ├── notifications/            # Email (and later push) ports
│   ├── ai/                       # AiLearningProvider + adapters
│   └── ui/                       # Web components (not React Native)
├── supabase/                     # Optional local config; not used by core
├── infra/
│   ├── docker-compose.yml        # postgres, minio, web, worker
│   └── nginx/                    # Sample reverse proxy for Plesk/Linux
├── docs/                         # Architecture (this tree)
├── pnpm-workspace.yaml
├── turbo.json
└── README.md
```

## Import rules (enforce in ESLint in Phase 1)

| Package | May import |
| --- | --- |
| `domain` | nothing internal |
| `core` | `domain`, port *interfaces* |
| `db`, `auth`, `storage`, `ai` | `domain`, their driver SDKs |
| `api-client` | `api-contract` types |
| `apps/web` | `core`, `api-client`, `auth` adapter wiring, `ui` |
| `apps/worker` | `core`, adapters |
| Future `apps/mobile` | `api-client`, `domain` (types only) — **never** `ui`, `db`, or `core` server secrets |

## Web app route groups

```text
apps/web/app/
├── (public)/
├── (platform)/platform/
├── (school)/
├── (parent)/parent/
├── (student)/student/
└── api/v1/
```

## What not to add yet

- `apps/mobile` Expo project (Phase 10)
- Admissions/LMS/AI feature folders with empty barrels “for later”
- GraphQL server
- Kubernetes manifests
