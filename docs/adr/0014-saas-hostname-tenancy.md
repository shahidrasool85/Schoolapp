# ADR 0014: SaaS hostname tenancy (school subdomains)

**Status:** Accepted  
**Date:** 2026-08-20

## Context

Schoolapp is a multi-tenant SaaS. Production should serve:

```text
schoolapp-domain.com                 = platform / public entry
greenwood.schoolapp-domain.com       = Greenwood School
oakacademy.schoolapp-domain.com      = Oak Academy
```

Every school uses the **same codebase and shared-schema architecture**. Client `X-Organisation-Id` remains a hint, not authority. Organisation UUID and FORCE RLS remain the database identity and safety net.

We must not configure production DNS/TLS in this phase. The application must still be testable locally (`greenwood.localhost:3000`) and ready for later wildcard DNS.

## Decision

### Routing identity vs authority

- **Organisation UUID** is the canonical tenant identity (RLS, memberships, audit).
- **Slug** is the stable SaaS routing identity (`greenwood` → `greenwood.<PLATFORM_DOMAIN>`).
- **Hostname** selects which organisation a request is *for*. It is not a substitute for membership, guardianship, or student-self rules.
- **`X-Organisation-Id` is never authority.** On a school host it must match the hostname-resolved organisation or the request fails closed (`org_host_mismatch`). On the platform host it remains a requested context that is revalidated from the database.

### Slug rules

Slugs are globally unique, lowercase, DNS-safe ASCII labels (`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`, 2–63 characters). Punycode (`xn--`) and consecutive hyphens are rejected to reduce homograph risk.

Reserved names (including `www`, `app`, `api`, `admin`, `platform`, `login`, `auth`, `support`, `help`, `status`, `mail`, `email`, `smtp`, `cdn`, `assets`, `static`, `docs`, plus localhost/infrastructure names) cannot be school slugs. Changing a slug records the previous value in `organisation_slug_history` so another organisation cannot claim it.

### Hostname resolution (central)

A single API middleware classifies `Host` (and `X-Forwarded-Host` **only** when `TRUST_PROXY=true`):

| Host | Result |
| --- | --- |
| Platform apex, `www`, IP, `localhost`, reserved subdomain (`api`, `login`, …) | Platform context. School-scoped routes still require `X-Organisation-Id`. |
| `{slug}.{PLATFORM_DOMAIN}` for an **active** organisation | School context. Header if present must match. |
| Unknown / nested platform subdomain | Fail closed (`tenant_not_found`). Header cannot select a tenant. |
| Verified **and** active custom hostname | School context, same as subdomain. |
| Pending / unverified / inactive custom hostname | Does not resolve. |

Malformed hosts are rejected. Ports and hostname casing are normalised. The organisation UUID is then passed to existing `set_tenant_context` (transaction-local, membership revalidated).

### Root platform context

The apex host does not auto-select a school. It is the foundation for a future marketing homepage, school signup, platform login, school finder, and platform administration. This phase does not ship a marketing site or public self-registration.

### Onboarding

`provision_organisation` remains the transactional internal onboarding path (platform Super Admin only): organisation, unique slug, default settings, trial subscription placeholder, school-admin invitation, audit row. Public `POST /api/v1/public/signup` is explicitly disabled (`onboarding_public_disabled`) until email verification, anti-abuse, and billing exist.

### Custom domains (foundation only)

`organisation_hostnames` stores custom hostnames with organisation ownership, uniqueness **for verified and active rows**, verification status, activation flag, and a future DNS TXT token. Automated DNS/TLS provisioning is **not** implemented. Pending registrations do not globally squat a hostname: another school may also register it as pending. Only a platform administrator can activate a hostname, and activation fails if that hostname is already verified and active. Unverified rows never resolve.

### Trusted proxy

Default: **do not trust `X-Forwarded-Host`**. For future Plesk/nginx, set `TRUST_PROXY=true` only when the reverse proxy **overwrites** `X-Forwarded-Host` / `X-Forwarded-Proto` from the connection it terminated. Do not pass through client-supplied forwarded headers.

When `TRUST_PROXY=true`, forwarded hosts are honoured only if the immediate `Host` is a proxy terminator (IP, localhost, platform apex, or reserved label). A connection that already presents a school hostname cannot be overridden by `X-Forwarded-Host`.

### Local development

`PLATFORM_DOMAIN` defaults to `localhost`. Modern browsers resolve `*.localhost` to loopback, so `http://greenwood.localhost:3000` and `http://localhost:3000` share one Next.js process. Session cookies remain host-only (not `Domain=.localhost`) so school context cannot leak across subdomains. The same credentials work on each host because identity is global.

### Caching

API responses send `Cache-Control: private, no-store` and `Vary: Host, X-Organisation-Id, Authorization` so a shared cache cannot mix tenants.

### Deployment (later; not this phase)

Production will need:

1. `PLATFORM_DOMAIN` set to the real apex (do not hard-code it in code).
2. Wildcard DNS `*.<PLATFORM_DOMAIN>` pointing at the same application.
3. Wildcard (or per-host) TLS at the reverse proxy.
4. Proxy Host / `X-Forwarded-*` overwrite as above.
5. Optional later: parent-domain cookies for SSO across school hosts; DNS TXT verification for custom domains.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Separate deploy per school | Not SaaS; breaks shared identity and operations |
| Trust `X-Organisation-Id` on a school host | Cross-tenant header spoofing |
| Trust `X-Forwarded-Host` by default | Host-header attacks behind misconfigured proxies |
| Unicode/punycode slugs | Homograph impersonation of reserved or peer schools |
| Auto-activate custom domains | Takeover if DNS is not yet proven |
| Next.js Edge middleware as the tenancy boundary | Conflicts with ADR 0008; Node API middleware is authoritative |
| Public unrestricted school signup | Weakens onboarding/security until verification and anti-abuse exist |

## Consequences

- Mobile / platform-admin clients continue to use the apex or a reserved host (`api`) plus `X-Organisation-Id`.
- School web UIs on a subdomain must not carry another school's context. Multi-school users switch by visiting the other host.
- Isolation tests from Phases 1–4 remain a merge gate; Phase 5 adds hostname mismatch, reserved slugs, and custom-domain lookup tests.
