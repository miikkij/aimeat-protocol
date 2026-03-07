# Phase 4: Collaboration, Quality, and Moderation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable collaborative knowledge building via Organisms, reputation/quality signals, notification subscriptions, quality moderation via the existing flag system, and transparent operator review with audit logging.

**Architecture:** Organism integration uses the existing `organism.*` memory namespace and organism membership checks. Reputation signals are computed on-the-fly from clone counts and flag counts (no new storage — derive from existing data). Operator moderation uses the `OperatorReviewRecord` from Phase 1 and creates consent audit entries for transparency. Admin dashboard gets a new Knowledge tab.

**Tech Stack:** TypeScript backend, Preact + HTM frontend, existing organism/flag/consent/audit infrastructure.

**Depends on:** Phase 1-3

---

## Task 1: Organism Knowledge Sharing

**Files:**
- Modify: `aimeat/src/routes/knowledge.ts` (add organism contribution endpoint)

**Step 1: Add organism contribution endpoint**

Add to `knowledgeRouter`:

```typescript
/* ── POST /v1/packages/:id/contribute — Contribute a package to an organism ── */
router.post('/v1/packages/:id/contribute', requireAuth(), requireRole('agent'), async (req, res) => {
  const ownerGaii = req.auth!.sub as string;
  const ghii = req.auth!.owner as string;
  const packageId = req.params.id as string;
  const { organism_id } = req.body;

  if (!organism_id) {
    return res.status(400).json(error(config.nodeId, 'MISSING_FIELDS', 'organism_id is required'));
  }

  // Verify organism exists and user is a member
  const organism = await storage.getOrganism?.(organism_id);
  if (!organism) {
    return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
  }

  const membership = await storage.getOrganismMembership?.(organism_id, ghii);
  if (!membership) {
    return res.status(403).json(error(config.nodeId, 'NOT_MEMBER', 'You are not a member of this organism'));
  }

  // Verify the package exists and belongs to the requester
  const manifestKey = `packages/${packageId}/manifest`;
  const manifest = await storage.getMemory(ownerGaii, manifestKey);
  if (!manifest) {
    return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found'));
  }

  const now = new Date().toISOString();

  // Create consent grant for the organism
  await storage.createConsent({
    id: uuidv4(),
    ownerGaii,
    dataPattern: `packages/${packageId}/*`,
    recipient: `organism.${organism_id}`,
    purpose: `Knowledge package contributed to organism: ${organism.name || organism_id}`,
    scope: 'private',
    expires: null,
    status: 'active',
    grantedAt: now,
    revokedAt: null,
  });

  // Tag the manifest with the organism
  const existingTags = manifest.tags || [];
  if (!existingTags.includes(`organism:${organism_id}`)) {
    manifest.tags = [...existingTags, `organism:${organism_id}`];
    manifest.updatedAt = now;
    manifest.version += 1;
    await storage.setMemory(manifest);
  }

  res.status(201).json(success(config.nodeId, {
    package_id: packageId,
    organism_id,
    contributed: true,
  }));
});

/* ── GET /v1/packages/organism/:id — List packages shared with an organism ── */
router.get('/v1/packages/organism/:id', requireAuth(), async (req, res) => {
  const ghii = req.auth!.owner as string;
  const organismId = req.params.id as string;

  // Verify membership
  const membership = await storage.getOrganismMembership?.(organismId, ghii);
  if (!membership) {
    return res.status(403).json(error(config.nodeId, 'NOT_MEMBER', 'You are not a member of this organism'));
  }

  // Find consents granted to this organism for package data
  const allAgents = await storage.listAgents?.() ?? [];
  const packages: any[] = [];

  for (const agent of allAgents) {
    const consents = await storage.listConsents(agent.gaii, { recipient: `organism.${organismId}`, status: 'active' });
    for (const consent of consents) {
      if (consent.dataPattern.startsWith('packages/') && consent.dataPattern.endsWith('/*')) {
        const prefix = consent.dataPattern.replace('/*', '/manifest');
        const manifest = await storage.getMemory(agent.gaii, prefix);
        if (manifest?.value?.type === 'knowledge-package') {
          packages.push({
            key: prefix,
            manifest: manifest.value,
            ownerGaii: agent.gaii,
            contributed_at: consent.grantedAt,
          });
        }
      }
    }
  }

  res.json(success(config.nodeId, { packages, count: packages.length }));
});
```

**Step 2: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add aimeat/src/routes/knowledge.ts
git commit -m "feat(knowledge): add organism contribution and listing endpoints"
```

---

## Task 2: Reputation and Quality Signals

**Files:**
- Modify: `aimeat/src/routes/knowledge.ts` (add reputation endpoint)

**Step 1: Add reputation computation endpoint**

Add to `knowledgeRouter`:

```typescript
/* ── GET /v1/packages/:id/reputation — Get quality signals for a package ── */
router.get('/v1/packages/:id/reputation', async (req, res) => {
  const packageId = req.params.id as string;
  const manifestKey = `packages/${packageId}/manifest`;

  // Find the manifest
  const allAgents = await storage.listAgents?.() ?? [];
  let manifest: any = null;

  for (const agent of allAgents) {
    const mem = await storage.getMemory(agent.gaii, manifestKey);
    if (mem) { manifest = mem; break; }
  }

  if (!manifest) {
    return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found'));
  }

  const value = manifest.value as KnowledgeManifest;

  // Count clones (derived-from links pointing to this package)
  const incomingLinks = await storage.listLinks(manifestKey, { direction: 'incoming', relation: 'derived-from' });
  const cloneCount = incomingLinks.length;

  // Citation quality
  const refs = value.references || [];
  const verifiedCount = refs.filter(r => r.verified).length;
  const citationQuality = refs.length > 0 ? Math.round((verifiedCount / refs.length) * 100) : null;

  // Flag count (from memory record)
  const flagCount = manifest.flagCount ?? 0;

  // Reviews
  const reviews = await storage.listReviews(manifestKey);
  const lastReview = reviews.length > 0 ? reviews[reviews.length - 1] : null;

  res.json(success(config.nodeId, {
    package_id: packageId,
    clone_count: cloneCount,
    flag_count: flagCount,
    citation_quality_percent: citationQuality,
    references_total: refs.length,
    references_verified: verifiedCount,
    synthesis_level: value.synthesis?.level,
    maturity: value.maturity,
    last_updated: value.updated || manifest.updatedAt,
    last_review: lastReview ? {
      action: lastReview.action,
      reason: lastReview.reason,
      timestamp: lastReview.timestamp,
    } : null,
  }));
});
```

**Step 2: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add aimeat/src/routes/knowledge.ts
git commit -m "feat(knowledge): add reputation/quality signals endpoint"
```

---

## Task 3: Operator Review System

**Files:**
- Modify: `aimeat/src/routes/knowledge.ts` (add operator review routes)

**Step 1: Add operator review endpoints**

Add to `knowledgeRouter`:

```typescript
/* ── GET /v1/admin/knowledge — List all packages for operator review ── */
router.get('/v1/admin/knowledge', requireAuth(), requireRole('operator'), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const perPage = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
  const filterFlagged = req.query.flagged === 'true';
  const filterAuthor = req.query.author as string | undefined;
  const filterType = req.query.content_type as string | undefined;

  const allAgents = await storage.listAgents?.() ?? [];
  let manifests: any[] = [];

  for (const agent of allAgents) {
    const agentManifests = await storage.listMemory(agent.gaii, {
      prefix: 'packages/',
      tags: ['knowledge-package'],
    });
    for (const m of agentManifests) {
      if (m.key.endsWith('/manifest') && m.value?.type === 'knowledge-package') {
        manifests.push({
          key: m.key,
          value: m.value,
          ownerGaii: m.ownerGaii,
          visibility: m.visibility,
          flagCount: m.flagCount ?? 0,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
        });
      }
    }
  }

  // Apply filters
  if (filterFlagged) manifests = manifests.filter(m => m.flagCount > 0);
  if (filterAuthor) manifests = manifests.filter(m => m.value.author === filterAuthor);
  if (filterType) manifests = manifests.filter(m => m.value.content_type === filterType);

  // Sort: flagged first, then newest
  manifests.sort((a, b) => {
    if (a.flagCount !== b.flagCount) return b.flagCount - a.flagCount;
    return (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt);
  });

  const total = manifests.length;
  const paged = manifests.slice((page - 1) * perPage, page * perPage);

  res.json(success(config.nodeId, {
    packages: paged.map(m => ({
      key: m.key,
      package_id: m.key.replace('packages/', '').replace('/manifest', ''),
      name: m.value.name,
      author: m.value.author,
      content_type: m.value.content_type,
      visibility: m.visibility,
      flag_count: m.flagCount,
      maturity: m.value.maturity,
      created: m.value.created || m.createdAt,
    })),
    total,
    page,
    per_page: perPage,
  }));
});

/* ── POST /v1/admin/knowledge/:id/review — Operator reviews a package ── */
router.post('/v1/admin/knowledge/:id/review', requireAuth(), requireRole('operator'), async (req, res) => {
  const operatorGaii = req.auth!.sub as string;
  const packageId = req.params.id as string;
  const { reason, custom_text, action: reviewAction } = req.body;

  const validReasons = ['routine_review', 'legal_compliance', 'community_report', 'content_quality', 'storage_issue', 'custom'];
  const validActions = ['approve', 'flag', 'delist', 'restrict', 'note'];

  if (!reason || !validReasons.includes(reason)) {
    return res.status(400).json(error(config.nodeId, 'INVALID_REASON', `reason must be one of: ${validReasons.join(', ')}`));
  }
  if (!reviewAction || !validActions.includes(reviewAction)) {
    return res.status(400).json(error(config.nodeId, 'INVALID_ACTION', `action must be one of: ${validActions.join(', ')}`));
  }

  const manifestKey = `packages/${packageId}/manifest`;

  // Find the package (search all agents)
  const allAgents = await storage.listAgents?.() ?? [];
  let manifest: any = null;

  for (const agent of allAgents) {
    const mem = await storage.getMemory(agent.gaii, manifestKey);
    if (mem) { manifest = mem; break; }
  }

  if (!manifest) {
    return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found'));
  }

  const now = new Date().toISOString();

  // Create review record
  const review: OperatorReviewRecord = {
    id: uuidv4(),
    packageId: manifestKey,
    operatorGaii,
    reason,
    customText: custom_text,
    action: reviewAction as OperatorReviewAction,
    timestamp: now,
  };
  await storage.createReview(review);

  // Create audit entry (transparent to package owner — NO morsel cost)
  await storage.addConsentAuditEntry({
    id: uuidv4(),
    consentId: 'operator-review',
    ownerGaii: manifest.ownerGaii,
    accessorGaii: operatorGaii,
    memoryKey: manifestKey,
    action: 'read' as const,
    timestamp: now,
    allowed: true,
  });

  // Apply action to the package
  const manifestValue = manifest.value as KnowledgeManifest;
  switch (reviewAction) {
    case 'approve':
      manifest.flagCount = 0;
      break;
    case 'flag':
      manifest.flagCount = (manifest.flagCount ?? 0) + 5; // Operator flag has higher weight
      break;
    case 'delist':
      manifestValue.sharing.catalog_listed = false;
      manifest.value = manifestValue;
      break;
    case 'restrict':
      manifest.visibility = 'private';
      manifestValue.sharing.catalog_listed = false;
      manifest.value = manifestValue;
      break;
    case 'note':
      // No status change — just the review record
      break;
  }

  manifest.updatedAt = now;
  manifest.version += 1;
  await storage.setMemory(manifest);

  res.json(success(config.nodeId, {
    review_id: review.id,
    action: reviewAction,
    reason,
    package_id: packageId,
  }));
});

/* ── GET /v1/packages/:id/reviews — List operator reviews for a package (visible to owner) ── */
router.get('/v1/packages/:id/reviews', requireAuth(), async (req, res) => {
  const packageId = req.params.id as string;
  const manifestKey = `packages/${packageId}/manifest`;

  const reviews = await storage.listReviews(manifestKey);

  res.json(success(config.nodeId, {
    reviews: reviews.map(r => ({
      id: r.id,
      reason: r.reason,
      action: r.action,
      custom_text: r.customText,
      timestamp: r.timestamp,
    })),
    count: reviews.length,
  }));
});
```

**Step 2: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add aimeat/src/routes/knowledge.ts
git commit -m "feat(knowledge): add operator review system with transparent audit logging"
```

---

## Task 4: Admin Dashboard Knowledge Tab

**Files:**
- Create: `aimeat/public/views/admin/knowledge-tab.js`
- Modify: `aimeat/public/views/admin.js` (add tab to NAV_GROUPS)
- Modify: `aimeat/public/js/services/admin.js` (add knowledge admin methods)

**Step 1: Add admin service methods**

Add to `aimeat/public/js/services/admin.js`:

```javascript
export const getKnowledgePackages = (opts = {}) => {
  const params = new URLSearchParams();
  if (opts.flagged) params.set('flagged', 'true');
  if (opts.author) params.set('author', opts.author);
  if (opts.content_type) params.set('content_type', opts.content_type);
  if (opts.page) params.set('page', String(opts.page));
  return apiGet(`/v1/admin/knowledge?${params.toString()}`);
};

export const reviewKnowledgePackage = (packageId, reason, action, customText) =>
  apiPost(`/v1/admin/knowledge/${encodeURIComponent(packageId)}/review`, {
    reason, action, custom_text: customText,
  });
```

**Step 2: Create the admin knowledge tab**

Create `aimeat/public/views/admin/knowledge-tab.js`:

```javascript
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Badge, Spinner, Empty } from './shared.js';
import * as adminService from '/js/services/admin.js';

export default function KnowledgeAdminTab({ data, reload }) {
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);
  const [reviewingId, setReviewingId] = useState(null);
  const [reviewForm, setReviewForm] = useState({ reason: 'routine_review', action: 'approve', customText: '' });

  const loadPackages = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await adminService.getKnowledgePackages({ flagged: showFlaggedOnly || undefined });
      setPackages(resp?.data?.packages || []);
    } catch { setPackages([]); }
    finally { setLoading(false); }
  }, [showFlaggedOnly]);

  useEffect(() => { loadPackages(); }, [loadPackages]);

  const submitReview = useCallback(async (packageId) => {
    try {
      await adminService.reviewKnowledgePackage(
        packageId, reviewForm.reason, reviewForm.action, reviewForm.customText || undefined
      );
      setReviewingId(null);
      loadPackages();
    } catch (err) {
      console.error('Review failed:', err);
    }
  }, [reviewForm, loadPackages]);

  if (loading) return html`<${Spinner} text="Loading knowledge packages..." />`;

  return html`
    <div class="adm-section">
      <h3>${t('knowledge.operator.tabLabel')}</h3>

      <label class="adm-toggle" style="margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">
        <input type="checkbox" checked=${showFlaggedOnly}
          onChange=${(e) => setShowFlaggedOnly(e.target.checked)} />
        Show flagged only
      </label>

      ${packages.length === 0 && html`<${Empty} text="No knowledge packages found" />`}

      ${packages.map(pkg => html`
        <div class="adm-card" key=${pkg.key} style="margin-bottom: 0.75rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.5rem;">
            <strong>${escHtml(pkg.name)}</strong>
            <${Badge} type=${pkg.content_type} />
            <span style="font-size: 0.75rem; color: var(--text-muted);">by ${escHtml(pkg.author)}</span>
            ${pkg.flag_count > 0 && html`
              <span style="background: rgba(231,76,60,0.2); color: #e74c3c; padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.7rem;">
                ${pkg.flag_count} flags
              </span>
            `}
          </div>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem;">
            Visibility: ${pkg.visibility} | Created: ${pkg.created?.slice(0, 10)}
          </div>
          <button class="adm-btn" onClick=${() => setReviewingId(reviewingId === pkg.package_id ? null : pkg.package_id)}>
            ${t('knowledge.operator.review')}
          </button>

          ${reviewingId === pkg.package_id && html`
            <div style="margin-top: 0.75rem; padding: 0.75rem; background: var(--input-bg); border-radius: 8px;">
              <div style="margin-bottom: 0.5rem;">
                <label style="font-size: 0.8rem;">Reason:</label>
                <select value=${reviewForm.reason} onChange=${(e) => setReviewForm({ ...reviewForm, reason: e.target.value })}
                  style="margin-left: 0.5rem; padding: 0.25rem;">
                  <option value="routine_review">${t('knowledge.operator.reasons.routine_review')}</option>
                  <option value="legal_compliance">${t('knowledge.operator.reasons.legal_compliance')}</option>
                  <option value="community_report">${t('knowledge.operator.reasons.community_report')}</option>
                  <option value="content_quality">${t('knowledge.operator.reasons.content_quality')}</option>
                  <option value="storage_issue">${t('knowledge.operator.reasons.storage_issue')}</option>
                  <option value="custom">${t('knowledge.operator.reasons.custom')}</option>
                </select>
              </div>
              ${reviewForm.reason === 'custom' && html`
                <div style="margin-bottom: 0.5rem;">
                  <input type="text" placeholder="Custom reason..."
                    value=${reviewForm.customText}
                    onChange=${(e) => setReviewForm({ ...reviewForm, customText: e.target.value })}
                    style="width: 100%; padding: 0.35rem;" />
                </div>
              `}
              <div style="margin-bottom: 0.5rem;">
                <label style="font-size: 0.8rem;">Action:</label>
                <select value=${reviewForm.action} onChange=${(e) => setReviewForm({ ...reviewForm, action: e.target.value })}
                  style="margin-left: 0.5rem; padding: 0.25rem;">
                  <option value="approve">${t('knowledge.operator.actions.approve')}</option>
                  <option value="flag">${t('knowledge.operator.actions.flag')}</option>
                  <option value="delist">${t('knowledge.operator.actions.delist')}</option>
                  <option value="restrict">${t('knowledge.operator.actions.restrict')}</option>
                  <option value="note">${t('knowledge.operator.actions.note')}</option>
                </select>
              </div>
              <button class="adm-btn" onClick=${() => submitReview(pkg.package_id)}>Submit Review</button>
            </div>
          `}
        </div>
      `)}
    </div>
  `;
}
```

**Step 3: Register in admin.js**

Add import and tab entry to `aimeat/public/views/admin.js` NAV_GROUPS.

**Step 4: Commit**

```bash
git add aimeat/public/views/admin/knowledge-tab.js aimeat/public/views/admin.js aimeat/public/js/services/admin.js
git commit -m "feat(knowledge): add admin dashboard Knowledge tab for operator moderation"
```

---

## Task 5: Update Knowledge Tab — Organisms and Shared With Me

**Files:**
- Modify: `aimeat/public/js/services/knowledge.js` (add organism + shared methods)
- Modify: `aimeat/public/views/profile/knowledge-tab.js` (populate placeholder sections)

**Step 1: Add service methods**

Add to `knowledge.js`:

```javascript
export async function listOrganismPackages(organismId) {
  return apiGet(`/v1/packages/organism/${encodeURIComponent(organismId)}`);
}

export async function contributeToOrganism(packageId, organismId) {
  return apiPost(`/v1/packages/${encodeURIComponent(packageId)}/contribute`, { organism_id: organismId });
}

export async function getPackageReputation(packageId) {
  return apiGet(`/v1/packages/${encodeURIComponent(packageId)}/reputation`);
}

export async function getPackageReviews(packageId) {
  return apiGet(`/v1/packages/${encodeURIComponent(packageId)}/reviews`);
}
```

**Step 2: Populate the Organisms and Shared With Me sections**

In the Knowledge tab, add state and loading for organisms the user belongs to. Use the existing organism listing from the session or load via API, then for each organism, check if it has shared knowledge packages.

For "Shared With Me" — list consent grants where the user is the recipient and the data pattern matches `packages/*`.

**Step 3: Test in browser**

Verify both sections load and display correctly (may be empty without test data).

**Step 4: Commit**

```bash
git add aimeat/public/js/services/knowledge.js aimeat/public/views/profile/knowledge-tab.js
git commit -m "feat(knowledge): populate Organisms and Shared With Me sections in Knowledge tab"
```

---

## Task 6: E2E Tests for Phase 4

**Files:**
- Modify: `aimeat/test/e2e-knowledge.ts` (add operator review and reputation tests)

**Step 1: Add Phase 4 tests**

```typescript
console.log('\nPhase 4: Quality and Moderation');

await test('Get package reputation signals', async () => {
  const { status, body } = await json(`/v1/packages/${testPackageId}/reputation`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.clone_count !== undefined, 'Expected clone_count');
  assert(body.data?.flag_count !== undefined, 'Expected flag_count');
});

await test('Operator can list packages for review', async () => {
  const { status, body } = await json('/v1/admin/knowledge', {
    headers: { Authorization: `Bearer ${ownerToken}` }, // First owner is operator
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(body.data?.packages), 'Expected packages array');
});

await test('Operator can review a package', async () => {
  const { status, body } = await json(`/v1/admin/knowledge/${testPackageId}/review`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({
      reason: 'routine_review',
      action: 'approve',
    }),
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.review_id, 'Expected review_id');
});

await test('Package owner can see operator reviews', async () => {
  const { status, body } = await json(`/v1/packages/${testPackageId}/reviews`, {
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.count >= 1, 'Expected at least 1 review');
  assert(body.data?.reviews[0]?.action === 'approve', 'Expected approve action');
});
```

**Step 2: Run tests**

Run: `cd aimeat && npx tsx test/e2e-knowledge.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add aimeat/test/e2e-knowledge.ts
git commit -m "test(knowledge): add Phase 4 E2E tests for reputation and operator review"
```

---

## Phase 4 Complete

After completing all 6 tasks, you have:
- Organism knowledge contribution and listing
- Reputation/quality signals endpoint (clone count, flag count, citation quality)
- Operator review system with reason codes and actions (approve, flag, delist, restrict, note)
- Transparent audit logging — owner sees all operator reviews
- Admin dashboard Knowledge tab for moderation
- Knowledge tab Organisms and Shared With Me sections populated
- E2E tests for reputation and operator review

**Next:** [Phase 5: Federation and Semantics](05-federation-and-semantics.md)
