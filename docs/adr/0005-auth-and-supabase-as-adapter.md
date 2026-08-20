# ADR 0005: Authentication via adapter; Supabase/GoTrue optional

**Status:** Proposed  
**Date:** 2026-08-20

## Context

Web and mobile must share identities. We want secure sessions, invites, password reset, and later MFA. We may use Supabase in early hosting but also need a Linux self-host path without rewriting the product.

## Decision

- All auth operations go through **`packages/auth`**.
- v1 adapter: **Supabase Auth (GoTrue)** — cookies for browsers, PKCE/refresh for future Expo.
- JWT/session is translated into an **`Actor`** in our API; feature code does not call Supabase.
- Students may have **no email**; parent/school-managed recovery.
- MFA for privileged staff before production pupil data.

## Alternatives considered

| Alternative | Why not as the only option |
| --- | --- |
| Clerk / Auth0 as core | Strong lock-in; children’s education data and self-host story are weaker |
| NextAuth only | Browser-centric; extra work for Expo |
| Custom password tables in app code | Easy to get wrong; we still might do this later behind the same port |
| Mobile talks to PostgREST with anon key | Schema and policy become the public API; unacceptable for multi-tenant pupil data |

## Consequences

- Expo work is “implement PKCE against the same GoTrue (or successor)”, not “invent a second user store”.
- Switching to Better Auth / Keycloak is an adapter change plus token claim mapping.
