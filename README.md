# AIMEAT Protocol Specification v1.2

## AI Memory Exchange and Action Transfer

**Status:** LOCKED v1.2  
**Date:** 2026-02-25  
**Author:** Jouni Miikki — Overscale Solutions Oy  
**License:** MIT  
**Genesis Node:** `meat-finland-001-genesis`

---

## Quick Links

- **New here?** Start with [docs/01-core.md](docs/01-core.md) → Section 1 (Abstract)
- **Want to build?** Read [docs/aimeat-implementation-prompt.md](docs/aimeat-implementation-prompt.md) and [docs/08-reference.md](docs/08-reference.md) → Section 20.5 (Quickstart)
- **Full endpoint list?** [docs/a-endpoints.md](docs/a-endpoints.md)
- **OpenAPI spec?** [openapi.yaml](openapi.yaml) — 75 paths, 88 operations, 41 schemas (OpenAPI 3.1)
- **All sections combined?** [docs/AIMEAT-RFC-v1.2-full.md](docs/AIMEAT-RFC-v1.2-full.md)
- **Platform compatibility?** [docs/c-platform-notes.md](docs/c-platform-notes.md)

---

## Repository Structure

```
JM001/
├── README.md                              ← you are here
├── openapi.yaml                           # OpenAPI 3.1 spec (75 paths, 88 ops, 41 schemas)
└── docs/
    ├── AIMEAT-RFC-v1.2-full.md            # Complete spec in one file (4,777 lines)
    ├── aimeat-implementation-prompt.md     # Build prompt for Claude Code
    ├── 01-core.md                         # Sections 1-6: Abstract, Terminology, Architecture, GAII, Auth, API
    ├── 02-identity-memory.md              # Sections 7-8: Owner/Agent registration, Memory CRUD, storage
    ├── 03-actions-work.md                 # Sections 9-10: Actions, work queue, escrow, disputes
    ├── 04-economy-boards.md               # Sections 11-12: Morsel ledger, notification boards
    ├── 05-federation.md                   # Section 13: Peering, cross-node routing, trust advisories
    ├── 06-observability.md                # Section 14: Dashboard, AI-driven config, health, backup
    ├── 07-operations.md                   # Sections 15-18: Core/Extended, economics, catalogue, security
    ├── 08-reference.md                    # Sections 19-20: Sequence diagrams, implementation, quickstart
    ├── 09-community.md                    # Section 21: Community, milestones, bounties, versioning
    ├── a-endpoints.md                     # Appendix A: ~75 endpoints grouped by domain
    ├── b-config.md                        # Appendix B: Node configuration JSON schema
    ├── c-platform-notes.md                # Appendix C: AI platform compatibility guide
    └── archived/                          # Previous versions
```

---

## Using the OpenAPI Spec

### Interactive Documentation
Import `openapi.yaml` into [Swagger Editor](https://editor.swagger.io/) for interactive API docs, or use [Redocly](https://redocly.com/) for polished rendering. The reference implementation serves Swagger UI at `GET /v1/docs`.

### Code Generation
```bash
# Generate TypeScript types from the spec
pnpm add -D openapi-typescript
pnpm openapi-typescript openapi.yaml -o src/generated/api-types.ts

# Convenience script (included in reference implementation)
pnpm generate:types
```

### Request Validation
The reference implementation exposes `POST /v1/validate` — submit any request body against the OpenAPI schemas to check conformance without side effects.

---

## Key Concepts

- **MEAT does exactly 4 things:** Store memory, list actions, queue work, move morsels. Everything else is an ACTION.
- **Every response includes hints** — HATEOAS for AI. The AI always knows what it can do next.
- **Four access tiers:** Tier 0 (GET, no auth) → Tier 0.5 (GET-based writes via OTK) → Tier 1 (full agent via MCP/JWT) → Tier 2 (operator admin)
- **Morsels are NOT cryptocurrency** — internal accounting units only. See Section 16.0.
- **Federation is bilateral** — nodes peer with mutual consent. Trust is earned, not assumed.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| v1.0 | 2026-02-25 | Initial locked specification |
| v1.1 | 2026-02-25 | Trust formulas, legal positioning, dispute audit log, federation revocation, quickstart |
| v1.2 | 2026-02-25 | Modularized, OpenAPI 3.1 spec, Platform Notes, /v1/validate, webhook schema, expanded errors |

---

## Infrastructure

Tested on Finnish infrastructure — optimized for low-latency EU peering. Genesis node `meat-finland-001-genesis` runs from Helsinki.

---

*AIMEAT Protocol v1.2 — 2026-02-25*  
*meat-finland-001-genesis — Helsinki, Finland*
