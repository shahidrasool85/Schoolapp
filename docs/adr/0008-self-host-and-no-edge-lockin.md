# ADR 0008: Self-hostable Linux deployment; avoid Edge lock-in

**Status:** Proposed  
**Date:** 2026-08-20

## Context

Production may run on the operator’s Linux/Plesk infrastructure. Early development may use Supabase or another cloud. Architectural choices must not assume Vercel Edge, serverless-only cron, or proprietary caches.

## Decision

- Target runtime: **Node.js long-running process** (`next start` and a worker).
- Reverse proxy: **nginx** (Plesk-native) or Traefik; TLS at the proxy.
- Background jobs: **Postgres-backed queue**, not a cloud-only scheduler as the sole option.
- Avoid: Edge-only middleware as a security boundary, Vercel KV, Vercel Blob, Neon-only features, Supabase Realtime as the only live-update path.
- Provide **Docker Compose** as the reference self-host topology.

## Alternatives considered

| Alternative | Why not as the architecture |
| --- | --- |
| Vercel-first | Conflicts with stated Plesk/Linux hosting |
| Kubernetes from day one | Unnecessary operations load |
| PHP/Plesk-native app | Conflicts with TypeScript/React/Expo direction |

## Consequences

- WebSockets/Realtime can be added later as an API feature if needed.
- Environment variables and secrets stay in the host (Plesk, Docker secrets), not in the client bundle.
- Next.js image optimisation and similar host-specific features must have a fallback (e.g. disable or use standard img).
