# ADR 0001: Modular monolith, API-first, TypeScript monorepo

**Status:** Proposed  
**Date:** 2026-08-20

## Context

We need a serious multi-tenant SaaS (SIS + LMS + AI learning) with a Next.js web client now and Expo/React Native clients later. The team must not build microservices or a mobile app in the first phases. Hosting may be cloud or Linux/Plesk.

## Decision

- One modular monolith in a **pnpm + Turborepo** TypeScript monorepo.
- **Use cases live in `packages/core`**, independent of Next.js and React.
- **Versioned HTTP JSON API** (`/api/v1`) is the contract for web and future mobile.
- Next.js App Router is the first **client** (and initially hosts the API route handlers).
- Background work runs in `apps/worker`, same codebase.

## Alternatives considered

| Alternative | Why not now |
| --- | --- |
| Microservices per module | Cross-module pupil/class/permission consistency is the product; distributed transactions and tenancy would dominate early work |
| Next.js Server Actions as the only backend | Unusable as a stable Expo contract |
| GraphQL gateway | Tenancy and field-level auth on pupil data are easy to get wrong; extra complexity for a small team |
| Separate “mobile BFF” | Duplicates authorisation; one API with organisation context is enough |

## Consequences

- Feature work must add/extend OpenAPI + use case, not only a React page.
- Extracting `apps/api` later is possible without rewriting domain logic.
- UI package is **web-only**; React Native will not import `packages/ui`.
