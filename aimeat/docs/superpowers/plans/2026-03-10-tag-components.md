# Tag Components Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add shared TagCloud + TagEditor components, enable tag editing on existing files/memories, and add tag-based filtering in the portfolio builder.

**Architecture:** Two reusable Preact+HTM components (`TagCloud`, `TagEditor`) in `public/js/components/`. A new `PATCH /v1/memory/files/:key` endpoint for file tag updates. Memory tag updates use existing `PUT /v1/memory/:key`. Portfolio catalog extended to include file tags. All tag CSS extracted to a shared stylesheet.

**Tech Stack:** Preact + HTM (no build step), Express 5 routes, SQLite/MongoDB storage providers.

**Spec:** `docs/superpowers/specs/2026-03-10-tag-components-design.md`

---

## Chunk 1: Backend + Shared Components

### Task 1: Add `updateFileTagsById` to storage layer

**Files:**
- Modify: `src/storage/repositories/file.repository.ts:1-12`
- Modify: `src/storage/providers/sqlite/index.ts:1164-1214`
- Modify: `src/storage/providers/mongodb/index.ts:1076+`

- [ ] **Step 1: Add method to FileRepository interface**

In `src/storage/repositories/file.repository.ts`, add after line 7 (`deleteStorageFile`):

```typescript
  updateFileTagsByKey(ownerGaii: string, key: string, tags: string[]): Promise<StorageFileRecord | null>;
```

- [ ] **Step 2: Implement in SQLite provider**

In `src/storage/providers/sqlite/index.ts`, add after the `deleteStorageFile` method (after line 1214):

```typescript
  async updateFileTagsByKey(ownerGaii: string, key: string, tags: string[]): Promise<StorageFileRecord | null> {
    const result = this.db.prepare(
      'UPDATE storage_files SET tags = ? WHERE ownerGaii = ? AND key = ?'
    ).run(JSON.stringify(tags), ownerGaii, key);
    if (result.changes === 0) return null;
    return this.getStorageFile(ownerGaii, key);
  }
```

- [ ] **Step 3: Implement in MongoDB provider**

In `src/storage/providers/mongodb/index.ts`, add after the `deleteStorageFile` method:

```typescript
  async updateFileTagsByKey(ownerGaii: string, key: string, tags: string[]): Promise<StorageFileRecord | null> {
    this.ensureReady();
    const updated = await this.prisma.storageFile.updateMany({
      where: { ownerGaii, key },
      data: { tags },
    });
    if (updated.count === 0) return null;
    return this.getStorageFile(ownerGaii, key);
  }
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Clean compile, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/storage/repositories/file.repository.ts src/storage/providers/sqlite/index.ts src/storage/providers/mongodb/index.ts
git commit -m "feat: add updateFileTagsByKey to storage layer"
```

---

### Task 2: Add PATCH /v1/memory/files/:key endpoint

**Files:**
- Modify: `src/routes/memory.ts:305` (after POST /v1/memory/files response)

- [ ] **Step 1: Add PATCH route**

In `src/routes/memory.ts`, add after the POST `/v1/memory/files` handler (after line 305), before the GET `/v1/memory/files` handler:

```typescript
  // PATCH /v1/memory/files/:key — update file tags
  router.patch('/v1/memory/files/:key', requireAuth(), requireRole('agent'), async (req, res) => {
    const gaii = req.auth!.sub;
    const key = req.params.key as string;
    const { tags } = req.body ?? {};

    if (!Array.isArray(tags)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'tags must be an array of strings'));
      return;
    }

    if (tags.length > 20 || tags.some((t: unknown) => typeof t !== 'string' || (t as string).length > 64)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Max 20 tags, each max 64 characters'));
      return;
    }

    const updated = await storage.updateFileTagsByKey(gaii, key, tags);
    if (!updated) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'File not found'));
      return;
    }

    res.json(success(config.nodeId, {
      key: updated.key,
      size: updated.size,
      mime_type: updated.mimeType,
      visibility: updated.visibility,
      tags: updated.tags || [],
      created_at: updated.createdAt,
    }));
  });
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Clean compile.

- [ ] **Step 3: Commit**

```bash
git add src/routes/memory.ts
git commit -m "feat: add PATCH /v1/memory/files/:key for tag updates"
```

---

### Task 3: Include tags in portfolio catalog image entries

**Files:**
- Modify: `src/routes/portfolio.ts:24-37`

- [ ] **Step 1: Add tags to image entries**

In `src/routes/portfolio.ts`, update the images type and the push call (lines 24-37):

Change:
```typescript
    const images: Array<{ key: string; gaii: string; mimeType: string; size: number; url: string }> = [];
```
To:
```typescript
    const images: Array<{ key: string; gaii: string; mimeType: string; size: number; url: string; tags: string[] }> = [];
```

And change the `images.push({` block to include tags:
```typescript
          images.push({
            key: f.key,
            gaii: agent.gaii,
            mimeType: f.mimeType,
            size: f.size,
            url: `/v1/pub/${encodeURIComponent(agent.gaii)}/${encodeURIComponent(f.key)}`,
            tags: f.tags || [],
          });
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Clean compile.

- [ ] **Step 3: Commit**

```bash
git add src/routes/portfolio.ts
git commit -m "feat: include tags in portfolio catalog image entries"
```

---

### Task 4: Create shared TagCloud component

**Files:**
- Create: `public/js/components/tag-cloud.js`

- [ ] **Step 1: Create the component file**

Create `public/js/components/tag-cloud.js`:

```javascript
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

/**
 * TagCloud — clickable tag filter pills.
 * @param {Object} props
 * @param {string[]} props.tags — all available tags (will be sorted)
 * @param {Set<string>} props.selected — currently active filter tags
 * @param {(tag: string) => void} props.onToggle — called when a tag is clicked
 * @param {() => void} props.onClear — called when clear button is clicked
 */
export default function TagCloud({ tags, selected, onToggle, onClear }) {
  if (!tags || tags.length === 0) return null;
  const sorted = [...tags].sort();
  return html`
    <div class="tag-cloud">
      ${sorted.map(tag => html`
        <button key=${tag}
          class="tag-pill ${selected.has(tag) ? 'active' : ''}"
          onClick=${() => onToggle(tag)}>
          ${tag}
        </button>
      `)}
      ${selected.size > 0 && html`
        <button class="tag-pill tag-clear" onClick=${onClear}>\u2715 ${t('tags.clear') || 'Clear'}</button>
      `}
    </div>
  `;
}
```

- [ ] **Step 2: Commit**

```bash
git add public/js/components/tag-cloud.js
git commit -m "feat: add shared TagCloud component"
```

---

### Task 5: Create shared TagEditor component

**Files:**
- Create: `public/js/components/tag-editor.js`

- [ ] **Step 1: Create the component file**

Create `public/js/components/tag-editor.js`:

```javascript
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

/**
 * TagEditor — inline add/remove tag pills with input.
 * @param {Object} props
 * @param {string[]} props.tags — current tags on the item
 * @param {(tags: string[]) => void} props.onSave — called with updated tag array on add/remove
 * @param {number} [props.maxTags=20] — maximum tags allowed
 */
export default function TagEditor({ tags, onSave, maxTags = 20 }) {
  const [input, setInput] = useState('');

  const addTag = () => {
    const val = input.trim().slice(0, 64);
    if (!val || tags.includes(val) || tags.length >= maxTags) return;
    onSave([...tags, val]);
    setInput('');
  };

  const removeTag = (tag) => {
    onSave(tags.filter(t => t !== tag));
  };

  return html`
    <div class="tag-editor">
      <div class="tag-editor-pills">
        ${tags.map(tag => html`
          <span class="tag-pill active" key=${tag} onClick=${() => removeTag(tag)}>
            ${tag} \u2715
          </span>
        `)}
      </div>
      <div class="tag-editor-input">
        <input type="text" class="input-field" placeholder=${t('tags.addPlaceholder') || 'Add tag...'}
          value=${input} onInput=${e => setInput(e.target.value)}
          onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
          maxlength="64" />
        <button type="button" class="btn-sm" onClick=${addTag} disabled=${!input.trim() || tags.length >= maxTags}>+</button>
      </div>
    </div>
  `;
}
```

- [ ] **Step 2: Commit**

```bash
git add public/js/components/tag-editor.js
git commit -m "feat: add shared TagEditor component"
```

---

### Task 6: Create shared tag CSS

**Files:**
- Create: `public/css/components/tags.css`

- [ ] **Step 1: Create the stylesheet**

Create `public/css/components/tags.css`:

```css
/* ── Shared Tag Components ── */

.tag-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding: 0.5rem 0;
}

.tag-pill {
  font-size: 0.75rem;
  padding: 3px 10px;
  border-radius: 12px;
  border: 1px solid var(--border, rgba(255,107,157,0.25));
  background: transparent;
  color: var(--text, #e8d5f5);
  cursor: pointer;
  transition: all 0.2s;
}

.tag-pill:hover {
  border-color: var(--love1, #ff6b9d);
  background: rgba(255,107,157,0.1);
}

.tag-pill.active {
  background: var(--love1, #ff6b9d);
  color: #fff;
  border-color: var(--love1, #ff6b9d);
}

.tag-clear {
  color: var(--muted, #c4a6d0);
  font-style: italic;
}

.tag-clear.active {
  background: transparent;
  color: var(--muted, #c4a6d0);
  border-color: var(--border, rgba(255,107,157,0.25));
}

/* ── Tag Editor ── */

.tag-editor {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.tag-editor-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.tag-editor-input {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.tag-editor-input input {
  flex: 1;
  font-size: 0.8rem;
  padding: 3px 8px;
}
```

- [ ] **Step 2: Include the stylesheet in the HTML pages that use tags**

Add `<link rel="stylesheet" href="/css/components/tags.css">` to:
- `public/human.html` (profile page)
- `public/profile.html` (if separate)

Search for existing CSS link tags in these files and add the new one alongside them.

- [ ] **Step 3: Commit**

```bash
git add public/css/components/tags.css public/human.html public/profile.html
git commit -m "feat: add shared tag component CSS"
```

---

### Task 7: Add memory service functions for tag updates

**Files:**
- Modify: `public/js/services/memory.js:31-37`

- [ ] **Step 1: Add updateMemoryTags and updateFileTags functions**

In `public/js/services/memory.js`, add after the existing `updateMemory` function (after line 37):

```javascript
/** Update tags on a memory entry. */
export async function updateMemoryTags(key, tags) {
  return api(`/v1/memory/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ tags }),
  });
}

/** Update tags on a file. */
export async function updateFileTags(key, tags) {
  return api(`/v1/memory/files/${encodeURIComponent(key)}`, {
    method: 'PATCH',
    body: JSON.stringify({ tags }),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add public/js/services/memory.js
git commit -m "feat: add updateMemoryTags and updateFileTags service functions"
```

---

### Task 8: Add i18n keys

**Files:**
- Modify: `locales/en.json`
- Modify: `locales/fi.json`

- [ ] **Step 1: Add English translations**

In `locales/en.json`, add under an appropriate section (or create a `"tags"` section):

```json
"tags": {
  "clear": "Clear",
  "addPlaceholder": "Add tag...",
  "editTags": "Edit tags",
  "noMatch": "No items match selected tags"
}
```

- [ ] **Step 2: Add Finnish translations**

In `locales/fi.json`, add:

```json
"tags": {
  "clear": "Tyhjennä",
  "addPlaceholder": "Lisää tagi...",
  "editTags": "Muokkaa tageja",
  "noMatch": "Ei tuloksia valituilla tageilla"
}
```

- [ ] **Step 3: Commit**

```bash
git add locales/en.json locales/fi.json
git commit -m "feat: add i18n keys for tag components"
```

---

## Chunk 2: Frontend Integration

### Task 9: Add TagCloud + TagEditor to memory tab — Entries section

**Files:**
- Modify: `public/views/profile/memory-tab.js:1-10` (imports), `113-166` (renderEntries)

- [ ] **Step 1: Add imports**

At the top of `public/views/profile/memory-tab.js`, add after the existing imports (after line 10):

```javascript
import TagCloud from '/js/components/tag-cloud.js';
import TagEditor from '/js/components/tag-editor.js';
```

- [ ] **Step 2: Add state for memory tag filter and editing**

Inside the `MemoryTab` component, add after the existing state declarations (after line 21 — `keyRulesPopover`):

```javascript
  const [memTagFilter, setMemTagFilter] = useState(new Set());
  const [editingMemTags, setEditingMemTags] = useState(null); // key of memory being tag-edited
```

- [ ] **Step 3: Add tag update handler**

After the `loadKeyPerms` function (after line 111), add:

```javascript
  async function handleUpdateMemoryTags(key, tags) {
    const resp = await memoryService.updateMemoryTags(key, tags);
    if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
    loadMemories();
  }
```

- [ ] **Step 4: Rewrite renderEntries to include TagCloud and TagEditor**

Replace the `renderEntries` function (lines 113-166) with:

```javascript
  const renderEntries = () => {
    const searchRef = useRef(null);
    if (!memories) return html`<${Spinner} text=${t('profile.memory.loading')} />`;

    // Collect all unique tags across memories
    const allMemTags = new Set();
    for (const m of memories) {
      if (m.tags) for (const tag of m.tags) allMemTags.add(tag);
    }

    // Filter by selected tags
    const filtered = memTagFilter.size === 0 ? memories : memories.filter(m =>
      m.tags && [...memTagFilter].every(tag => m.tags.includes(tag))
    );

    const toggleMemTag = (tag) => {
      setMemTagFilter(prev => {
        const next = new Set(prev);
        if (next.has(tag)) next.delete(tag); else next.add(tag);
        return next;
      });
    };

    return html`
      <div class="action-bar">
        <div class="search-bar">
          <input type="text" ref=${searchRef} class="input-field" placeholder=${t('profile.memory.search')} onKeyDown=${e => e.key === 'Enter' && handleSearch(e.target.value)} />
          <button class="btn-sm" onClick=${() => handleSearch(searchRef.current?.value)}>${t('profile.memory.searchBtn')}</button>
          <button class="btn-sm btn-outline" onClick=${() => { if (searchRef.current) searchRef.current.value = ''; loadMemories(); }}>${t('profile.memory.clearBtn')}</button>
        </div>
        <button class="btn-primary" onClick=${() => setShowMemForm(!showMemForm)}>${t('profile.memory.newBtn')}</button>
      </div>
      <${TagCloud} tags=${[...allMemTags]} selected=${memTagFilter} onToggle=${toggleMemTag} onClear=${() => setMemTagFilter(new Set())} />
      ${showMemForm && html`<${MemoryForm} onSave=${handleCreateMemory} onCancel=${() => setShowMemForm(false)} />`}
      ${filtered.length === 0
        ? html`<div class="empty">${memories.length > 0 ? (t('tags.noMatch') || 'No items match selected tags') : t('profile.memory.empty')}</div>`
        : filtered.map(m => html`
          <div>
            <div class="mem-item" onClick=${() => setExpandedMem(expandedMem === m.key ? null : m.key)}>
              <span class="mem-key">${escHtml(m.key)}</span>
              <span class="mem-vis badge ${m.visibility === 'public' ? 'badge-success' : m.visibility === 'shared' ? 'badge-info' : 'badge-muted'}">${m.visibility || 'private'}</span>
              <span class="shield-icon" title=${t('permissions.sharingRules')} onClick=${(e) => { e.stopPropagation(); loadKeyPerms(m.key); }}>\u{1F6E1}\uFE0F</span>
            </div>
            ${expandedMem === m.key && html`
              <div class="mem-detail">
                <pre>${escHtml(typeof m.value === 'object' ? JSON.stringify(m.value, null, 2) : String(m.value || ''))}</pre>
                <div style="margin-top:.5rem">
                  <button class="btn-sm btn-outline" style="font-size:.7rem" onClick=${(e) => { e.stopPropagation(); setEditingMemTags(editingMemTags === m.key ? null : m.key); }}>
                    ${t('tags.editTags') || 'Edit tags'}
                  </button>
                </div>
                ${editingMemTags === m.key && html`
                  <div style="margin-top:.5rem">
                    <${TagEditor} tags=${m.tags || []} onSave=${(tags) => handleUpdateMemoryTags(m.key, tags)} />
                  </div>
                `}
                ${editingMemTags !== m.key && m.tags?.length > 0 && html`<div style="margin-top:.5rem;font-size:.75rem;color:var(--muted)">${m.tags.join(', ')}</div>`}
                ${keyRulesPopover && keyRulesPopover.key === m.key && html`
                  <div class="key-rules-box">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem">
                      <strong style="font-size:.85rem">\u{1F6E1}\uFE0F ${t('permissions.sharingRules')}</strong>
                      <button class="btn-sm btn-outline" onClick=${() => setKeyRulesPopover(null)}>\u2715</button>
                    </div>
                    <div style="font-size:.75rem;color:var(--muted);margin-bottom:.5rem">Visibility: ${keyRulesPopover.visibility}</div>
                    ${keyRulesPopover.rules.length === 0
                      ? html`<div style="font-size:.8rem;color:var(--muted);font-style:italic">${t('permissions.noRules')}</div>`
                      : keyRulesPopover.rules.map(r => html`
                        <div style="display:flex;gap:.5rem;align-items:center;padding:4px 0;border-bottom:1px solid var(--border)">
                          ${recipientBadge(r.recipient)}
                          <span style="font-family:monospace;font-size:.75rem">${escHtml(r.data_pattern)}</span>
                          <span style="font-size:.75rem;color:var(--muted);margin-left:auto">${escHtml(r.scope || '-')}</span>
                        </div>`)
                    }
                  </div>
                `}
                <div class="mem-actions">
                  <button class="btn-sm" onClick=${() => setEditModal({ key: m.key, value: typeof m.value === 'object' ? JSON.stringify(m.value, null, 2) : String(m.value || '') })}>${t('profile.memory.editBtn')}</button>
                  <button class="btn-danger" onClick=${() => handleDeleteMemory(m.key)}>${t('profile.memory.deleteBtn')}</button>
                </div>
              </div>
            `}
          </div>
        `)
      }`;
  };
```

- [ ] **Step 5: Commit**

```bash
git add public/views/profile/memory-tab.js
git commit -m "feat: add TagCloud + TagEditor to memory entries section"
```

---

### Task 10: Add TagEditor to memory tab — Files section

**Files:**
- Modify: `public/views/profile/memory-tab.js:170-239` (renderFilesList)

- [ ] **Step 1: Add state for file tag editing**

Inside the `MemoryTab` component, add after the `editingMemTags` state (near the other state declarations):

```javascript
  const [editingFileTags, setEditingFileTags] = useState(null); // key of file being tag-edited
```

- [ ] **Step 2: Add file tag update handler**

After the `handleUpdateMemoryTags` function, add:

```javascript
  async function handleUpdateFileTags(key, tags) {
    const resp = await memoryService.updateFileTags(key, tags);
    if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
    loadFiles();
  }
```

- [ ] **Step 3: Replace inline tag cloud with TagCloud component and add TagEditor to file cards**

In `renderFilesList`, replace the inline tag cloud block (lines 203-216) with:

```javascript
      <${TagCloud} tags=${[...allTags]} selected=${fileTagFilter} onToggle=${toggleTag} onClear=${() => setFileTagFilter(new Set())} />
```

And in the file card rendering (around line 229-234), add TagEditor after the file-tags display. Replace the file card `div` content with:

```javascript
              return html`
                <div class="file-card">
                  <div class="file-icon">${icon}</div>
                  <div class="file-info">
                    <div class="file-name">${escHtml(f.key || f.name)}</div>
                    <div class="file-meta">${f.size ? Math.round(f.size / 1024) + ' KB' : ''} \u2502 ${f.visibility || 'private'}</div>
                    ${editingFileTags === (f.key || f.name)
                      ? html`<${TagEditor} tags=${f.tags || []} onSave=${(tags) => handleUpdateFileTags(f.key || f.name, tags)} />`
                      : html`
                        ${f.tags?.length > 0 && html`<div class="file-tags">${f.tags.map(tag => html`<span class="file-tag" key=${tag}>${escHtml(tag)}</span>`)}</div>`}
                        <button class="btn-sm btn-outline" style="font-size:.65rem;margin-top:.25rem;padding:1px 6px" onClick=${() => setEditingFileTags(f.key || f.name)}>
                          ${t('tags.editTags') || 'Edit tags'}
                        </button>
                      `}
                  </div>
                  <div class="file-actions">
                    <a class="btn-sm" href="${NODE_URL}/v1/memory/files/${encodeURIComponent(f.key || f.name)}" target="_blank" style="text-decoration:none">${t('profile.files.download')}</a>
                    <button class="btn-danger" onClick=${() => handleDeleteFile(f.key || f.name)}>${t('profile.files.delete')}</button>
                  </div>
                </div>`;
```

- [ ] **Step 4: Commit**

```bash
git add public/views/profile/memory-tab.js
git commit -m "feat: add TagEditor to file cards + replace inline tag cloud"
```

---

### Task 11: Add TagCloud filtering to portfolio builder — Images section

**Files:**
- Modify: `public/views/portfolio.js:1-10` (imports), `225-229` (state), `429-444` (images section)

- [ ] **Step 1: Add imports**

At the top of `public/views/portfolio.js`, add after line 6 (`import { apiGet, apiPut } from '/js/api.js';`):

```javascript
import TagCloud from '/js/components/tag-cloud.js';
```

- [ ] **Step 2: Add state for image tag filter**

After the existing `selectedMemories` state (line 229), add:

```javascript
  const [imageTagFilter, setImageTagFilter] = useState(new Set());
  const [memoryTagFilter, setMemoryTagFilter] = useState(new Set());
```

- [ ] **Step 3: Update the images section to include TagCloud and filtering**

Replace the images block (lines 429-444) with:

```javascript
          ${catalog.images.length > 0 && html`
            <details class="portfolio-source-group" open>
              <summary>${t('portfolio.builder.imagesGroup')} (${catalog.images.length})</summary>
              ${(() => {
                const allImgTags = new Set();
                for (const img of catalog.images) {
                  if (img.tags) for (const tag of img.tags) allImgTags.add(tag);
                }
                const filteredImgs = imageTagFilter.size === 0 ? catalog.images : catalog.images.filter(img =>
                  img.tags && [...imageTagFilter].every(tag => img.tags.includes(tag))
                );
                const toggleImgTag = (tag) => {
                  setImageTagFilter(prev => {
                    const next = new Set(prev);
                    if (next.has(tag)) next.delete(tag); else next.add(tag);
                    return next;
                  });
                };
                return html`
                  <${TagCloud} tags=${[...allImgTags]} selected=${imageTagFilter} onToggle=${toggleImgTag} onClear=${() => setImageTagFilter(new Set())} />
                  <div class="portfolio-source-list">
                    ${filteredImgs.map(img => html`
                      <div class="portfolio-source-item portfolio-img-item">
                        <input type="checkbox" id=${'img-' + img.key} checked=${selectedImages.has(img.key)}
                          onChange=${() => toggleSet(setSelectedImages, img.key)} />
                        <img class="portfolio-img-thumb" src=${img.url} alt=${img.key} loading="lazy" onError=${handleImgError} />
                        <label for=${'img-' + img.key}>${img.key}</label>
                        <span class="portfolio-source-meta">${Math.round(img.size / 1024)}KB \u00B7 ${img.mimeType.split('/')[1]}</span>
                      </div>
                    `)}
                    ${filteredImgs.length === 0 && imageTagFilter.size > 0 && html`
                      <div style="padding:.5rem;font-size:.8rem;color:var(--text-dim)">${t('tags.noMatch') || 'No items match selected tags'}</div>
                    `}
                  </div>
                `;
              })()}
            </details>
          `}
```

- [ ] **Step 4: Commit**

```bash
git add public/views/portfolio.js
git commit -m "feat: add TagCloud filtering to portfolio builder images"
```

---

### Task 12: Add TagCloud filtering to portfolio builder — Memories section

**Files:**
- Modify: `public/views/portfolio.js:494-514` (memories section)

- [ ] **Step 1: Update the memories section to include TagCloud and filtering**

Replace the memories block (lines 494-514) with:

```javascript
          ${catalog.memories.length > 0 && html`
            <details class="portfolio-source-group">
              <summary>${t('portfolio.builder.memoriesGroup')} (${catalog.memories.length})</summary>
              ${(() => {
                const allMemTags = new Set();
                for (const mem of catalog.memories) {
                  if (mem.tags) for (const tag of mem.tags) allMemTags.add(tag);
                }
                const filteredMems = memoryTagFilter.size === 0 ? catalog.memories : catalog.memories.filter(mem =>
                  mem.tags && [...memoryTagFilter].every(tag => mem.tags.includes(tag))
                );
                const toggleMemTag = (tag) => {
                  setMemoryTagFilter(prev => {
                    const next = new Set(prev);
                    if (next.has(tag)) next.delete(tag); else next.add(tag);
                    return next;
                  });
                };
                return html`
                  <${TagCloud} tags=${[...allMemTags]} selected=${memoryTagFilter} onToggle=${toggleMemTag} onClear=${() => setMemoryTagFilter(new Set())} />
                  <div class="portfolio-source-list">
                    ${filteredMems.map(mem => {
                      const displayKey = formatMemoryKey(mem.key);
                      return html`
                        <div class="portfolio-mem-item">
                          <div class="portfolio-mem-header">
                            <input type="checkbox" id=${'mem-' + mem.key} checked=${selectedMemories.has(mem.key)}
                              onChange=${() => toggleSet(setSelectedMemories, mem.key)} />
                            <label for=${'mem-' + mem.key} title=${mem.key}>${displayKey}</label>
                            <span class="portfolio-source-meta">${mem.visibility}</span>
                          </div>
                          ${mem.preview && html`<p class="portfolio-mem-preview">${mem.preview}</p>`}
                        </div>
                      `;
                    })}
                    ${filteredMems.length === 0 && memoryTagFilter.size > 0 && html`
                      <div style="padding:.5rem;font-size:.8rem;color:var(--text-dim)">${t('tags.noMatch') || 'No items match selected tags'}</div>
                    `}
                  </div>
                `;
              })()}
            </details>
          `}
```

- [ ] **Step 2: Commit**

```bash
git add public/views/portfolio.js
git commit -m "feat: add TagCloud filtering to portfolio builder memories"
```

---

### Task 13: Include tags.css in portfolio page

**Files:**
- Modify: Portfolio HTML file that loads portfolio.css

- [ ] **Step 1: Find and update the HTML file**

Search for where `portfolio.css` is linked (likely in `public/profile.html` or wherever the portfolio view is loaded). Add the shared tags CSS link:

```html
<link rel="stylesheet" href="/css/components/tags.css">
```

- [ ] **Step 2: Verify TypeScript compiles and do final check**

Run: `npx tsc --noEmit`
Expected: Clean compile.

- [ ] **Step 3: Commit**

```bash
git add public/profile.html
git commit -m "feat: include tags.css in portfolio/profile pages"
```

---

### Task 14: Final verification

- [ ] **Step 1: Run TypeScript type check**

Run: `npx tsc --noEmit`
Expected: Clean compile, no errors.

- [ ] **Step 2: Start dev server and test manually**

Run: `pnpm dev`

Test:
1. Go to profile → Memory tab → Entries: verify tag cloud appears, tags can be filtered, "Edit tags" button works
2. Go to profile → Memory tab → Files: verify tag cloud uses shared component, "Edit tags" button appears on file cards
3. Go to portfolio builder: verify Images section has tag cloud filtering, Memories section has tag cloud filtering

- [ ] **Step 3: Run API tests**

Run: `npx tsx test/api-full.ts`
Expected: All tests pass.
