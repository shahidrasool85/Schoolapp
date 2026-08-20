# UK school data protection and security

This is a **design influence** document, not legal advice. Before processing live pupil data, complete a DPIA and a processor/controller contract review with qualified counsel or a DPO.

Unchanged requirements: **DPIA** for high-risk processing, **controller/processor** analysis, **Children’s Code** consideration, **data minimisation**, and **high-privacy defaults**. UK/EU hosting is preferred policy, not a statutory “UK servers only” rule — see residency below.

## Roles

- **School (customer):** typically the **controller** of pupil and parent personal data.
- **Schoolapp operator:** typically the **processor** (and controller of platform account/billing data).
- Subprocessors (hosting, email, AI) must be listed and flow-down terms agreed.

## Statutes and codes that affect engineering

| Instrument | Why it affects the build |
| --- | --- |
| UK GDPR and Data Protection Act 2018 | Lawful basis, minimisation, security, rights, DPIA for high-risk processing (children, systematic monitoring, AI) |
| ICO Age Appropriate Design Code (“Children’s Code”) | Default settings must be high-privacy; profiling and nudge techniques restricted; parental tools; data minimisation for under-18s |
| Keeping Children Safe in Education (KCSIE) | Accountability, appropriate staff access, auditability; we are not a full safeguarding case system in v1 |
| Privacy and Electronic Communications Regulations | Consent for non-essential cookies and some notifications |
| Equality / accessibility expectations | Web (and later mobile) should meet WCAG 2.2 AA as a target |

Independent schools still handle children’s data to the same GDPR standard. Do not assume “private school” means lighter isolation.

## Data we should not collect in Phase 1

Special category or highly sensitive education fields:

- Ethnicity, religion, health/medical, SEN/EHCP detail, pupil premium / FSM, safeguarding case notes, court orders beyond a simple “restricted contact” flag if absolutely required later

When they are added: **separate tables**, dedicated permissions, extra **formal** audit, and DPIA updates. Do not shove them into `student_profiles.settings` JSON.

## Children’s Code — product defaults

| Setting | Default |
| --- | --- |
| Public pupil profiles | Off; no public internet profiles |
| Leaderboards | Off; school must enable; prefer class/house not global public |
| Personalised AI recommendations | Off until explicit school setting + DPIA |
| Student-to-student chat | Not offered in v1 |
| Location tracking | Not collected |
| Profiling for marketing | Forbidden |
| Geolocation / tracking SDKs in future mobile apps | Default off; no advertising SDKs |
| Auto-publish AI content | Off |

Gamification (streaks, points) is a **nudge**. Keep it school-configurable and avoid dark patterns (e.g. punishing absence with public shame boards).

## Auth and access

- MFA for Platform Super Admin, School Admin, Headteacher before production.
- Unique staff users; no shared “office” passwords.
- Parent sees only linked children in the selected school.
- Student sees only self.
- Break-glass support access: time-limited, audited, off by default (not in v1 UI).

## Tenancy and security of processing

- TLS everywhere.
- Encryption at rest on Postgres and object storage.
- RLS + application checks; FORCE RLS on suitable tenant tables; memberships revalidated every request (see architecture).
- Secrets in environment, never in git or mobile apps.
- Rate limits on login and student attempt endpoints.
- Dependency scanning and a plan for penetration testing before general availability.

## Data residency and international transfers

**UK/EU residency is a preferred deployment policy**, not an absolute requirement of UK GDPR. Schools and our own risk appetite may still choose UK/EU regions first.

UK GDPR **permits** international transfers when **appropriate safeguards** are in place (for example: adequacy regulations, the UK International Data Transfer Agreement / Addendum, Standard Contractual Clauses where applicable, plus transfer risk assessment). “The database must physically sit in the UK” is **not** what the law always demands; “we know where the data goes and we have a lawful transfer tool” is.

Engineering defaults:

- Prefer UK/EU regions for Postgres, object storage, and logs when it is practical.
- Treat AI providers, email, and error trackers as possible importers/exporters of personal data.
- Do not send pupil PII in prompts regardless of region.
- If a subprocessor is outside the UK/EU, record it, put safeguards in the DPA/subprocessor list, and minimise what is sent.
- Do not block a deployment solely because a managed S3-compatible bucket or auth vendor offers a non-UK region — escalate for transfer review instead.

## International transfers and AI

If an AI provider stores or processes prompts outside the UK/EU, that is a transfer and needs the same safeguards analysis. Options:

1. Do not send personal data in prompts (required regardless).
2. Prefer UK/EU regions (e.g. Azure OpenAI UK/EU) when available.
3. Self-hosted/Ollama for sensitive workloads.
4. Contracts (IDTA/Addendum/SCCs as applicable) if a transfer remains.

**Prompt rule:** year group, subject, topic, difficulty — not pupil name, UPN, or class lists.

## Retention and rights

- Education records often cannot be fully erased on demand; implement **export + anonymise + legal hold**, not unbounded hard delete.
- Subject access requests: export per organisation for a parent’s children / a pupil, in a portable JSON/CSV later.
- When a school leaves the platform: documented offboarding (export + deletion timetable).

## Logging and audit

These are **different** systems.

- **Application logs:** request ids, errors, timings. UUIDs, not emails or names. Rotated. Not used as the school’s evidence trail.
- **`audit_events`:** attributable actor, time, action, entity, organisation, **before/after** for mutations. Append-only for the application database role. Required for changes to student records, permissions, attendance, results, and reports (and pupil-facing settings/flags).
- Audit access itself is restricted (`audit.read`).
- Application log aggregators are not a substitute for `audit_events`.

## Hosting on Linux/Plesk

- Prefer a UK/EU VM region when the operator hosts; this is policy, not a statutory UK-only hosting mandate.
- Backups encrypted, tested restores, tenant-aware backup access.
- Separate production and development data; never use real pupil data in dev.
- WAF/rate limit at nginx.
- Object storage: any configured S3-compatible endpoint (managed or self-hosted). MinIO is not required.

## Accessibility and year groups

Year 3–8 pupils and parents on mobile devices need simple language, large tap targets (later Expo), and keyboard-accessible web. Architecture does not block this if the API returns structured data rather than screenshots of PDFs only.

## Safeguarding boundary

Schoolapp v1 is not a CPOMS replacement. Do not build free-text “concerns” that staff treat as the official safeguarding file unless a later module is specified with appropriate access control. Provide **audit and least privilege** so a future module can fit.
