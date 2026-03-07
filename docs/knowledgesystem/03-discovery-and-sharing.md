# Phase 3: Discovery and Sharing

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable discovery of shared knowledge packages through a catalogue endpoint, cloning packages to your own namespace, exporting packages for offline/AI chat use, and optional morsel pricing.

**Architecture:** New catalogue sub-endpoint (`GET /v1/catalogue/knowledge`) indexes all public package manifests. Clone endpoint copies entries to the requester's memory. Export endpoint produces portable JSON/YAML with embedded GHII/node info. The Knowledge tab's Discover and Shared With Me sections are populated.

**Tech Stack:** TypeScript backend, Preact + HTM frontend, existing catalogue and morsel/wallet patterns.

**Depends on:** Phase 1 (types, routes), Phase 2 (Knowledge tab, API service)

---

## Task 1: Knowledge Catalogue Endpoint

**Files:**
- Modify: `aimeat/src/routes/catalogue.ts` (add `/v1/catalogue/knowledge` route)

**Step 1: Read existing catalogue.ts**

Read `aimeat/src/routes/catalogue.ts` to understand the pattern for sub-catalogues (e.g., `/v1/catalogue/agents`, `/v1/catalogue/actions`).

**Step 2: Add the knowledge catalogue endpoint**

Add before the parameterized `/:actionId` route (static routes must come first):

```typescript
/* ── GET /v1/catalogue/knowledge — Browse shared knowledge packages ── */
router.get('/v1/catalogue/knowledge', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const perPage = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
  const contentType = req.query.content_type as string | undefined;
  const tagsFilter = req.query.tags ? (req.query.tags as string).split(',').map(t => t.trim()) : [];
  const language = req.query.language as string | undefined;
  const sort = (req.query.sort as string) || 'recent';

  // Find all public package manifests across all agents
  // We search memory with tag 'knowledge-package' and visibility 'public'
  const allAgents = await storage.listAgents?.() ?? [];
  let manifests: Array<{ key: string; value: any; ownerGaii: string; tags: string[]; createdAt: string; updatedAt: string }> = [];

  for (const agent of allAgents) {
    const agentManifests = await storage.listMemory(agent.gaii, {
      prefix: 'packages/',
      visibility: 'public',
      tags: ['knowledge-package'],
    });
    for (const m of agentManifests) {
      if (m.key.endsWith('/manifest') && m.value?.type === 'knowledge-package') {
        manifests.push({
          key: m.key,
          value: m.value,
          ownerGaii: m.ownerGaii,
          tags: m.tags,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
        });
      }
    }
  }

  // Apply filters
  if (contentType) {
    manifests = manifests.filter(m => m.value.content_type === contentType);
  }
  if (tagsFilter.length > 0) {
    manifests = manifests.filter(m =>
      tagsFilter.every(t => m.value.tags?.includes(t) || m.tags?.includes(t))
    );
  }
  if (language) {
    manifests = manifests.filter(m => m.value.language === language);
  }

  // Sort
  if (sort === 'recent') {
    manifests.sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
  }

  // Paginate
  const total = manifests.length;
  const paged = manifests.slice((page - 1) * perPage, page * perPage);

  const items = paged.map(m => {
    const v = m.value;
    const packageId = m.key.replace('packages/', '').replace('/manifest', '');
    return {
      package_id: packageId,
      name: v.name,
      author: v.author,
      content_type: v.content_type,
      tags: v.tags,
      language: v.language,
      maturity: v.maturity,
      synthesis: v.synthesis,
      references_count: (v.references || []).length,
      verified_references: (v.references || []).filter((r: any) => r.verified).length,
      entries_count: (v.entries || []).length,
      public_entries: (v.entries || []).filter((e: any) => e.visibility === 'public').length,
      sharing: v.sharing,
      created: v.created || m.createdAt,
      updated: v.updated || m.updatedAt,
    };
  });

  res.json(success(config.nodeId, {
    packages: items,
    total,
    page,
    per_page: perPage,
    pages: Math.ceil(total / perPage),
  }));
});
```

**Step 3: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add aimeat/src/routes/catalogue.ts
git commit -m "feat(knowledge): add GET /v1/catalogue/knowledge endpoint for package discovery"
```

---

## Task 2: Clone Endpoint

**Files:**
- Modify: `aimeat/src/routes/knowledge.ts` (add clone route)

**Step 1: Add clone endpoint**

Add to `knowledgeRouter` in `aimeat/src/routes/knowledge.ts`:

```typescript
/* ── POST /v1/packages/:id/clone — Clone public entries to your own namespace ── */
router.post('/v1/packages/:id/clone', requireAuth(), requireRole('agent'), async (req, res) => {
  const requesterGaii = req.auth!.sub as string;
  const requesterGhii = req.auth!.owner as string;
  const sourcePackageId = req.params.id as string;
  const { target_prefix, entries: requestedEntries } = req.body;

  if (!target_prefix) {
    return res.status(400).json(error(config.nodeId, 'MISSING_FIELDS', 'target_prefix is required'));
  }

  const sourceManifestKey = `packages/${sourcePackageId}/manifest`;

  // Find the source manifest (search across all agents for public memory)
  const allAgents = await storage.listAgents?.() ?? [];
  let sourceManifest: any = null;
  let sourceOwnerGaii = '';

  for (const agent of allAgents) {
    const mem = await storage.getMemory(agent.gaii, sourceManifestKey);
    if (mem && mem.visibility === 'public') {
      sourceManifest = mem;
      sourceOwnerGaii = agent.gaii;
      break;
    }
  }

  if (!sourceManifest || !sourceManifest.value) {
    return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Source package not found or not public'));
  }

  const manifest = sourceManifest.value as KnowledgeManifest;

  if (!manifest.sharing?.allow_clone) {
    return res.status(403).json(error(config.nodeId, 'CLONE_DISABLED', 'This package does not allow cloning'));
  }

  // Check morsel price
  if (manifest.sharing.morsel_price > 0) {
    const wallet = await storage.getWallet?.(requesterGaii);
    if (!wallet || (wallet.balance ?? 0) < manifest.sharing.morsel_price) {
      return res.status(402).json(error(config.nodeId, 'INSUFFICIENT_MORSELS', `This package costs ${manifest.sharing.morsel_price} morsels to clone`));
    }
    // Deduct morsels
    await storage.deductMorsels?.(requesterGaii, manifest.sharing.morsel_price, `Clone package: ${manifest.name}`);
    await storage.addMorsels?.(sourceOwnerGaii, manifest.sharing.morsel_price, `Package cloned: ${manifest.name}`);
  }

  // Clone requested entries (only public ones)
  const publicEntries = manifest.entries.filter(e => e.visibility === 'public');
  const toClone = requestedEntries
    ? publicEntries.filter(e => requestedEntries.includes(e.key.split('/').pop()))
    : publicEntries;

  const now = new Date().toISOString();
  const newPackageId = require('crypto').randomUUID();
  const clonedEntries: string[] = [];

  for (const entry of toClone) {
    const sourceEntry = await storage.getMemory(sourceOwnerGaii, entry.key);
    if (!sourceEntry) continue;

    const entryName = entry.key.split('/').pop() ?? entry.key;
    const newKey = `packages/${newPackageId}/${entryName}`;

    await storage.setMemory({
      key: newKey,
      ownerGaii: requesterGaii,
      value: sourceEntry.value,
      visibility: entry.visibility,
      tags: [...sourceEntry.tags, 'cloned'],
      ttlHours: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    clonedEntries.push(newKey);
  }

  // Create cloned manifest
  const clonedManifest: KnowledgeManifest = {
    ...manifest,
    version: '1.0.0',
    author: requesterGhii,
    created: now,
    updated: now,
    entries: toClone.map(e => ({
      ...e,
      key: `packages/${newPackageId}/${e.key.split('/').pop()}`,
    })),
    links: [{
      target: sourceManifestKey,
      relation: 'derived-from',
      description: `Cloned from ${manifest.name} by ${manifest.author}`,
      linked_at: now,
    }],
    sharing: {
      catalog_listed: false, // Clones start unlisted
      allow_clone: manifest.sharing.allow_clone,
      license: manifest.sharing.license,
      morsel_price: 0,
    },
  };

  await storage.setMemory({
    key: `packages/${newPackageId}/manifest`,
    ownerGaii: requesterGaii,
    value: clonedManifest,
    visibility: 'owner',
    tags: ['knowledge-package', manifest.content_type, ...manifest.tags, 'cloned'],
    ttlHours: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });

  // Create derived-from link
  await storage.createLink({
    source: `packages/${newPackageId}/manifest`,
    target: sourceManifestKey,
    relation: 'derived-from',
    description: `Cloned from ${manifest.name}`,
    linked_at: now,
    linked_by: requesterGhii,
  });

  res.status(201).json(success(config.nodeId, {
    cloned_package_id: newPackageId,
    entries_cloned: clonedEntries.length,
    source_package_id: sourcePackageId,
    morsel_cost: manifest.sharing.morsel_price,
  }, [
    { description: 'View cloned package', method: 'GET', url: `/v1/memory/${encodeURIComponent(`packages/${newPackageId}/manifest`)}` },
  ]));
});
```

**Step 2: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS (some wallet methods may need `?.` optional chaining if not all storage implementations have them)

**Step 3: Commit**

```bash
git add aimeat/src/routes/knowledge.ts
git commit -m "feat(knowledge): add POST /v1/packages/:id/clone with morsel pricing"
```

---

## Task 3: Export Endpoint

**Files:**
- Modify: `aimeat/src/routes/knowledge.ts` (add export route)

**Step 1: Add export endpoint**

Add to `knowledgeRouter` in `aimeat/src/routes/knowledge.ts`:

```typescript
/* ── GET /v1/packages/:id/export — Export package as portable JSON ── */
router.get('/v1/packages/:id/export', async (req, res) => {
  const packageId = req.params.id as string;
  const format = (req.query.format as string) || 'json';
  const requestedEntries = req.query.entries
    ? (req.query.entries as string).split(',').map(e => e.trim())
    : null;

  const manifestKey = `packages/${packageId}/manifest`;

  // Find public manifest
  const allAgents = await storage.listAgents?.() ?? [];
  let sourceManifest: any = null;
  let sourceOwnerGaii = '';

  for (const agent of allAgents) {
    const mem = await storage.getMemory(agent.gaii, manifestKey);
    if (mem && mem.visibility === 'public') {
      sourceManifest = mem;
      sourceOwnerGaii = agent.gaii;
      break;
    }
  }

  if (!sourceManifest) {
    return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found or not public'));
  }

  const manifest = sourceManifest.value as KnowledgeManifest;
  const nodeUrl = config.nodeUrl ?? `http://localhost:${config.port}`;

  // Collect public entry data
  const entryData: Record<string, unknown> = {};
  const publicEntries = manifest.entries.filter(e => e.visibility === 'public');
  const entriesToExport = requestedEntries
    ? publicEntries.filter(e => requestedEntries.includes(e.key.split('/').pop() ?? ''))
    : publicEntries;

  for (const entry of entriesToExport) {
    const mem = await storage.getMemory(sourceOwnerGaii, entry.key);
    if (mem) {
      const entryName = entry.key.split('/').pop() ?? entry.key;
      entryData[entryName] = mem.value;
    }
  }

  const exportData = {
    aimeat_knowledge_package: true,
    exported_from: {
      node_url: nodeUrl,
      node_id: config.nodeId,
      package_id: packageId,
      author_ghii: manifest.author,
      api_spec: `${nodeUrl}/v1/openapi.yaml`,
      auth_endpoint: `${nodeUrl}/v1/auth/token`,
    },
    package: {
      ...manifest,
      entries: entriesToExport,
    },
    entry_data: entryData,
    trust_advisory: 'This knowledge was shared by another user. Verify critical information independently before relying on it.',
  };

  if (format === 'yaml') {
    // Simple YAML-like output (no dependency needed for basic structure)
    res.setHeader('Content-Type', 'text/yaml');
    res.setHeader('Content-Disposition', `attachment; filename="${manifest.name.replace(/[^a-z0-9]/gi, '-')}.yaml"`);
    res.send(JSON.stringify(exportData, null, 2)); // JSON as fallback — proper YAML would need a library
  } else {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${manifest.name.replace(/[^a-z0-9]/gi, '-')}.json"`);
    res.json(exportData);
  }
});
```

**Step 2: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add aimeat/src/routes/knowledge.ts
git commit -m "feat(knowledge): add GET /v1/packages/:id/export for portable package download"
```

---

## Task 4: Update Frontend Service and Knowledge Tab — Discover Section

**Files:**
- Modify: `aimeat/public/js/services/knowledge.js` (add catalogue + clone methods)
- Modify: `aimeat/public/views/profile/knowledge-tab.js` (populate Discover section)

**Step 1: Add catalogue and clone methods to service**

Add to `aimeat/public/js/services/knowledge.js`:

```javascript
/* ── Catalogue / Discovery ── */

export async function discoverPackages(opts = {}) {
  const params = new URLSearchParams();
  if (opts.content_type) params.set('content_type', opts.content_type);
  if (opts.tags) params.set('tags', opts.tags);
  if (opts.language) params.set('language', opts.language);
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.page) params.set('page', String(opts.page));
  if (opts.limit) params.set('limit', String(opts.limit));
  return apiGet(`/v1/catalogue/knowledge?${params.toString()}`);
}

/* ── Clone ── */

export async function clonePackage(packageId, targetPrefix, entries) {
  return apiPost(`/v1/packages/${encodeURIComponent(packageId)}/clone`, {
    target_prefix: targetPrefix,
    entries,
  });
}
```

**Step 2: Populate the Discover section in the Knowledge tab**

In `aimeat/public/views/profile/knowledge-tab.js`, replace the Discover placeholder with a working section. Add state for discovered packages and a load function:

```javascript
const [discovered, setDiscovered] = useState([]);
const [discoverLoading, setDiscoverLoading] = useState(false);

const loadDiscover = useCallback(async () => {
  setDiscoverLoading(true);
  try {
    const resp = await knowledgeService.discoverPackages({ sort: 'recent', limit: 10 });
    setDiscovered(resp?.data?.packages || []);
  } catch { setDiscovered([]); }
  finally { setDiscoverLoading(false); }
}, []);

useEffect(() => { loadDiscover(); }, [loadDiscover]);
```

Replace the Discover section HTML with cards for each discovered package (following the card pattern from My Knowledge but adding author, clone button, trust advisory).

**Step 3: Test in browser**

Open Knowledge tab, verify Discover section loads packages (will be empty until packages exist with `catalog_listed: true`).

**Step 4: Commit**

```bash
git add aimeat/public/js/services/knowledge.js aimeat/public/views/profile/knowledge-tab.js
git commit -m "feat(knowledge): add Discover section with catalogue search and clone support"
```

---

## Task 5: E2E Tests for Phase 3

**Files:**
- Modify: `aimeat/test/e2e-knowledge.ts` (add discovery, clone, export tests)

**Step 1: Add Phase 3 tests**

Add after the Phase 1 tests in `e2e-knowledge.ts`:

```typescript
console.log('\nPhase 3: Discovery and Sharing');

let testPackageId = '';

await test('Import a public package for discovery', async () => {
  const { status, body } = await json('/v1/packages/import', {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentToken}` },
    body: JSON.stringify({
      package: {
        type: 'knowledge-package',
        name: 'Discoverable Package',
        version: '1.0.0',
        author: 'knowledge-test-owner',
        content_type: 'research',
        tags: ['discovery-test'],
        language: 'en',
        maturity: 'published',
        synthesis: { level: 'original', description: 'Test' },
        references: [],
        entries: [{ key: 'data', title: 'Test Data', visibility: 'public' }],
        links: [],
        sharing: { catalog_listed: true, allow_clone: true, morsel_price: 0 },
      },
      entry_data: { data: { title: 'Test Data', summary: 'Discoverable content' } },
    }),
  });
  assert(status === 201, `Expected 201, got ${status}`);
  testPackageId = body.data.package_id;
});

await test('Discover packages via catalogue', async () => {
  const { status, body } = await json('/v1/catalogue/knowledge?tags=discovery-test');
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.packages?.length >= 1, 'Expected at least 1 package');
});

await test('Export a package', async () => {
  const { status, body } = await json(`/v1/packages/${testPackageId}/export?format=json`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.aimeat_knowledge_package === true, 'Expected aimeat_knowledge_package flag');
  assert(body.exported_from?.package_id === testPackageId, 'Expected correct package_id in export');
});

await test('Clone a package', async () => {
  const { status, body } = await json(`/v1/packages/${testPackageId}/clone`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentToken}` },
    body: JSON.stringify({ target_prefix: 'my-clone' }),
  });
  assert(status === 201, `Expected 201, got ${status}`);
  assert(body.data?.cloned_package_id, 'Expected cloned_package_id');
  assert(body.data?.entries_cloned >= 1, 'Expected at least 1 cloned entry');
});
```

**Step 2: Run tests**

Run: `cd aimeat && npx tsx test/e2e-knowledge.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add aimeat/test/e2e-knowledge.ts
git commit -m "test(knowledge): add Phase 3 E2E tests for discovery, clone, and export"
```

---

## Phase 3 Complete

After completing all 5 tasks, you have:
- Knowledge catalogue endpoint with filtering (content type, tags, language, sort)
- Clone endpoint with morsel pricing and derived-from lineage
- Export endpoint with embedded node/API info for portability
- Discover section in Knowledge tab populated from catalogue
- E2E tests for discovery, clone, and export

**Next:** [Phase 4: Collaboration, Quality, and Moderation](04-collaboration-quality-moderation.md)
