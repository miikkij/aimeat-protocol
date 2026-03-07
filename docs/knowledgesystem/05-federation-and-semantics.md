# Phase 5: Federation and Semantics

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable cross-node knowledge discovery via Genesis Peering federation, JSON-LD semantic annotations on knowledge packages, visual knowledge lineage traversal, and cross-node subscription notifications.

**Architecture:** Federation support piggybacks on the existing Genesis Peering infrastructure (Phase 3.4). Federated nodes exchange knowledge catalogue indexes during peering sync. Semantic annotations use the existing `semanticContext` field on schemas (Phase 0.7). Lineage graphs are computed by traversing `derived-from` and `extends` links across nodes. Subscriptions reuse the existing board subscription/notification mechanism.

**Tech Stack:** TypeScript backend, Preact + HTM frontend, existing federation/peering infrastructure, JSON-LD, schema.org vocabulary.

**Depends on:** Phase 1-4, Genesis Peering (Phase 3.4), Semantic Context (Phase 0.7)

**Note:** This phase depends on federation infrastructure that may not be fully implemented yet. Tasks are designed to be implementable incrementally — local semantic features can ship before federation is ready.

---

## Task 1: JSON-LD Semantic Annotations for Knowledge Packages

**Files:**
- Create: `aimeat/src/schemas/knowledge-semantics.ts`
- Modify: `aimeat/src/routes/knowledge.ts` (add semantic context to package responses)

**Step 1: Create semantic mappings**

Create `aimeat/src/schemas/knowledge-semantics.ts`:

```typescript
/** JSON-LD semantic context mappings for knowledge content types.
 *  Maps AIMEAT content types to schema.org vocabulary. */

export const KNOWLEDGE_SEMANTIC_CONTEXT = {
  '@context': {
    '@vocab': 'https://schema.org/',
    aimeat: 'https://aimeat.org/ns/',
  },
};

/** Maps content types to schema.org types */
export const CONTENT_TYPE_TO_SCHEMA_ORG: Record<string, string> = {
  idea: 'CreativeWork',
  research: 'ScholarlyArticle',
  plan: 'HowTo',
  dataset: 'Dataset',
  document: 'Article',
  tutorial: 'HowTo',
  collection: 'ItemList',
  article: 'Article',
  story: 'CreativeWork',
  fiction: 'CreativeWork',
};

/** Generate JSON-LD metadata for a knowledge package manifest */
export function generateJsonLd(manifest: any, nodeUrl: string, packageId: string): object {
  const schemaType = CONTENT_TYPE_TO_SCHEMA_ORG[manifest.content_type] || 'CreativeWork';

  return {
    '@context': 'https://schema.org/',
    '@type': schemaType,
    '@id': `${nodeUrl}/v1/packages/${packageId}`,
    name: manifest.name,
    author: {
      '@type': 'Person',
      identifier: manifest.author,
    },
    dateCreated: manifest.created,
    dateModified: manifest.updated,
    inLanguage: manifest.language,
    keywords: (manifest.tags || []).join(', '),
    version: manifest.version,
    license: manifest.sharing?.license || undefined,
    // AIMEAT-specific extensions
    'aimeat:contentType': manifest.content_type,
    'aimeat:synthesisLevel': manifest.synthesis?.level,
    'aimeat:maturity': manifest.maturity,
    'aimeat:citationQuality': manifest.references?.length
      ? Math.round((manifest.references.filter((r: any) => r.verified).length / manifest.references.length) * 100)
      : null,
    // References as citations
    citation: (manifest.references || []).map((ref: any) => ({
      '@type': 'CreativeWork',
      name: ref.title,
      url: ref.url,
    })),
  };
}
```

**Step 2: Add semantic context to package responses**

In `aimeat/src/routes/knowledge.ts`, modify the `GET /v1/packages/:id` endpoint to include `@context` in the response:

```typescript
import { generateJsonLd } from '../schemas/knowledge-semantics.js';

// In the GET /v1/packages/:id handler, add to the response:
const nodeUrl = config.nodeUrl ?? `http://localhost:${config.port}`;
const jsonLd = generateJsonLd(manifest.value, nodeUrl, packageId);

// Add to response data:
res.json(success(config.nodeId, {
  package_id: packageId,
  manifest: manifest.value,
  '@context': jsonLd,
  tags: manifest.tags,
  created_at: manifest.createdAt,
  updated_at: manifest.updatedAt,
}));
```

**Step 3: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add aimeat/src/schemas/knowledge-semantics.ts aimeat/src/routes/knowledge.ts
git commit -m "feat(knowledge): add JSON-LD semantic annotations using schema.org vocabulary"
```

---

## Task 2: Knowledge Lineage Graph Endpoint

**Files:**
- Modify: `aimeat/src/routes/knowledge.ts` (add lineage endpoint)

**Step 1: Add lineage graph endpoint**

Add to `knowledgeRouter`:

```typescript
/* ── GET /v1/packages/:id/lineage — Traverse knowledge lineage graph ── */
router.get('/v1/packages/:id/lineage', async (req, res) => {
  const packageId = req.params.id as string;
  const depth = Math.min(10, Math.max(1, parseInt(req.query.depth as string) || 3));
  const direction = (req.query.direction as string) || 'both'; // ancestors | descendants | both
  const manifestKey = `packages/${packageId}/manifest`;

  interface LineageNode {
    key: string;
    package_id: string;
    name: string;
    author: string;
    content_type: string;
    relation_from_parent?: string;
  }

  interface LineageEdge {
    source: string;
    target: string;
    relation: string;
    description: string;
  }

  const visited = new Set<string>();
  const nodes: LineageNode[] = [];
  const edges: LineageEdge[] = [];

  async function traverse(key: string, currentDepth: number) {
    if (visited.has(key) || currentDepth > depth) return;
    visited.add(key);

    // Try to find the manifest across all agents
    const allAgents = await storage.listAgents?.() ?? [];
    let manifest: any = null;
    for (const agent of allAgents) {
      const mem = await storage.getMemory(agent.gaii, key);
      if (mem) { manifest = mem; break; }
    }

    if (manifest?.value?.type === 'knowledge-package') {
      const pkgId = key.replace('packages/', '').replace('/manifest', '');
      nodes.push({
        key,
        package_id: pkgId,
        name: manifest.value.name,
        author: manifest.value.author,
        content_type: manifest.value.content_type,
      });
    }

    // Get links
    const relations = ['derived-from', 'extends', 'supersedes'];
    const links = await storage.listLinks(key, { direction: direction === 'both' ? 'both' : direction === 'ancestors' ? 'outgoing' : 'incoming' });

    for (const link of links) {
      if (!relations.includes(link.relation)) continue;

      edges.push({
        source: link.source,
        target: link.target,
        relation: link.relation,
        description: link.description,
      });

      const nextKey = link.source === key ? link.target : link.source;
      await traverse(nextKey, currentDepth + 1);
    }
  }

  await traverse(manifestKey, 0);

  res.json(success(config.nodeId, {
    root: manifestKey,
    nodes,
    edges,
    depth_requested: depth,
    direction,
  }));
});
```

**Step 2: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add aimeat/src/routes/knowledge.ts
git commit -m "feat(knowledge): add lineage graph traversal endpoint"
```

---

## Task 3: Federation Knowledge Index Sync

**Files:**
- Modify: `aimeat/src/routes/knowledge.ts` (add federation index endpoints)

**Step 1: Add federation knowledge index endpoints**

These endpoints are called by federated peer nodes during Genesis Peering sync to exchange knowledge catalogue indexes.

Add to `knowledgeRouter`:

```typescript
/* ── GET /v1/federation/knowledge/index — Return this node's public knowledge index for peers ── */
router.get('/v1/federation/knowledge/index', async (req, res) => {
  // This endpoint is called by peer nodes during federation sync
  // Returns a lightweight index of all public, catalog-listed packages
  const allAgents = await storage.listAgents?.() ?? [];
  const index: Array<{
    package_id: string;
    name: string;
    author: string;
    content_type: string;
    tags: string[];
    language: string;
    updated: string;
    node_id: string;
    node_url: string;
  }> = [];

  const nodeUrl = config.nodeUrl ?? `http://localhost:${config.port}`;

  for (const agent of allAgents) {
    const manifests = await storage.listMemory(agent.gaii, {
      prefix: 'packages/',
      visibility: 'public',
      tags: ['knowledge-package'],
    });

    for (const m of manifests) {
      if (!m.key.endsWith('/manifest') || m.value?.type !== 'knowledge-package') continue;
      if (!m.value.sharing?.catalog_listed) continue;

      const pkgId = m.key.replace('packages/', '').replace('/manifest', '');
      index.push({
        package_id: pkgId,
        name: m.value.name,
        author: m.value.author,
        content_type: m.value.content_type,
        tags: m.value.tags || [],
        language: m.value.language || 'en',
        updated: m.value.updated || m.updatedAt,
        node_id: config.nodeId,
        node_url: nodeUrl,
      });
    }
  }

  res.json(success(config.nodeId, {
    index,
    count: index.length,
    node_id: config.nodeId,
    node_url: nodeUrl,
    synced_at: new Date().toISOString(),
  }));
});

/* ── POST /v1/federation/knowledge/search — Search across federated knowledge indexes ── */
router.post('/v1/federation/knowledge/search', requireAuth(), async (req, res) => {
  const { query, content_type, tags, language } = req.body;

  // Search local packages
  const localResults = await searchLocalPackages(storage, { query, content_type, tags, language });

  // Search federated peers (if federation is available)
  const peers = await storage.listFederationPeers?.() ?? [];
  const federatedResults: any[] = [];

  for (const peer of peers) {
    if (peer.status !== 'active') continue;
    try {
      const peerResp = await fetch(`${peer.nodeUrl}/v1/catalogue/knowledge?` + new URLSearchParams({
        ...(content_type && { content_type }),
        ...(tags && { tags }),
        ...(language && { language }),
      }).toString(), {
        signal: AbortSignal.timeout(5000), // 5s timeout per peer
      });
      if (peerResp.ok) {
        const peerData = await peerResp.json();
        const peerPackages = peerData?.data?.packages || [];
        for (const pkg of peerPackages) {
          federatedResults.push({
            ...pkg,
            source_node_id: peer.nodeId,
            source_node_url: peer.nodeUrl,
            federated: true,
          });
        }
      }
    } catch {
      // Peer unreachable — skip silently
    }
  }

  res.json(success(config.nodeId, {
    local: localResults,
    federated: federatedResults,
    total: localResults.length + federatedResults.length,
  }));
});

/** Helper: search local packages by query, content_type, tags, language */
async function searchLocalPackages(storage: Storage, opts: {
  query?: string; content_type?: string; tags?: string; language?: string;
}) {
  const allAgents = await storage.listAgents?.() ?? [];
  const results: any[] = [];

  for (const agent of allAgents) {
    const manifests = await storage.listMemory(agent.gaii, {
      prefix: 'packages/',
      visibility: 'public',
      tags: ['knowledge-package'],
    });

    for (const m of manifests) {
      if (!m.key.endsWith('/manifest') || m.value?.type !== 'knowledge-package') continue;
      if (!m.value.sharing?.catalog_listed) continue;

      const v = m.value;
      if (opts.content_type && v.content_type !== opts.content_type) continue;
      if (opts.language && v.language !== opts.language) continue;
      if (opts.tags) {
        const filterTags = opts.tags.split(',').map((t: string) => t.trim());
        if (!filterTags.every((t: string) => v.tags?.includes(t))) continue;
      }
      if (opts.query) {
        const q = opts.query.toLowerCase();
        const searchable = `${v.name} ${(v.tags || []).join(' ')} ${v.content_type}`.toLowerCase();
        if (!searchable.includes(q)) continue;
      }

      results.push({
        package_id: m.key.replace('packages/', '').replace('/manifest', ''),
        name: v.name,
        author: v.author,
        content_type: v.content_type,
        tags: v.tags,
        language: v.language,
        federated: false,
      });
    }
  }

  return results;
}
```

**Step 2: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add aimeat/src/routes/knowledge.ts
git commit -m "feat(knowledge): add federation knowledge index and cross-node search"
```

---

## Task 4: Package Subscription / Notification

**Files:**
- Modify: `aimeat/src/routes/knowledge.ts` (add subscribe/notify endpoints)

**Step 1: Add subscription endpoints**

Subscriptions are stored as memory records under `subscriptions/knowledge/{packageId}` so they use the existing memory infrastructure.

Add to `knowledgeRouter`:

```typescript
/* ── POST /v1/packages/:id/subscribe — Subscribe to package updates ── */
router.post('/v1/packages/:id/subscribe', requireAuth(), requireRole('agent'), async (req, res) => {
  const subscriberGaii = req.auth!.sub as string;
  const packageId = req.params.id as string;
  const now = new Date().toISOString();

  const subKey = `subscriptions/knowledge/${packageId}`;
  const existing = await storage.getMemory(subscriberGaii, subKey);

  if (existing) {
    return res.json(success(config.nodeId, { already_subscribed: true, package_id: packageId }));
  }

  await storage.setMemory({
    key: subKey,
    ownerGaii: subscriberGaii,
    value: {
      package_id: packageId,
      subscribed_at: now,
      notify_on: ['version_update', 'new_entries'],
    },
    visibility: 'private',
    tags: ['subscription', 'knowledge'],
    ttlHours: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });

  res.status(201).json(success(config.nodeId, { subscribed: true, package_id: packageId }));
});

/* ── DELETE /v1/packages/:id/subscribe — Unsubscribe ── */
router.delete('/v1/packages/:id/subscribe', requireAuth(), requireRole('agent'), async (req, res) => {
  const subscriberGaii = req.auth!.sub as string;
  const packageId = req.params.id as string;
  const subKey = `subscriptions/knowledge/${packageId}`;

  const deleted = await storage.deleteMemory(subscriberGaii, subKey);
  res.json(success(config.nodeId, { unsubscribed: deleted, package_id: packageId }));
});

/* ── GET /v1/packages/:id/subscribers — List subscriber count (for package owner) ── */
router.get('/v1/packages/:id/subscribers', requireAuth(), async (req, res) => {
  const packageId = req.params.id as string;

  // Count all agents that have a subscription key for this package
  const allAgents = await storage.listAgents?.() ?? [];
  let count = 0;
  for (const agent of allAgents) {
    const sub = await storage.getMemory(agent.gaii, `subscriptions/knowledge/${packageId}`);
    if (sub) count++;
  }

  res.json(success(config.nodeId, { package_id: packageId, subscriber_count: count }));
});
```

**Step 2: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add aimeat/src/routes/knowledge.ts
git commit -m "feat(knowledge): add package subscription and notification endpoints"
```

---

## Task 5: E2E Tests for Phase 5

**Files:**
- Modify: `aimeat/test/e2e-knowledge.ts` (add federation, semantics, lineage, subscription tests)

**Step 1: Add Phase 5 tests**

```typescript
console.log('\nPhase 5: Federation and Semantics');

await test('Get package with JSON-LD semantic context', async () => {
  const { status, body } = await json(`/v1/packages/${testPackageId}`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.['@context'], 'Expected @context in response');
});

await test('Get knowledge lineage graph', async () => {
  const { status, body } = await json(`/v1/packages/${testPackageId}/lineage?depth=2`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(body.data?.nodes), 'Expected nodes array');
  assert(Array.isArray(body.data?.edges), 'Expected edges array');
});

await test('Get federation knowledge index', async () => {
  const { status, body } = await json('/v1/federation/knowledge/index');
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(body.data?.index), 'Expected index array');
  assert(body.data?.node_id, 'Expected node_id');
});

await test('Subscribe to package updates', async () => {
  const { status, body } = await json(`/v1/packages/${testPackageId}/subscribe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  assert(status === 201 || (status === 200 && body.data?.already_subscribed), `Expected 201 or already_subscribed, got ${status}`);
});

await test('Get subscriber count', async () => {
  const { status, body } = await json(`/v1/packages/${testPackageId}/subscribers`, {
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.subscriber_count >= 1, 'Expected at least 1 subscriber');
});

await test('Unsubscribe from package', async () => {
  const { status } = await json(`/v1/packages/${testPackageId}/subscribe`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  assert(status === 200, `Expected 200, got ${status}`);
});
```

**Step 2: Run tests**

Run: `cd aimeat && npx tsx test/e2e-knowledge.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add aimeat/test/e2e-knowledge.ts
git commit -m "test(knowledge): add Phase 5 E2E tests for semantics, lineage, federation, subscriptions"
```

---

## Task 6: Final Type Check and Build Verification

**Step 1: Run full type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS with zero errors

**Step 2: Run full build**

Run: `cd aimeat && pnpm build`
Expected: PASS

**Step 3: Run all E2E tests**

Run: `cd aimeat && npx tsx test/e2e-knowledge.ts`
Expected: All phases pass

**Step 4: Run existing E2E suite to check for regressions**

Run: `cd aimeat && npx tsx test/e2e-full.ts`
Expected: PASS (no regressions)

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat(knowledge): complete Knowledge System implementation (all 5 phases)"
```

---

## Phase 5 Complete

After completing all 6 tasks, you have:
- JSON-LD semantic annotations using schema.org vocabulary on all package responses
- Knowledge lineage graph traversal endpoint (configurable depth and direction)
- Federation knowledge index endpoint for peer sync
- Cross-node federated search
- Package subscription/unsubscription with subscriber counts
- Full E2E test coverage across all 5 phases
- Build verification and regression check

---

## Knowledge System — Complete

The full Knowledge System is now implemented across 5 phases:

| Phase | What Was Built |
|-------|---------------|
| 1 | Types, schemas, memory linking, prompts, synthesis labeling |
| 2 | Knowledge tab UI (action bar, import, my knowledge) |
| 3 | Catalogue discovery, clone, export, morsel pricing |
| 4 | Organisms, reputation, operator moderation, admin tab |
| 5 | JSON-LD semantics, lineage graphs, federation, subscriptions |

**Total new files:** ~15 files across backend, frontend, schemas, prompts, tests
**Total modified files:** ~12 existing files (interface.ts, server.ts, catalogue.ts, profile.js, admin.js, en.json, fi.json, profile.css, etc.)
**Total new API endpoints:** ~20 endpoints
**Total E2E tests:** ~15+ tests across 5 test phases
