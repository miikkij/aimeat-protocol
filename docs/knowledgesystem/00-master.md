# Knowledge System — Master Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a complete Knowledge Packaging and Sharing system for AIMEAT that lets users refine raw ideas/research into structured, tagged, sharable knowledge packages with full transparency and consent control.

**Architecture:** The Knowledge System is built entirely on top of AIMEAT's existing Memory, Consent, Schema, and Catalogue primitives. Knowledge packages are memory records following a `packages/{uuid}/*` key convention. No new storage engines — only new repository interfaces, routes, UI tabs, and two AI prompt templates (human + agent). The system supports two user paths: agentless (copy prompt → AI chat → paste result) and agent-based (OpenClaw operates via API directly).

**Tech Stack:** Node.js/TypeScript backend (Express 5), Preact + HTM frontend (no build step), existing AIMEAT Storage interface, existing auth/consent/schema infrastructure.

**Research Document:** `docs/research/smart-knowledge-packaging-and-sharing.md`

---

## Phase Overview

| Phase | Name | Document | Dependencies | Focus |
|-------|------|----------|-------------|-------|
| 1 | Foundation | [01-foundation.md](01-foundation.md) | None | Storage types, schemas, memory linking, prompts, synthesis labeling |
| 2 | Knowledge Tab UI | [02-knowledge-tab.md](02-knowledge-tab.md) | Phase 1 | Profile tab, import box, prompt copy buttons, my knowledge list |
| 3 | Discovery and Sharing | [03-discovery-and-sharing.md](03-discovery-and-sharing.md) | Phase 1, 2 | Catalogue endpoint, clone, export, catalog UI, morsel pricing |
| 4 | Collaboration, Quality, Moderation | [04-collaboration-quality-moderation.md](04-collaboration-quality-moderation.md) | Phase 1, 2, 3 | Organisms, reputation, subscriptions, operator review, flagging |
| 5 | Federation and Semantics | [05-federation-and-semantics.md](05-federation-and-semantics.md) | Phase 1-4 | Cross-node catalog, JSON-LD, lineage graphs, remote subscriptions |

---

## Key Conventions

### Memory Key Patterns

| Pattern | Purpose |
|---------|---------|
| `packages/{uuid}/manifest` | Package manifest (metadata, entries list, sharing config) |
| `packages/{uuid}/{entry-name}` | Individual package entry (the actual content) |
| `links/{source-hash}/{target-hash}` | Memory link record (typed relationship) |
| `templates/knowledge-packager-human` | Human AI Chat prompt template |
| `templates/knowledge-packager-agent` | Agent/OpenClaw prompt template |

### New Files Created (All Phases)

**Backend:**
- `aimeat/src/storage/repositories/knowledge.repository.ts` — Repository interface
- `aimeat/src/routes/knowledge.ts` — Knowledge package API routes
- `aimeat/src/services/knowledge.ts` — Business logic (import, clone, export, linking)

**Frontend:**
- `aimeat/public/views/profile/knowledge-tab.js` — Knowledge tab component
- `aimeat/public/js/services/knowledge.js` — Frontend API service
- `aimeat/public/views/admin/knowledge-tab.js` — Admin moderation tab

**Schemas & Prompts:**
- `aimeat/src/schemas/knowledge-package.ts` — JSON Schema definitions for all content types
- `aimeat/src/prompts/knowledge-packager-human.ts` — Human prompt template (with placeholder substitution)
- `aimeat/src/prompts/knowledge-packager-agent.ts` — Agent prompt template (with placeholder substitution)

**Tests:**
- `aimeat/test/e2e-knowledge.ts` — E2E test suite for knowledge system

**Localization:**
- Keys added under `knowledge.*` in `aimeat/locales/en.json` and `aimeat/locales/fi.json`

**CSS:**
- Styles added to `aimeat/public/css/views/profile.css` under `kpkg-*` prefix

### Shared Data Types

All defined in `aimeat/src/storage/interface.ts`:

```typescript
// Knowledge package manifest (stored as MemoryRecord value)
interface KnowledgeManifest {
  type: 'knowledge-package';
  name: string;
  version: string;
  author: string;           // GHII
  created: string;          // ISO 8601
  updated: string;
  content_type: 'idea' | 'research' | 'plan' | 'dataset' | 'document' | 'tutorial' | 'collection' | 'article' | 'story' | 'fiction';
  tags: string[];
  language: string;
  maturity: 'draft' | 'review' | 'published';
  synthesis: {
    level: 'original' | 'assisted' | 'synthesized' | 'ai-generated';
    description: string;
    model?: string;
  };
  references: KnowledgeReference[];
  entries: KnowledgeEntry[];
  links: KnowledgeLink[];
  sharing: {
    catalog_listed: boolean;
    allow_clone: boolean;
    license?: string;
    morsel_price: number;
  };
}

interface KnowledgeReference {
  url: string;
  title: string;
  accessed: string;
  verified: boolean;
  note?: string;
}

interface KnowledgeEntry {
  key: string;
  title: string;
  visibility: 'private' | 'owner' | 'public';
  schema?: string;
}

interface KnowledgeLink {
  target: string;
  relation: 'related-to' | 'extends' | 'derived-from' | 'contradicts' | 'supersedes' | 'references';
  description: string;
  linked_at: string;
}

// Memory link record (stored as MemoryRecord at links/{hash}/{hash})
interface MemoryLinkRecord {
  source: string;
  target: string;
  relation: string;
  description: string;
  linked_at: string;
  linked_by: string;
}

// Operator review record
interface OperatorReviewRecord {
  id: string;
  packageId: string;
  operatorGaii: string;
  reason: 'routine_review' | 'legal_compliance' | 'community_report' | 'content_quality' | 'storage_issue' | 'custom';
  customText?: string;
  action: 'approve' | 'flag' | 'delist' | 'restrict' | 'note';
  timestamp: string;
}
```

### Testing Strategy

Each phase adds tests to `aimeat/test/e2e-knowledge.ts`. Tests run against a live server on port 40251 (same as existing E2E suite). The test file follows the same pattern as `test/e2e-full.ts` — creates its own test data and cleans up.

### Commit Strategy

Each task ends with a commit. Commit messages follow: `feat(knowledge): description` for new features, `test(knowledge): description` for tests.

---

## Execution Order

Phases are sequential — each builds on the previous. Within each phase, tasks are numbered and should be executed in order. Some tasks within a phase can be parallelized (noted in each phase document).

**Start with:** [Phase 1: Foundation](01-foundation.md)
