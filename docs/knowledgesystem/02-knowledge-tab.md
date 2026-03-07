# Phase 2: Knowledge Tab UI

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the Knowledge tab in the profile SPA — action bar with prompt copy buttons, import box with preview/validation, my knowledge list, and basic package management.

**Architecture:** New Preact + HTM tab component following the existing profile tab pattern (`memory-tab.js` as reference). New frontend API service (`knowledge.js`). CSS added to existing `profile.css` with `kpkg-*` prefix. The tab communicates with Phase 1's backend routes.

**Tech Stack:** Preact, HTM (tagged templates), no build step, native ESM. API calls via `/js/api.js` wrapper.

**Depends on:** Phase 1 (backend routes, types, i18n keys)

---

## Task 1: Frontend API Service

**Files:**
- Create: `aimeat/public/js/services/knowledge.js`

**Step 1: Create the service file**

Create `aimeat/public/js/services/knowledge.js` following the pattern from `memory.js`:

```javascript
import { apiGet, apiPost, apiDelete } from '/js/api.js';

/* ── Package Import ── */

export async function importPackage(pkg, overrides = {}) {
  return apiPost('/v1/packages/import', { package: pkg, overrides });
}

/* ── Package CRUD (via memory API) ── */

export async function listMyPackages() {
  const data = await apiGet('/v1/memory?prefix=packages/&tags=knowledge-package');
  const entries = data?.data?.entries || data?.data || [];
  return Array.isArray(entries) ? entries : [];
}

export async function getPackage(packageId) {
  return apiGet(`/v1/packages/${encodeURIComponent(packageId)}`);
}

export async function deletePackage(ownerGaii, packageId) {
  // Delete manifest + all entries under this package prefix
  const prefix = `packages/${packageId}/`;
  const entries = await apiGet(`/v1/memory?prefix=${encodeURIComponent(prefix)}`);
  const list = entries?.data?.entries || entries?.data || [];
  const results = [];
  for (const entry of list) {
    results.push(await apiDelete(`/v1/memory/${encodeURIComponent(entry.key)}`));
  }
  return results;
}

/* ── Links ── */

export async function listLinks(packageId, direction = 'both') {
  return apiGet(`/v1/packages/${encodeURIComponent(packageId)}/links?direction=${direction}`);
}

export async function createLink(packageId, target, relation, description) {
  return apiPost(`/v1/packages/${encodeURIComponent(packageId)}/link`, { target, relation, description });
}

export async function deleteLink(packageId, target) {
  return apiDelete(`/v1/packages/${encodeURIComponent(packageId)}/link`, { target });
}

/* ── Prompt Templates ── */

export async function getHumanPrompt() {
  return apiGet('/v1/templates/knowledge-packager-human');
}

export async function getAgentPrompt() {
  return apiGet('/v1/templates/knowledge-packager-agent');
}

/* ── Export ── */

export async function exportPackage(packageId, format = 'json') {
  return apiGet(`/v1/packages/${encodeURIComponent(packageId)}/export?format=${format}`);
}
```

**Step 2: Commit**

```bash
git add aimeat/public/js/services/knowledge.js
git commit -m "feat(knowledge): add frontend API service for knowledge packages"
```

---

## Task 2: Knowledge Tab Component — Shell and Action Bar

**Files:**
- Create: `aimeat/public/views/profile/knowledge-tab.js`

**Step 1: Create the tab component shell with action bar**

Create `aimeat/public/views/profile/knowledge-tab.js`:

```javascript
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Spinner } from './shared.js';
import * as knowledgeService from '/js/services/knowledge.js';

export default function KnowledgeTab({ session, showToast, onStats }) {
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importText, setImportText] = useState('');
  const [importPreview, setImportPreview] = useState(null);
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);

  const ghii = session?.ghii || session?.owner || '';
  const nodeUrl = window.location.origin;
  const nodeId = session?.nodeId || '';

  const loadPackages = useCallback(async () => {
    try {
      setLoading(true);
      const list = await knowledgeService.listMyPackages();
      setPackages(list);
      onStats?.({ knowledge: list.length });
    } catch { setPackages([]); }
    finally { setLoading(false); }
  }, [onStats]);

  useEffect(() => { loadPackages(); }, [loadPackages]);

  /* ── Copy Prompt to Clipboard ── */
  const copyPrompt = useCallback(async (type) => {
    try {
      const resp = type === 'human'
        ? await knowledgeService.getHumanPrompt()
        : await knowledgeService.getAgentPrompt();
      const text = resp?.data?.prompt;
      if (text) {
        await navigator.clipboard.writeText(text);
        showToast(t('knowledge.actionBar.copy' + (type === 'human' ? 'HumanPrompt' : 'AgentPrompt')) + ' ✓');
      } else {
        showToast('Prompt template not available yet');
      }
    } catch (err) {
      showToast('Failed to copy prompt');
    }
  }, [showToast]);

  /* ── Import: Parse pasted text ── */
  const handleImportPaste = useCallback((text) => {
    setImportText(text);
    setImportError('');
    setImportPreview(null);

    if (!text.trim()) return;

    try {
      // Try to extract JSON from code block or raw text
      let jsonStr = text;
      const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (codeBlockMatch) jsonStr = codeBlockMatch[1];

      const parsed = JSON.parse(jsonStr.trim());

      if (!parsed.aimeat_knowledge_package && !parsed.package) {
        setImportError('This doesn\'t look like an AIMEAT knowledge package. Make sure you paste the complete JSON output.');
        return;
      }

      const pkg = parsed.package || parsed;
      const targetGhii = parsed.target_ghii || pkg.author || '';

      setImportPreview({
        raw: parsed,
        pkg,
        targetGhii,
        targetNode: parsed.target_node || '',
        ghiiMatch: !targetGhii || targetGhii === ghii,
        entryOverrides: {},
        catalogListed: pkg.sharing?.catalog_listed ?? true,
        organismShare: '',
      });
    } catch (e) {
      setImportError('Could not parse the pasted content as JSON. Make sure you copy the complete output from your AI chat.');
    }
  }, [ghii]);

  /* ── Import: Confirm ── */
  const confirmImport = useCallback(async () => {
    if (!importPreview) return;
    setImporting(true);
    try {
      const overrides = {
        entries: importPreview.entryOverrides,
        catalog_listed: importPreview.catalogListed,
        organism_share: importPreview.organismShare || undefined,
      };
      const result = await knowledgeService.importPackage(importPreview.pkg, overrides);
      if (result?.data?.package_id) {
        showToast(t('knowledge.import.success'));
        setImportText('');
        setImportPreview(null);
        loadPackages();
      } else {
        showToast(t('knowledge.import.error'));
      }
    } catch (err) {
      showToast(t('knowledge.import.error'));
    } finally { setImporting(false); }
  }, [importPreview, showToast, loadPackages]);

  /* ── Render ── */
  return html`
    <div class="kpkg-tab">

      <!-- ACTION BAR -->
      <div class="kpkg-action-bar">
        <div class="kpkg-action-buttons">
          <button class="kpkg-btn kpkg-btn-primary" onClick=${() => copyPrompt('human')}>
            ${t('knowledge.actionBar.copyHumanPrompt')}
          </button>
          <button class="kpkg-btn kpkg-btn-secondary" onClick=${() => copyPrompt('agent')}>
            ${t('knowledge.actionBar.copyAgentPrompt')}
          </button>
        </div>
        <p class="kpkg-action-desc">${t('knowledge.actionBar.description')}</p>
      </div>

      <!-- IMPORT BOX -->
      <div class="kpkg-import-box">
        <h3>${t('knowledge.import.title')}</h3>
        <textarea
          class="kpkg-import-textarea"
          placeholder=${t('knowledge.import.placeholder')}
          value=${importText}
          onInput=${(e) => handleImportPaste(e.target.value)}
          rows="4"
        />
        <p class="kpkg-import-note">${t('knowledge.import.agentNote')}</p>

        ${importError && html`<div class="kpkg-error">${importError}</div>`}

        ${importPreview && html`
          <div class="kpkg-preview">
            <h4>${t('knowledge.import.preview')}</h4>
            <div class="kpkg-preview-meta">
              <span class="kpkg-badge kpkg-badge-type">${t('knowledge.contentTypes.' + (importPreview.pkg.content_type || 'document'))}</span>
              <span class="kpkg-badge kpkg-badge-synthesis">${t('knowledge.synthesis.' + (importPreview.pkg.synthesis?.level || 'original'))}</span>
              <strong>${escHtml(importPreview.pkg.name || 'Untitled')}</strong>
            </div>

            <!-- GHII Confirmation -->
            ${importPreview.ghiiMatch
              ? html`<p class="kpkg-ghii-ok">${t('knowledge.import.ghiiConfirm').replace('{ghii}', ghii)}</p>`
              : html`<p class="kpkg-ghii-warn">${t('knowledge.import.ghiiMismatch').replace('{ghii}', importPreview.targetGhii)}</p>`
            }

            <!-- Entries with visibility -->
            <div class="kpkg-preview-entries">
              ${(importPreview.pkg.entries || []).map((entry, i) => html`
                <div class="kpkg-preview-entry" key=${i}>
                  <span class="kpkg-badge kpkg-badge-${entry.visibility}">${t('knowledge.visibility.' + entry.visibility)}</span>
                  <span>${escHtml(entry.title)}</span>
                </div>
              `)}
            </div>

            <!-- References -->
            ${(importPreview.pkg.references || []).length > 0 && html`
              <div class="kpkg-preview-refs">
                <strong>References:</strong>
                ${importPreview.pkg.references.map((ref, i) => html`
                  <div key=${i} class="kpkg-ref ${ref.verified ? 'kpkg-ref-verified' : 'kpkg-ref-unverified'}">
                    ${ref.verified ? '✓' : '?'} ${escHtml(ref.title)}
                  </div>
                `)}
              </div>
            `}

            <!-- Catalog toggle -->
            <label class="kpkg-toggle">
              <input type="checkbox"
                checked=${importPreview.catalogListed}
                onChange=${(e) => setImportPreview({ ...importPreview, catalogListed: e.target.checked })}
              />
              ${t('knowledge.import.catalogToggle')}
            </label>

            <!-- Confirm -->
            <div class="kpkg-preview-summary">
              ${t('knowledge.import.willCreate')
                .replace('{entries}', String((importPreview.pkg.entries || []).length))
                .replace('{consents}', importPreview.organismShare ? '1' : '0')}
            </div>
            <button
              class="kpkg-btn kpkg-btn-primary"
              onClick=${confirmImport}
              disabled=${importing}
            >
              ${importing ? '...' : t('knowledge.import.confirmImport')}
            </button>
          </div>
        `}
      </div>

      <!-- MY KNOWLEDGE -->
      <div class="kpkg-section">
        <h3>${t('knowledge.myKnowledge.title')}</h3>
        ${loading && html`<${Spinner} text="Loading..." />`}
        ${!loading && packages.length === 0 && html`
          <p class="kpkg-empty">${t('knowledge.myKnowledge.empty')}</p>
        `}
        ${!loading && packages.map(pkg => {
          const manifest = pkg.value;
          if (!manifest || manifest.type !== 'knowledge-package') return null;
          return html`
            <div class="kpkg-card" key=${pkg.key}>
              <div class="kpkg-card-header">
                <strong>${escHtml(manifest.name || 'Untitled')}</strong>
                <span class="kpkg-badge kpkg-badge-type">${t('knowledge.contentTypes.' + (manifest.content_type || 'document'))}</span>
                <span class="kpkg-badge kpkg-badge-synthesis">${t('knowledge.synthesis.' + (manifest.synthesis?.level || 'original'))}</span>
                <span class="kpkg-badge kpkg-badge-${manifest.maturity || 'draft'}">${t('knowledge.maturity.' + (manifest.maturity || 'draft'))}</span>
              </div>
              <div class="kpkg-card-tags">
                ${(manifest.tags || []).map(tag => html`<span class="kpkg-tag" key=${tag}>${escHtml(tag)}</span>`)}
              </div>
              <div class="kpkg-card-stats">
                <span>${t('knowledge.myKnowledge.entries').replace('{count}', String((manifest.entries || []).length))}</span>
              </div>
            </div>
          `;
        })}
      </div>

      <!-- SHARED WITH ME (placeholder for Phase 3) -->
      <div class="kpkg-section">
        <h3>${t('knowledge.sharedWithMe.title')}</h3>
        <p class="kpkg-empty">${t('knowledge.sharedWithMe.empty')}</p>
      </div>

      <!-- KNOWLEDGE ORGANISMS (placeholder for Phase 4) -->
      <div class="kpkg-section">
        <h3>${t('knowledge.organisms.title')}</h3>
        <p class="kpkg-empty">${t('knowledge.organisms.empty')}</p>
      </div>

      <!-- DISCOVER (placeholder for Phase 3) -->
      <div class="kpkg-section">
        <h3>${t('knowledge.discover.title')}</h3>
        <p class="kpkg-empty">${t('knowledge.discover.empty')}</p>
      </div>

    </div>
  `;
}
```

**Step 2: Commit**

```bash
git add aimeat/public/views/profile/knowledge-tab.js
git commit -m "feat(knowledge): add Knowledge tab component with action bar, import, and package list"
```

---

## Task 3: Register Knowledge Tab in Profile SPA

**Files:**
- Modify: `aimeat/public/views/profile.js` (add tab to TABS array)

**Step 1: Read the profile.js file**

Read `aimeat/public/views/profile.js` to find the exact TABS array structure and import section.

**Step 2: Add the import**

Add at the top with other tab imports:

```javascript
import KnowledgeTab from './profile/knowledge-tab.js';
```

**Step 3: Add to TABS array**

Add the Knowledge tab to the TABS array. Place it after Portfolio and before Agents (or wherever makes sense contextually — knowledge is a primary feature):

```javascript
{ id: 'knowledge', key: 'knowledge.tabLabel', component: KnowledgeTab },
```

**Step 4: Test in browser**

Open the profile page and verify the Knowledge tab appears and renders without errors.

**Step 5: Commit**

```bash
git add aimeat/public/views/profile.js
git commit -m "feat(knowledge): register Knowledge tab in profile SPA"
```

---

## Task 4: CSS Styles for Knowledge Tab

**Files:**
- Modify: `aimeat/public/css/views/profile.css` (append Knowledge styles)

**Step 1: Read existing profile.css**

Read `aimeat/public/css/views/profile.css` to understand the existing patterns and variables.

**Step 2: Add Knowledge tab styles**

Append to `profile.css` (all classes use `kpkg-*` prefix to avoid collisions):

```css
/* ── Knowledge Tab ── */

.kpkg-tab {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* Action Bar */
.kpkg-action-bar {
  background: var(--surface, #1a1a2e);
  border: 1px solid var(--border, #333);
  border-radius: 12px;
  padding: 1.25rem;
}

.kpkg-action-buttons {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}

.kpkg-action-desc {
  color: var(--text-muted, #888);
  font-size: 0.85rem;
  margin: 0;
}

/* Buttons */
.kpkg-btn {
  padding: 0.5rem 1rem;
  border-radius: 8px;
  border: 1px solid var(--border, #333);
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 500;
  transition: all 0.15s ease;
}

.kpkg-btn-primary {
  background: var(--accent, #6c5ce7);
  color: #fff;
  border-color: var(--accent, #6c5ce7);
}

.kpkg-btn-primary:hover { opacity: 0.9; }
.kpkg-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.kpkg-btn-secondary {
  background: transparent;
  color: var(--text, #e0e0e0);
}

.kpkg-btn-secondary:hover { background: var(--surface-hover, #252540); }

/* Import Box */
.kpkg-import-box {
  background: var(--surface, #1a1a2e);
  border: 1px solid var(--border, #333);
  border-radius: 12px;
  padding: 1.25rem;
}

.kpkg-import-box h3 { margin: 0 0 0.75rem; }

.kpkg-import-textarea {
  width: 100%;
  min-height: 80px;
  background: var(--input-bg, #0d0d1a);
  color: var(--text, #e0e0e0);
  border: 1px solid var(--border, #333);
  border-radius: 8px;
  padding: 0.75rem;
  font-family: monospace;
  font-size: 0.8rem;
  resize: vertical;
}

.kpkg-import-note {
  color: var(--text-muted, #888);
  font-size: 0.8rem;
  margin: 0.5rem 0 0;
}

.kpkg-error {
  color: var(--error, #e74c3c);
  background: rgba(231, 76, 60, 0.1);
  border: 1px solid rgba(231, 76, 60, 0.3);
  border-radius: 8px;
  padding: 0.75rem;
  margin-top: 0.75rem;
  font-size: 0.85rem;
}

/* Preview */
.kpkg-preview {
  margin-top: 1rem;
  padding: 1rem;
  background: var(--input-bg, #0d0d1a);
  border-radius: 8px;
  border: 1px solid var(--border, #333);
}

.kpkg-preview h4 { margin: 0 0 0.75rem; }

.kpkg-preview-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}

.kpkg-preview-entries {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin: 0.75rem 0;
}

.kpkg-preview-entry {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
}

.kpkg-preview-refs {
  margin: 0.75rem 0;
  font-size: 0.85rem;
}

.kpkg-ref { padding: 0.15rem 0; }
.kpkg-ref-verified { color: var(--success, #2ecc71); }
.kpkg-ref-unverified { color: var(--warning, #f39c12); }

.kpkg-ghii-ok { color: var(--success, #2ecc71); font-size: 0.85rem; }
.kpkg-ghii-warn { color: var(--warning, #f39c12); font-size: 0.85rem; }

.kpkg-preview-summary {
  color: var(--text-muted, #888);
  font-size: 0.85rem;
  margin: 0.75rem 0;
}

.kpkg-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  cursor: pointer;
  margin: 0.5rem 0;
}

/* Badges */
.kpkg-badge {
  display: inline-block;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.kpkg-badge-type { background: rgba(108, 92, 231, 0.2); color: #a29bfe; }
.kpkg-badge-synthesis { background: rgba(0, 206, 209, 0.2); color: #00ced1; }
.kpkg-badge-public { background: rgba(46, 204, 113, 0.2); color: #2ecc71; }
.kpkg-badge-private { background: rgba(231, 76, 60, 0.2); color: #e74c3c; }
.kpkg-badge-owner { background: rgba(243, 156, 18, 0.2); color: #f39c12; }
.kpkg-badge-draft { background: rgba(149, 165, 166, 0.2); color: #95a5a6; }
.kpkg-badge-review { background: rgba(243, 156, 18, 0.2); color: #f39c12; }
.kpkg-badge-published { background: rgba(46, 204, 113, 0.2); color: #2ecc71; }

/* Sections */
.kpkg-section {
  background: var(--surface, #1a1a2e);
  border: 1px solid var(--border, #333);
  border-radius: 12px;
  padding: 1.25rem;
}

.kpkg-section h3 { margin: 0 0 0.75rem; }

.kpkg-empty {
  color: var(--text-muted, #888);
  font-size: 0.85rem;
  text-align: center;
  padding: 1.5rem 0;
}

/* Package Cards */
.kpkg-card {
  background: var(--input-bg, #0d0d1a);
  border: 1px solid var(--border, #333);
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 0.75rem;
}

.kpkg-card-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.5rem;
}

.kpkg-card-tags {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
  margin-bottom: 0.5rem;
}

.kpkg-tag {
  display: inline-block;
  padding: 0.1rem 0.4rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 3px;
  font-size: 0.7rem;
  color: var(--text-muted, #888);
}

.kpkg-card-stats {
  font-size: 0.8rem;
  color: var(--text-muted, #888);
}
```

**Step 3: Commit**

```bash
git add aimeat/public/css/views/profile.css
git commit -m "feat(knowledge): add CSS styles for Knowledge tab (kpkg-* prefix)"
```

---

## Task 5: Run Type Check and Manual Test

**Step 1: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 2: Start dev server**

Run: `cd aimeat && pnpm dev`

**Step 3: Manual browser test**

1. Open the profile page in browser
2. Verify the Knowledge tab appears in the tab list
3. Click the Knowledge tab — verify it renders:
   - Action bar with two copy buttons
   - Import box with textarea
   - My Knowledge section (empty state)
   - Shared With Me section (empty state)
   - Knowledge Organisms section (empty state)
   - Discover section (empty state)
4. Click "Copy Prompt for AI Chat" — verify clipboard contains the prompt (may show toast "not available" if templates not seeded)
5. Paste some invalid text in import box — verify error message appears
6. Paste valid JSON knowledge package — verify preview panel appears with badges

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(knowledge): address manual testing feedback for Knowledge tab"
```

---

## Phase 2 Complete

After completing all 5 tasks, you have:
- Frontend API service for knowledge packages
- Knowledge tab component with action bar, import box, preview, and package list
- Tab registered in profile SPA
- CSS styles with `kpkg-*` prefix
- Manual browser testing verified

**Placeholder sections** (Shared With Me, Organisms, Discover) show empty states — they will be populated in Phase 3 and Phase 4.

**Next:** [Phase 3: Discovery and Sharing](03-discovery-and-sharing.md)
