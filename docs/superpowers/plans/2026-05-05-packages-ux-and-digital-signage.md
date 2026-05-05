# Packages UX & Digital Signage Seed Improvements

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix broken translations, add missing introductory text, fix misleading instance status labels, populate the cortex "What's included" section, and improve the digital signage seed package metadata so the packages system is clear, informative, and works end-to-end.

**Architecture:** All changes are in the frontend UI layer (`packages-tab.js`, locale files, CSS), the seed data definitions (`example-packages.ts`), and one backend label change (instance status `active` -> `installed`). The component-registrar gets a targeted fix to pass richer app metadata from packages. No new files are created. No API shape changes.

**Tech Stack:** Preact + HTM frontend (no build step), TypeScript backend, i18n via `locales/en.json` + `locales/fi.json`, CSS in `public/css/views/profile.css`.

---

## File Map

| File | Changes |
|------|---------|
| `aimeat/locales/en.json` | Remove duplicate `packages.gallery` object (line 4512-4518), add `packages.title`, `packages.desc`, `packages.featured`, category i18n keys |
| `aimeat/locales/fi.json` | Same as en.json (Finnish translations) |
| `aimeat/public/views/profile/packages-tab.js` | Add section-title/desc intro, use i18n for categories and "Featured" badge, change status badge display |
| `aimeat/public/css/views/profile.css` | Add `.pkg-badge-installed` CSS class |
| `aimeat/src/storage/interface.ts` | Change instance status type from `'active'` to `'installed'` |
| `aimeat/src/routes/instances.ts` | Change status value at creation from `'active'` to `'installed'` |
| `aimeat/src/storage/providers/sqlite/schema.ts` | Change DEFAULT from `'active'` to `'installed'` |
| `aimeat/src/storage/providers/sqlite/index.ts` | Add migration to update existing rows |
| `aimeat/src/storage/providers/mongodb/index.ts` | Change fallback default from `'active'` to `'installed'` |
| `aimeat/prisma/schema.prisma` | Change @default from `"active"` to `"installed"` |
| `openapi.yaml` | Change instance status enum from `[active, paused, removed]` to `[installed, paused, removed]` |
| `aimeat/test/e2e-packages.ts` | Update status assertion from `'active'` to `'installed'` |
| `aimeat/test/unit/package-instance-repository.test.ts` | Update status assertions and filter queries |
| `aimeat/public/css/views/admin.css` | Add `.adm-badge-installed` CSS class |
| `docs/templatesandpackages/03-specifications.md` | Update instance status enum in docs |
| `docs/packagetemplatingsystem/01-current-state-analysis.md` | Update instance status in docs |
| `aimeat/src/data/example-packages.ts` | Rewrite CORTEX_SIGNAGE manifest with proper `components:` array, add `.js` to lib filenames, add metadata section, tags |
| `aimeat/src/services/component-registrar.ts` | Pass richer app metadata from package context |

---

## Task 1: Fix duplicate `packages.gallery` translation key

The `"gallery"` key appears twice inside the `"packages"` object in both locale files. The first (line 4452) is the correct string `"Template Gallery"`. The second (line 4512-4518) is an object with unused sub-keys that shadows the string. JSON.parse keeps the last value, so `t('packages.gallery')` returns an object, falls through all lookups, and renders as the literal key text `"packages.gallery"`.

**Files:**
- Modify: `aimeat/locales/en.json:4512-4518`
- Modify: `aimeat/locales/fi.json:4512-4518`

- [ ] **Step 1: Remove duplicate gallery object from en.json**

In `aimeat/locales/en.json`, delete lines 4512-4518 (the `"gallery": { ... }` object inside `"packages"`). The correct string `"gallery": "Template Gallery"` at line 4452 must remain.

The block to remove:
```json
    "gallery": {
      "install": "Install",
      "downloadZip": "Download ZIP",
      "components": "Components",
      "rating": "Rating",
      "installs": "Installs"
    }
```

These sub-keys are dead code -- no `t('packages.gallery.install')` call exists anywhere.

- [ ] **Step 2: Remove duplicate gallery object from fi.json**

In `aimeat/locales/fi.json`, delete the same block at lines 4512-4518:
```json
    "gallery": {
      "install": "Asenna",
      "downloadZip": "Lataa ZIP",
      "components": "Komponentit",
      "rating": "Arvosana",
      "installs": "Asennukset"
    }
```

- [ ] **Step 3: Verify fix**

Run: `node -e "const j = require('./aimeat/locales/en.json'); console.log(typeof j.packages.gallery, j.packages.gallery)"`

Expected: `string Template Gallery`

If it still prints `object`, the wrong block was removed.

- [ ] **Step 4: Commit**

```bash
git add aimeat/locales/en.json aimeat/locales/fi.json
git commit -m "fix: remove duplicate packages.gallery key that broke translation"
```

---

## Task 2: Add introductory section to packages tab

Every other profile tab has a `section-title` + `section-desc` intro. The packages tab goes straight to the nav buttons. Follow the same pattern used by all other tabs (e.g., agents-tab, memory-tab, extensions-tab).

**Files:**
- Modify: `aimeat/locales/en.json` (add keys inside `"packages"` object)
- Modify: `aimeat/locales/fi.json` (add corresponding Finnish keys)
- Modify: `aimeat/public/views/profile/packages-tab.js:194-206`

- [ ] **Step 1: Add i18n keys to en.json**

Inside the `"packages"` object (after line 4433 `"packages": {`), add these two keys near the top, before `"created"`:

```json
"title": "Packages",
"desc": "Packages bundle schemas, extensions, apps, and seed data into installable units. Install ready-made packages from the gallery, browse what others have published, or create your own in the Generator.",
```

- [ ] **Step 2: Add i18n keys to fi.json**

Same position in `"packages"`:

```json
"title": "Paketit",
"desc": "Paketit kokoavat skeemoja, laajennuksia, sovelluksia ja alkuarvoja asennettaviksi kokonaisuuksiksi. Asenna valmiita paketteja galleriasta, selaa muiden julkaisuja tai luo omasi Generaattorissa.",
```

- [ ] **Step 3: Add section-title and section-desc to packages-tab.js**

In `aimeat/public/views/profile/packages-tab.js`, find the return statement that starts with `<div class="pkg-tab">` followed by `<div class="pkg-nav">` (around line 195-196). Insert the intro section between them:

Before (current):
```javascript
    <div class="pkg-tab">
      <div class="pkg-nav">
```

After:
```javascript
    <div class="pkg-tab">
      <div class="section-title">${t('packages.title')}</div>
      <div class="section-desc">${t('packages.desc')}</div>
      <div class="pkg-nav">
```

No new CSS needed -- `.section-title` and `.section-desc` are already styled in `profile.css` and work inside `.pf` context.

- [ ] **Step 4: Commit**

```bash
git add aimeat/locales/en.json aimeat/locales/fi.json aimeat/public/views/profile/packages-tab.js
git commit -m "feat: add introductory section to packages tab"
```

---

## Task 3: Add i18n for hardcoded strings in packages tab

Category dropdown options and the "Featured" badge are hardcoded English.

**Files:**
- Modify: `aimeat/locales/en.json` (add category + featured keys)
- Modify: `aimeat/locales/fi.json`
- Modify: `aimeat/public/views/profile/packages-tab.js:251-258, 321`

- [ ] **Step 1: Add i18n keys to en.json**

Inside the `"packages"` object, add:

```json
"featured": "Featured",
"categories": {
  "signage": "Signage",
  "marketplace": "Marketplace",
  "iot": "IoT",
  "social": "Social",
  "productivity": "Productivity",
  "communication": "Communication",
  "other": "Other"
},
```

- [ ] **Step 2: Add i18n keys to fi.json**

```json
"featured": "Suositeltu",
"categories": {
  "signage": "Opasteet",
  "marketplace": "Markkinapaikka",
  "iot": "IoT",
  "social": "Sosiaalinen",
  "productivity": "Tuottavuus",
  "communication": "Viestinta",
  "other": "Muu"
},
```

- [ ] **Step 3: Update category dropdown in packages-tab.js**

Find the `<select>` element with hardcoded category options (around line 250-259). Replace each `<option>` to use `t()`:

Before:
```javascript
<option value="signage">Signage</option>
<option value="marketplace">Marketplace</option>
<option value="iot">IoT</option>
<option value="social">Social</option>
<option value="productivity">Productivity</option>
<option value="communication">Communication</option>
<option value="other">Other</option>
```

After:
```javascript
<option value="signage">${t('packages.categories.signage') || 'Signage'}</option>
<option value="marketplace">${t('packages.categories.marketplace') || 'Marketplace'}</option>
<option value="iot">${t('packages.categories.iot') || 'IoT'}</option>
<option value="social">${t('packages.categories.social') || 'Social'}</option>
<option value="productivity">${t('packages.categories.productivity') || 'Productivity'}</option>
<option value="communication">${t('packages.categories.communication') || 'Communication'}</option>
<option value="other">${t('packages.categories.other') || 'Other'}</option>
```

- [ ] **Step 4: Update "Featured" badge**

Find the featured badge (around line 321):

Before:
```javascript
${tpl.featured && html`<span class="pkg-badge pkg-badge-featured">⭐ Featured</span>`}
```

After:
```javascript
${tpl.featured && html`<span class="pkg-badge pkg-badge-featured">⭐ ${t('packages.featured') || 'Featured'}</span>`}
```

- [ ] **Step 5: Commit**

```bash
git add aimeat/locales/en.json aimeat/locales/fi.json aimeat/public/views/profile/packages-tab.js
git commit -m "feat: add i18n for package categories and featured badge"
```

---

## Task 4: Change instance status from "active" to "installed"

The instance status `active` is misleading because the components inside (cortex, extensions) are still `inactive` after package install. Changing to `installed` makes it clear that the package was installed but individual components may need activation.

This touches the type definition, both storage backends, the API route, the openapi spec, CSS, and one test assertion.

**Files:**
- Modify: `aimeat/src/storage/interface.ts:1217`
- Modify: `aimeat/src/routes/instances.ts:236`
- Modify: `aimeat/src/storage/providers/sqlite/schema.ts:1063`
- Modify: `aimeat/src/storage/providers/sqlite/index.ts` (add migration)
- Modify: `aimeat/src/storage/providers/mongodb/index.ts:4845`
- Modify: `aimeat/prisma/schema.prisma:1080`
- Modify: `aimeat/public/views/profile/packages-tab.js:47`
- Modify: `aimeat/public/css/views/profile.css` (add badge class)
- Modify: `openapi.yaml:2134, 13089`
- Modify: `aimeat/test/e2e-packages.ts:511`

- [ ] **Step 1: Update TypeScript type**

In `aimeat/src/storage/interface.ts`, find line 1217:
```typescript
status: 'active' | 'paused' | 'removed';
```
Change to:
```typescript
status: 'installed' | 'paused' | 'removed';
```

Also check if `InstanceFilter` type references the enum -- it uses `status?: string` so no change needed there.

- [ ] **Step 2: Update instance creation**

In `aimeat/src/routes/instances.ts`, find line 236:
```typescript
status: 'active',
```
Change to:
```typescript
status: 'installed',
```

- [ ] **Step 3: Update SQLite schema default**

In `aimeat/src/storage/providers/sqlite/schema.ts`, find the line (around 1063):
```sql
status              TEXT DEFAULT 'active',
```
Change to:
```sql
status              TEXT DEFAULT 'installed',
```

- [ ] **Step 4: Add SQLite migration for existing data**

In `aimeat/src/storage/providers/sqlite/index.ts`, find the migrations section (look for existing `ALTER TABLE` or `UPDATE` migration statements that run on startup). Add a migration:

```typescript
this.db.exec("UPDATE package_instances SET status = 'installed' WHERE status = 'active'");
```

Place this alongside other migrations that run at schema init time. If there is a versioned migration system, follow that pattern. If migrations are inline in `initSchema()`, add it there.

- [ ] **Step 5: Update MongoDB fallback default**

In `aimeat/src/storage/providers/mongodb/index.ts`, find line 4845 (the `toPackageInstanceRecord` function):
```typescript
status: (row.status as PackageInstanceRecord['status']) ?? 'active',
```
Change to:
```typescript
status: (row.status as PackageInstanceRecord['status']) ?? 'installed',
```

- [ ] **Step 6: Update Prisma schema default**

In `aimeat/prisma/schema.prisma`, find line 1080:
```prisma
status              String   @default("active")
```
Change to:
```prisma
status              String   @default("installed")
```

- [ ] **Step 7: Update frontend filter**

In `aimeat/public/views/profile/packages-tab.js`, find line 47:
```javascript
pkgService.listInstances({ status: 'active' }),
```
Change to:
```javascript
pkgService.listInstances({ status: 'installed' }),
```

- [ ] **Step 8: Add CSS badge class**

In `aimeat/public/css/views/profile.css`, find the `.pkg-badge-active` line (around line 365):
```css
.pf .pkg-badge-active    { background:rgba(74,222,128,.15); color:#4ade80 }
```

Add after it (keep the old class for backward compat with any existing data):
```css
.pf .pkg-badge-installed { background:rgba(74,222,128,.15); color:#4ade80 }
```

- [ ] **Step 8b: Add admin CSS badge class**

In `aimeat/public/css/views/admin.css`, find the `.adm-badge-active` line (around line 557):
```css
.adm-badge-active { background: #D1FAE5; color: #047857; }
```

Add after it:
```css
.adm-badge-installed { background: #D1FAE5; color: #047857; }
```

The admin packages tab displays all instances (no status filter) and renders badges via the `Badge` component which generates `adm-badge-${type}` CSS classes.

- [ ] **Step 9: Update OpenAPI spec**

In `openapi.yaml`, find line 2134:
```yaml
          enum: [active, paused, removed]
```
Change to:
```yaml
          enum: [installed, paused, removed]
```

Find line 13089:
```yaml
          schema: { type: string, enum: [active, paused, removed] }
```
Change to:
```yaml
          schema: { type: string, enum: [installed, paused, removed] }
```

- [ ] **Step 10: Update E2E test assertion**

In `aimeat/test/e2e-packages.ts`, find line 511:
```typescript
assert(body.data?.status === 'active', 'Expected active status');
```
Change to:
```typescript
assert(body.data?.status === 'installed', 'Expected installed status');
```

- [ ] **Step 10b: Update unit test assertions**

In `aimeat/test/unit/package-instance-repository.test.ts`, update these references:
- Line 144: `=== 'active'` -> `=== 'installed'`
- Line 194: `=== 'active'` -> `=== 'installed'`
- Lines 236-237: test name and query `?status=active` -> `?status=installed`
- Line 242: `=== 'active'` -> `=== 'installed'`

Note: Line 267-268 (`comp.status === 'active'`) is per-component status from GET /instances/:id/status, which is a different concept (component content presence). Leave this as-is.

- [ ] **Step 10c: Update documentation**

In `docs/templatesandpackages/03-specifications.md`:
- Line 129: Change `'active' | 'paused' | 'removed'` to `'installed' | 'paused' | 'removed'`
- Line 290: Change `?status=active` to `?status=installed`

In `docs/packagetemplatingsystem/01-current-state-analysis.md`:
- Line 71: Change `status: active/paused/removed` to `status: installed/paused/removed`

- [ ] **Step 11: Typecheck**

Run: `npx tsc --noEmit` from project root.

Expected: no errors. If there are errors, they will point to other places that reference `'active'` for instance status that were missed.

- [ ] **Step 12: Commit**

```bash
git add aimeat/src/storage/interface.ts aimeat/src/routes/instances.ts \
  aimeat/src/storage/providers/sqlite/schema.ts aimeat/src/storage/providers/sqlite/index.ts \
  aimeat/src/storage/providers/mongodb/index.ts aimeat/prisma/schema.prisma \
  aimeat/public/views/profile/packages-tab.js aimeat/public/css/views/profile.css \
  openapi.yaml aimeat/test/e2e-packages.ts
git commit -m "feat: change package instance status from 'active' to 'installed'"
```

---

## Task 5: Rewrite digital signage cortex manifest

The current CORTEX_SIGNAGE manifest has no `components:` array, no `metadata:` section, and no tags. This causes the "What's included" section to render empty. The libs are keyed without `.js` extensions.

Reference: the bundled `aimeat-charts.yaml` uses this structure:
```yaml
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: ...
  description: ...
  tags: [...]
spec:
  version: "1.0.0"
  license: MIT
  components:
    - type: lib
      name: ...
      filename: ...
      exports: [...]
      api_surface: |
        ...
```

The component-registrar reads `meta.metadata` for name/desc/tags and `meta.components` for the components array. When `metadata` is missing, it falls back to `meta` itself (the root). When `components` is missing, it defaults to `[]`.

For the cortex.aimeat.org/v1 format: `meta.metadata` maps to the `metadata:` block, `meta.spec?.components` does NOT get read -- the registrar reads `meta.components`. But looking at the bundled cortex install path in `cortex-seeder.ts`, it uses `parseCortexManifest()` which does read from `spec.components`.

**IMPORTANT:** The component-registrar (package install path) reads `meta.components` directly (line 144), NOT `meta.spec.components`. So the manifest needs `components:` at root level, OR the registrar needs to also check `meta.spec?.components`. Since the seed package goes through the registrar, we put `components:` at root level AND under `spec:` for maximum compatibility.

**Files:**
- Modify: `aimeat/src/data/example-packages.ts:221-227`

- [ ] **Step 1: Rewrite CORTEX_SIGNAGE constant**

Replace the CORTEX_SIGNAGE constant (lines 221-227) with a proper manifest. The JSON wrapper structure stays the same (`{ manifest: "YAML string", libs: { ... } }`), but the YAML and lib keys change:

```typescript
const CORTEX_SIGNAGE = JSON.stringify({
  manifest: `name: signage-cortex
version: 1.0.0
description: Content management cortex for digital signage -- schedules content rotation, prunes expired announcements, and provides helper libraries for kiosk apps.
tags: [signage, kiosk, content-management, scheduling]
capabilities: [memory_read, memory_write, consent_check]
triggers:
  - { event: schedule, cron: "0 8 * * *", action: rotate_daily_content }
  - { event: memory_change, key: "signage:announcements", action: notify_kiosk_refresh }
components:
  - type: lib
    name: contentRotation
    filename: contentRotation.js
    exports: [selectActiveAnnouncements]
    api_surface: |
      selectActiveAnnouncements(announcements, now)
        Filters expired announcements and sorts by priority (emergency > urgent > normal).
        Returns: filtered, sorted array.
  - type: lib
    name: scheduling
    filename: scheduling.js
    exports: [rotateDailyContent]
    api_surface: |
      rotateDailyContent(api)
        Reads signage:announcements, removes expired entries, writes back.
        Called by the daily cron trigger.`,
  libs: {
    'contentRotation.js': 'function selectActiveAnnouncements(a,now){return a.filter(x=>!x.expiresAt||new Date(x.expiresAt)>now).sort((a,b)=>({emergency:0,urgent:1,normal:2}[a.priority]??2)-({emergency:0,urgent:1,normal:2}[b.priority]??2));}',
    'scheduling.js': 'async function rotateDailyContent(api){const a=await api.get("signage:announcements");const now=new Date();const active=a.filter(x=>!x.expiresAt||new Date(x.expiresAt)>now);if(active.length!==a.length)await api.set("signage:announcements",active);}',
  },
}, null, 2);
```

Key changes:
- Added `tags:` array
- Added `components:` array with 2 `lib` entries, each with `filename` (with `.js`), `exports`, and `api_surface`
- Changed lib keys from `contentRotation`/`scheduling` to `contentRotation.js`/`scheduling.js`
- Added richer `description` with actual explanation of what the cortex does
- Kept `capabilities:` and `triggers:` as informational metadata (not part of the component type system but useful context)

The component-registrar at line 144 reads `meta.components` which is now a 2-element array. Each gets mapped with `{ type, name, content }`. The `filename`, `exports`, and `api_surface` fields are also present on the parsed objects but the registrar only maps `type`, `name`, `content`. However, the stored manifest YAML string is preserved in `ext.manifest`, and the GET /v1/cortex/:name endpoint at line 171 maps components including `filename`, `exports`, and `api_surface` fields -- these come from the stored `components` array.

**Wait -- verify this.** The registrar stores `components` as mapped from `componentsRaw`:
```typescript
components: componentsRaw.map(c => ({
  type: (c.type as string) ?? 'lib',
  name: (c.name as string) ?? '',
  content: typeof c.content === 'string' ? c.content : JSON.stringify(c.content ?? ''),
})) as any,
```

This only maps `type`, `name`, and `content`. The `filename`, `exports`, and `api_surface` fields are **dropped**. The GET endpoint then tries to read these fields from the stored components but they won't be there.

This means we also need to fix the component-registrar to preserve additional fields for lib components.

- [ ] **Step 2: Fix component-registrar to preserve lib component fields**

In `aimeat/src/services/component-registrar.ts`, find the cortex handler's component mapping (around line 161-165):

Before:
```typescript
components: componentsRaw.map(c => ({
  type: (c.type as string) ?? 'lib',
  name: (c.name as string) ?? '',
  content: typeof c.content === 'string' ? c.content : JSON.stringify(c.content ?? ''),
})) as any,
```

After:
```typescript
components: componentsRaw.map(c => {
  const comp: Record<string, unknown> = {
    type: (c.type as string) ?? 'lib',
    name: (c.name as string) ?? '',
    content: typeof c.content === 'string' ? c.content : JSON.stringify(c.content ?? ''),
  };
  if (c.filename) comp.filename = c.filename as string;
  if (c.exports) comp.exports = c.exports;
  if (c.api_surface) comp.api_surface = c.api_surface as string;
  if (c.key_pattern) comp.key_pattern = c.key_pattern as string;
  if (c.apply_to) comp.apply_to = c.apply_to as string;
  return comp;
}) as any,
```

This preserves all the fields that the GET /v1/cortex/:name endpoint (cortex.ts line 171-179) checks for: `name`, `filename`, `exports`, `api_surface`, `key_pattern`, `apply_to`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add aimeat/src/data/example-packages.ts aimeat/src/services/component-registrar.ts
git commit -m "feat: rewrite digital signage cortex manifest with proper components"
```

---

## Task 6: Improve app metadata in component-registrar

When apps are installed from packages, the component-registrar hardcodes generic metadata:
- `description: "Installed from package: {name}"` 
- `category: 'utility'`
- `tags: ['package-installed']`
- `usesCortex: []`

The package definition has the category and tags at the package level. The component has a `label`. We should flow this information through.

**Files:**
- Modify: `aimeat/src/services/component-registrar.ts:184-205`

- [ ] **Step 1: Add package-level metadata to ComponentRegistrationInput**

In `aimeat/src/services/component-registrar.ts`, find the `ComponentRegistrationInput` interface (around line 35-44):

Before:
```typescript
export interface ComponentRegistrationInput {
  componentId: string;
  type: PackageComponentType;
  registeredAs: string;
  content: string;
  label: string;
  owner: string;
  ownerGaii: string;
  packageName: string;
}
```

After:
```typescript
export interface ComponentRegistrationInput {
  componentId: string;
  type: PackageComponentType;
  registeredAs: string;
  content: string;
  label: string;
  owner: string;
  ownerGaii: string;
  packageName: string;
  packageCategory?: string;
  packageTags?: string[];
  packageDescription?: string;
}
```

- [ ] **Step 2: Update app handler to use richer metadata**

In the same file, find the `case 'app':` handler (around line 184). Replace the manifest construction:

Before:
```typescript
case 'app': {
  await storage.createApp({
    ownerGaii,
    ownerName: owner,
    filename: registeredAs,
    versionNumber: 1,
    manifest: {
      name: label,
      description: `Installed from package: ${packageName}`,
      version: '1.0.0',
      category: 'utility',
      tags: ['package-installed'],
      authorDisplay: owner,
      usesCortex: [],
    },
    mimeType: 'text/html',
    size: Buffer.byteLength(content, 'utf-8'),
    data: Buffer.from(content, 'utf-8'),
    createdAt: now,
  });
  break;
}
```

After:
```typescript
case 'app': {
  await storage.createApp({
    ownerGaii,
    ownerName: owner,
    filename: registeredAs,
    versionNumber: 1,
    manifest: {
      name: label,
      description: input.packageDescription
        ? `${label} -- ${input.packageDescription}`
        : `Installed from package: ${packageName}`,
      version: '1.0.0',
      category: input.packageCategory || 'utility',
      tags: [...(input.packageTags || []), 'package-installed'],
      authorDisplay: owner,
      usesCortex: [],
    },
    mimeType: 'text/html',
    size: Buffer.byteLength(content, 'utf-8'),
    data: Buffer.from(content, 'utf-8'),
    createdAt: now,
  });
  break;
}
```

- [ ] **Step 3: Pass package metadata from install route**

In `aimeat/src/routes/instances.ts`, there are 4 call sites for `registerComponent()`:

1. **Line 174** -- main install loop (the primary one to fix)
2. **Line 742** -- migration `replace` action
3. **Line 785** -- migration `custom` action
4. **Line 811** -- migration `install_new` action

For the main install at line 174, find:
```typescript
const result = await registerComponent(storage, {
  componentId: comp.id,
  type: comp.type,
  registeredAs,
  content: comp.content,
  label: comp.label,
  owner,
  ownerGaii,
  packageName: pkg.name,
});
```

Add three fields:
```typescript
const result = await registerComponent(storage, {
  componentId: comp.id,
  type: comp.type,
  registeredAs,
  content: comp.content,
  label: comp.label,
  owner,
  ownerGaii,
  packageName: pkg.name,
  packageCategory: pkg.category,
  packageTags: pkg.tags,
  packageDescription: pkg.description,
});
```

For the 3 migration call sites (lines 742, 785, 811), add the same fields using `targetPkg`:
```typescript
packageCategory: targetPkg.category,
packageTags: targetPkg.tags,
packageDescription: targetPkg.description,
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add aimeat/src/services/component-registrar.ts aimeat/src/routes/instances.ts
git commit -m "feat: pass package metadata through to app manifests on install"
```

---

## Task 7: Update file headers

Per the mandatory rule, all modified source files need version-history updates.

**Files:**
- Modify: `aimeat/public/views/profile/packages-tab.js` (header)
- Modify: `aimeat/src/data/example-packages.ts` (header)
- Modify: `aimeat/src/services/component-registrar.ts` (header)

- [ ] **Step 1: Update version-history in all modified files**

Add a new version-history entry to each file's header comment:

For `packages-tab.js`:
```
 *   v1.5.0 -- 2026-05-05 -- add intro section, i18n for categories/featured, fix status badge label
```

For `example-packages.ts`:
```
 *   v1.3.0 -- 2026-05-05 -- rewrite cortex manifest with proper components array, .js lib filenames, tags
```

For `component-registrar.ts`:
```
 *   v1.2.0 -- 2026-05-05 -- preserve lib component fields (filename, exports, api_surface) in cortex registration; pass package metadata to app manifests
```

- [ ] **Step 2: Commit**

```bash
git add aimeat/public/views/profile/packages-tab.js aimeat/src/data/example-packages.ts aimeat/src/services/component-registrar.ts
git commit -m "docs: update file headers for packages improvements"
```

---

## Task 8: Run E2E tests and verify

Run the full test suite to ensure nothing is broken.

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 2: Lint**

Run: `pnpm lint`

Expected: 0 errors.

- [ ] **Step 3: Run E2E tests on memory backend**

Run: `pnpm test:e2e`

Expected: all tests pass. The packages test should show `installed` status where it previously showed `active`.

- [ ] **Step 4: Run E2E tests on SQLite**

Run: `pnpm test:e2e:sqlite`

Expected: all tests pass. The SQLite migration should have updated any existing rows from `active` to `installed`.

- [ ] **Step 5: Run E2E tests on MongoDB**

Run: `pnpm test:e2e:mongodb`

Expected: all tests pass.

- [ ] **Step 6: Manual verification**

Start the dev server (`pnpm dev`), log in, navigate to the Packages tab:

1. Verify the "Template Gallery" button text renders correctly (not "packages.gallery")
2. Verify the introductory title and description appear above the nav buttons
3. Run `npx aimeat seed` to seed the digital signage package
4. Go to Template Gallery, install Digital Signage System
5. Verify the instance card shows "installed" badge (green) instead of "active"
6. Go to Extensions tab, find the signage cortex
7. Click into the cortex detail view
8. Verify "What's included" shows 2 lib components with names and API surfaces
9. Go to Apps tab, verify the admin panel and kiosk display apps appear with proper category/tags

---

## Scope excluded (future work)

These were identified during review but are not in scope for this plan:

- **Template reviews/discussions UI** -- the service layer has the API functions but the tab has no UI for them. This is a feature addition, not a bug fix.
- **Migration prompt UI** -- service exports `getMigrationPrompt`/`applyMigration` but the tab never uses them.
- **Pagination** -- all data loads at once with no pagination. Performance improvement for later.
- **Cortex lib file serving for package-installed cortexes** -- the libs are stored but never served via HTTP because the simplified manifest doesn't declare proper components. Task 5 fixes the manifest, which fixes the data flow, but existing installed instances would need re-installation.
