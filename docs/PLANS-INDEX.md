# AIMEAT Plans & Design Documents — Index

**Last updated:** 2026-02-27

This file is the single source of truth for finding all planning documents. If it's not listed here, it doesn't exist.

---

## Active Plans (current thinking)

| # | Document | Covers | Status |
|---|---|---|---|
| 1 | [ghii-identity-and-network-plan.md](ghii-identity-and-network-plan.md) | **GHII** (human identity), **app upload**, **asset economy** (morsel-funded persistence), **network access points** (NAP directory), **easy node setup** (npm/Docker) | Design complete |
| 2 | [human-ai-onboarding-portal-plan.md](human-ai-onboarding-portal-plan.md) | Human portal for AI platform onboarding, 4-tier AI classification, prompt package generator | Design complete |
| 3 | [aimeat-appstore-plan.md](aimeat-appstore-plan.md) | Original app hosting/publishing design. **Partially superseded** by #1 (ZIP approach replaced by single HTML + separate assets) — security analysis still relevant | Superseded (security section still valid) |
| 4 | [aimeat-whats-in-it-for-you.md](aimeat-whats-in-it-for-you.md) | Multi-perspective value propositions (user, operator, mirror, agent dev, service maker), browser capabilities catalogue | Complete |

## Implementation Tracking

| # | Document | Covers |
|---|---|---|
| 5 | [implementation-plan-v1.2-compliance.md](implementation-plan-v1.2-compliance.md) | Original v1.2 compliance implementation plan |
| 6 | [implementation-plan-v1.2-compliance_v2.md](implementation-plan-v1.2-compliance_v2.md) | Updated v1.2 compliance (v2) |
| 7 | [remaining-gaps-implementation-plan.md](remaining-gaps-implementation-plan.md) | Gaps remaining after v1.2 compliance work |
| 8 | [gap-analysis-v1.2.md](gap-analysis-v1.2.md) | Spec-vs-implementation gap analysis |
| 9 | [audit-incomplete-items.md](audit-incomplete-items.md) | Audit of incomplete items |

## Reference / Analysis

| # | Document | Covers |
|---|---|---|
| 10 | [AIMEAT-RFC-v1.3-full.md](AIMEAT-RFC-v1.3-full.md) | Full RFC v1.3 specification |
| 11 | [AIMEAT-RFC-v1.2-full.md](AIMEAT-RFC-v1.2-full.md) | Full RFC v1.2 specification |
| 12 | [aimeat-implementation-prompt.md](aimeat-implementation-prompt.md) | Detailed implementation guidance for AI assistants |
| 13 | [developer-experience-and-agent-ecosystem-plan.md](developer-experience-and-agent-ecosystem-plan.md) | DX improvements and agent ecosystem |
| 14 | [core-vs-ecosystem-analysis.md](core-vs-ecosystem-analysis.md) | What's core vs ecosystem |
| 15 | [disruption-boundaries.md](disruption-boundaries.md) | Disruption scope analysis |
| 16 | [human-portal-layer-plan.md](human-portal-layer-plan.md) | Earlier portal layer plan (Finnish) |
| 17 | [action-onboarding-research.md](action-onboarding-research.md) | Action onboarding research |
| 18 | [c-platform-notes.md](c-platform-notes.md) | AI platform compatibility matrix |
| 19 | [b-config.md](b-config.md) | Node configuration schema |

## RFC Sections (spec)

| Doc | Topic |
|---|---|
| [01-core.md](01-core.md) | Core protocol |
| [02-identity-memory.md](02-identity-memory.md) | Identity & memory |
| [03-actions-work.md](03-actions-work.md) | Actions & work |
| [04-economy-boards.md](04-economy-boards.md) | Economy & boards |
| [05-federation.md](05-federation.md) | Federation |
| [06-observability.md](06-observability.md) | Observability |
| [07-operations.md](07-operations.md) | Operations |
| [08-reference.md](08-reference.md) | Reference |
| [09-community.md](09-community.md) | Community |
| [a-endpoints.md](a-endpoints.md) | Endpoint reference |

---

## Quick: Where does idea X go?

| Idea area | Goes in |
|---|---|
| Human identity (GHII, verification, eIDAS) | #1 |
| App creation, upload, serving | #1 (section 7) |
| Asset storage, morsel economy for assets | #1 (section 7B) |
| Network discovery, node registry | #1 (section 8) |
| Node setup, Docker, npm install | #1 (section 10) |
| AI platform onboarding, prompt packages | #2 |
| App security (CSP, sandbox, CSRF) | #3 (still valid) + #1 (section 13) |
| Value props, stakeholder perspectives | #4 |
| Implementation gaps, spec compliance | #5–#9 |
| New spec features, protocol changes | RFC sections or new RFC version |
