# Package Templating System — Generator ↔ Package Bridge

**Date:** 2026-03-17
**Status:** Analysis & Proposal Complete

---

## Summary

The AIMEAT Generator and Package/Template system are complementary but disconnected. The generator is the natural authoring tool that the package system currently lacks. This proposal bridges them so that:

- **Generator creates packages** — users package their generated services as reusable templates
- **Packages open in generator** — users edit packages using the same AI-assisted workflow
- **Updates flow naturally** — generator edits become new package versions with change tracking

**Key insight:** No backend changes are required. All bridging happens client-side using existing APIs.

---

## Documents

| # | Document | Purpose |
|---|----------|---------|
| 01 | [Current State Analysis](01-current-state-analysis.md) | Maps existing generator, package, and template systems; identifies the gap |
| 02 | [Architecture Proposal](02-architecture-proposal.md) | Defines the bidirectional bridge: packaging flow, import flow, update flow |
| 03 | [Implementation Plan](03-implementation-plan.md) | Step-by-step phases with code examples and effort estimates |
| 04 | [Data Model Changes](04-data-model-changes.md) | Generator metadata extensions, content normalization matrix, manifest format |
| 05 | [User Experience Flows](05-user-experience-flows.md) | End-to-end user journeys with UI mockups |
| 06 | [Risks & Considerations](06-risks-and-considerations.md) | Risks, open questions, out-of-scope items, success criteria |
| 07 | [Forking & Generator Context Preservation](07-forking-and-generator-context-preservation.md) | Why all generator metadata must travel in the package; forking flow; prompt context requirements |

---

## Critical Design Decision

**All generator context (description, blueprint with dataModel, interview spec, completed component results) must be stored in the package manifest.** Without this context, the generator's AI prompts degrade to generic instructions when editing a forked package. See [document 07](07-forking-and-generator-context-preservation.md) for the full analysis.

---

## Recommendation

Proceed with implementation in the order defined in [03-implementation-plan.md](03-implementation-plan.md):

1. **Phase 1:** Content normalization layer (~150 lines)
2. **Phase 2:** Package creation from generator with full context embedding (~200 lines)
3. **Phase 3:** Package update from generator (~140 lines)
4. **Phase 4:** Import package into generator with context reconstruction (~150 lines)
5. **Phase 5:** Publish to template gallery (~40 lines)
6. **Phase 6:** Forking support (~80 lines)
7. **Phase 7:** Testing (~300 lines)

**Total estimated new code:** ~1,060 lines of JavaScript + ~50 i18n keys

**No backend changes required.**
