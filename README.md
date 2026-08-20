# Schoolapp

Multi-tenant school management, LMS, and AI learning platform for UK schools (through approximately Year 8, including 11+ preparation).

**Current status:** architecture proposed for review. Product modules are not implemented yet.

Start here: **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)**

## Planned stack

- TypeScript, React, Next.js (web)
- PostgreSQL with Row Level Security
- Versioned HTTP API for web and future React Native / Expo apps
- Supabase (Auth/Postgres) as an optional adapter, not the public data plane
- Self-hostable on Linux (e.g. Plesk) via Node + Postgres + S3-compatible storage

Same accounts, permissions, and backend will serve parent, student, and staff mobile apps later. Those apps are **not** in the current phase.

## Documentation

- [Documentation index](./docs/README.md)
- [Roadmap](./docs/roadmap.md)
- [UK data protection notes](./docs/compliance/uk-schools.md)
