# ADR 0008: Self-hostable Linux deployment; avoid Edge lock-in

**Status:** Accepted (amended 2026-08-20)  
**Date:** 2026-08-20

## Context

Production may run on the operator’s Linux/Plesk infrastructure. Early development may use Supabase or another cloud. Architectural choices must not assume Vercel Edge, serverless-only cron, proprietary caches, or a mandatory self-hosted object store.

## Decision

- Target runtime: **Node.js long-running process** (`next start` and a worker).
- Reverse proxy: **nginx** (Plesk-native) or Traefik; TLS at the proxy.
- Background jobs: **Postgres-backed queue**, not a cloud-only scheduler as the sole option.
- Avoid: Edge-only middleware as a security boundary, Vercel KV, Vercel Blob, Neon-only features, Supabase Realtime as the only live-update path.
- Provide **Docker Compose** as a *reference* topology for Postgres, web, and worker. Object storage is configured via the S3-compatible adapter (managed or self-hosted); Compose **may** include MinIO for local convenience but **must not** require it.
- UK/EU VM region is a **preferred deployment policy**, not an architectural hard-stop (see compliance doc).

## Alternatives considered

| Alternative | Why not as the architecture |
| --- | --- |
| Vercel-first | Conflicts with stated Plesk/Linux hosting |
| Kubernetes from day one | Unnecessary operations load |
| PHP/Plesk-native app | Conflicts with TypeScript/React/Expo direction |
| Mandatory MinIO sidecar | See ADR 0006 |

## Consequences

- WebSockets/Realtime can be added later as an API feature if needed.
- Environment variables and secrets stay in the host (Plesk, Docker secrets), not in the client bundle.
- Next.js image optimisation and similar host-specific features must have a fallback (e.g. disable or use standard img).
