# Schoolapp documentation

Architecture **accepted**. Phase 1 foundation, Phase 2 people/school structure, and Phase 3 parent/student portals are implemented. Later product modules are not built yet.

| Document | Contents |
| --- | --- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Full proposal: analysis, architecture, tenancy, auth, domain, API, lock-in, UK compliance, roadmap, risks |
| [adr/](./adr/README.md) | Architecture decision records |
| [domain-model.md](./domain-model.md) | Entities and lifecycles |
| [schema/001_foundation.sql](./schema/001_foundation.sql) | Reviewable foundation SQL (not applied) |
| [api/http-api.md](./api/http-api.md) | `/api/v1` conventions for web and future Expo |
| [compliance/uk-schools.md](./compliance/uk-schools.md) | GDPR, Children’s Code, safeguarding, hosting |
| [roadmap.md](./roadmap.md) | Phased delivery |
| [project-structure.md](./project-structure.md) | Intended monorepo |
| [permissions-catalogue.md](./permissions-catalogue.md) | Seed RBAC matrix |
| [placeholders.md](./placeholders.md) | Reserved entities (billing, flags, competitions governance, …) |

Please review [ARCHITECTURE.md](./ARCHITECTURE.md) first, then the ADRs you disagree with.
