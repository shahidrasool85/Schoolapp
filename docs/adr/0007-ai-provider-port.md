# ADR 0007: AI provider port and human approval

**Status:** Proposed  
**Date:** 2026-08-20

## Context

AI-generated activities are a differentiator (maths, English, science, quizzes, 11+ style practice). We must not lock to one vendor. Content must be age-appropriate; schools will want review before pupils see it. Pupil PII must not be leaked to model providers.

## Decision

- `packages/ai` defines **`AiLearningProvider`** (generate, moderate, optionally embed).
- Implementations: OpenAI, Anthropic, Azure OpenAI, Ollama/local, etc., selected per environment or per organisation.
- Every generation is stored (`provider`, `model`, prompt hash, output, actor, organisation) for audit.
- Activities have status **`draft → in_review → published | rejected`**. Default school setting: **auto-publish off**.
- Prompts use curriculum context (year group, subject, topic, difficulty), **not** pupil names or identifiers.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Call OpenAI from React Server Components | Lock-in, no audit, no mobile, PII risk |
| Fully automatic publish | Safeguarding and quality risk for Year 3–8 |
| Train on pupil work from day one | DPIA, Children’s Code profiling, vendor training policies |

## Consequences

- Personalised recommendation engines are a later phase on top of attempts data we already store.
- Cost controls (quotas per organisation) belong in the adapter gateway, not in each feature.
