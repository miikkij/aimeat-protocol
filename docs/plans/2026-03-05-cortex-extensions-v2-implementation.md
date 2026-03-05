# Cortex Extensions v2 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the bare Extensions tab into a rich experience with hero section, scaffolding prompt, two real extensions (Charts + Canvas), and visibility support.

**Architecture:** Backend gets visibility field on CortexExtensionRecord. Two real extensions (YAML manifests + JS libraries) are served as bundled files from `public/cortex-bundled/`. The UI is rebuilt with a welcoming hero, "Luo AI:lla" prompt button, "+ Lisää" install button, and bundled extension cards with one-click install. The scaffolding prompt is a large text blob built dynamically with node URL injected.

**Tech Stack:** Preact/htm (profile.js), Chart.js (CDN), Canvas API, Express routes, TypeScript storage layer.

**Design doc:** `docs/plans/2026-03-05-cortex-extensions-v2-design.md`

---

## Task 1: Add visibility field to backend

**Files:**
- Modify: `aimeat/src/storage/interface.ts`
- Modify: `aimeat/src/storage/memory.ts`
- Modify: `aimeat/src/storage/mongodb.ts`
- Modify: `aimeat/src/services/cortex-manifest.ts`
- Modify: `aimeat/src/routes/cortex.ts`

**Step 1: Add visibility to CortexExtensionRecord**

In `aimeat/src/storage/interface.ts`, find `CortexExtensionRecord` interface. Add after the `status` field:

```typescript
visibility: 'private' | 'public';
```

**Step 2: Update manifest parser**

In `aimeat/src/services/cortex-manifest.ts`, find where metadata fields are extracted (around line 85-93). Add:

```typescript
const visibility = (metadata.visibility as string) === 'public' ? 'public' : 'private';
```

Then in the returned extension record object (around line 190-210), add:

```typescript
visibility,
```

**Step 3: Update storage implementations**

In `aimeat/src/storage/memory.ts`, `createCortexExtension` — no changes needed (stores full record).

In `listCortexExtensions`, extend the opts type and filter:

```typescript
async listCortexExtensions(opts?: { status?: string; namespace?: string; visibility?: string; installedBy?: string }): Promise<CortexExtensionRecord[]> {
```

Add filtering logic:
```typescript
if (opts?.visibility) arr = arr.filter(e => e.visibility === opts.visibility);
if (opts?.installedBy) arr = arr.filter(e => e.installedBy === opts.installedBy);
```

Same change in `mongodb.ts`.

Also check the `NodeRepository` interface in `aimeat/src/storage/repositories/node.repository.ts` and update `listCortexExtensions` signature to accept the extended opts.

Check if SQLite storage exists at `aimeat/src/storage/providers/sqlite/index.ts` and update there too — add `visibility TEXT DEFAULT 'private'` to the schema and update queries.

**Step 4: Add visibility toggle endpoint**

In `aimeat/src/routes/cortex.ts`, add after the deactivate endpoint:

```typescript
// ── POST /v1/cortex/:name/visibility — toggle visibility ──
router.post('/v1/cortex/:name/visibility', requireAuth(), requireRole('owner'), async (req, res) => {
  const name = req.params.name as string;
  const ext = await storage.getCortexExtension(name);
  if (!ext) {
    res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${name}" not found`));
    return;
  }
  if (ext.installedBy !== req.auth!.sub && !req.auth!.roles.includes('operator')) {
    res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Not your extension'));
    return;
  }
  const { visibility } = req.body ?? {};
  if (visibility !== 'public' && visibility !== 'private') {
    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'visibility must be "public" or "private"'));
    return;
  }
  const updated = await storage.updateCortexExtension(name, { visibility });
  res.json(success(config.nodeId, { name, visibility: updated?.visibility }));
});
```

**Step 5: Update GET /v1/cortex to support visibility filter**

In the GET list endpoint, read `req.query.visibility` and pass it to storage:

```typescript
const visibility = req.query.visibility as string | undefined;
```

Pass to `storage.listCortexExtensions({ status, namespace, visibility })`.

For public listing (no auth required), also add a public list option — when `?visibility=public` is requested and no auth is present, list all public extensions from all users.

**Step 6: Update GET /v1/cortex/:name response**

Add `visibility` to the response data object, next to `status`.

**Step 7: Run tsc --noEmit**

```bash
cd aimeat && npx tsc --noEmit
```

**Step 8: Commit**

```bash
git add aimeat/src/storage/interface.ts aimeat/src/storage/memory.ts aimeat/src/storage/mongodb.ts aimeat/src/services/cortex-manifest.ts aimeat/src/routes/cortex.ts aimeat/src/storage/repositories/node.repository.ts aimeat/src/storage/providers/
git commit -m "feat(cortex): add visibility (private/public) to extensions"
```

---

## Task 2: Create aimeat-charts extension (YAML + JS)

**Files:**
- Create: `aimeat/public/cortex-bundled/aimeat-charts.yaml`
- Create: `aimeat/public/cortex-bundled/aimeat-charts.js`

**Step 1: Create the charts manifest**

Create `aimeat/public/cortex-bundled/aimeat-charts.yaml`:

```yaml
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: aimeat-charts
  namespace: aimeat
  description: "Beautiful interactive charts for your apps. Bar, line, pie, doughnut, radar, scatter, and bubble charts with touch support, hover tooltips, and responsive layout."
  author: AIMEAT
  tags: [charts, visualization, data, ui]
  labels:
    domain: visualization

spec:
  version: "1.0.0"
  license: MIT
  components:
    - type: schema
      name: chart-data
      key_pattern: "chart:*"
      apply_to: prefix
      schema:
        type: object
        required: [type, data]
        properties:
          type:
            type: string
            enum: [bar, line, pie, doughnut, radar, scatter, bubble]
          title:
            type: string
            maxLength: 200
          data:
            type: object
            required: [labels, datasets]
            properties:
              labels:
                type: array
                items:
                  type: string
              datasets:
                type: array
                minItems: 1
                items:
                  type: object
                  required: [label, data]
                  properties:
                    label:
                      type: string
                    data:
                      type: array
                      items:
                        type: number
                    backgroundColor:
                      oneOf:
                        - type: string
                        - type: array
                          items:
                            type: string
                    borderColor:
                      oneOf:
                        - type: string
                        - type: array
                          items:
                            type: string
          options:
            type: object

    - type: prompt
      name: chart-assistant
      content: |
        You are a chart assistant for an AIMEAT app. The user's node is at {{node_url}}.

        You help users create beautiful interactive charts. The aimeat-charts extension
        is installed and provides a Chart.js wrapper.

        IMPORTANT: When creating apps that use charts, include BOTH script tags:
        1. <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        2. <script src="{{node_url}}/v1/cortex/aimeat-charts/libs/aimeat-charts.js"></script>

        Available API:

        AIMEAT.charts.ChartPanel({elementId, chartKey, nodeUrl, token?})
          - Reads a chart:* key from AIMEAT storage and renders it
          - elementId: string — DOM element id to render into
          - chartKey: string — AIMEAT memory key (e.g. 'chart:sales-2024')
          - nodeUrl: string — AIMEAT node URL
          - token: string — optional auth token for private data

        AIMEAT.charts.ChartBuilder({elementId, data, type, options?})
          - Renders a chart directly from inline data
          - elementId: string — DOM element id
          - data: {labels: string[], datasets: [{label, data: number[], backgroundColor?, borderColor?}]}
          - type: 'bar'|'line'|'pie'|'doughnut'|'radar'|'scatter'|'bubble'
          - options: Chart.js options object (optional)

        AIMEAT.charts.TYPES — array of supported chart types

        Chart data stored in AIMEAT memory uses the schema key pattern "chart:*".
        Example key: "chart:sales-2024", "chart:temperature-march"

        The chart data structure is:
        {
          type: "bar",
          title: "Monthly Sales",
          data: {
            labels: ["Jan", "Feb", "Mar"],
            datasets: [{
              label: "Revenue",
              data: [1200, 1800, 2400],
              backgroundColor: ["#6366f1", "#8b5cf6", "#a78bfa"]
            }]
          },
          options: {}  // optional Chart.js options
        }

        Color palette (AIMEAT theme):
        Primary: #6366f1, #8b5cf6, #a78bfa, #c4b5fd
        Accent: #f59e0b, #10b981, #ef4444, #3b82f6, #ec4899, #14b8a6

        When the user asks for a chart:
        1. Ask what data they want to visualize
        2. Suggest the best chart type for their data
        3. Generate the chart data structure
        4. Create the app HTML with both script tags and AIMEAT.charts.ChartBuilder call
      variables:
        - "{{node_url}}"

    - type: seed-data
      entries:
        - key: "chart:sales-2024"
          value:
            type: bar
            title: "Quarterly Sales 2024"
            data:
              labels: ["Q1", "Q2", "Q3", "Q4"]
              datasets:
                - label: "Revenue (€k)"
                  data: [42, 58, 71, 63]
                  backgroundColor: ["#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd"]
        - key: "chart:temperature"
          value:
            type: line
            title: "Monthly Temperature (Helsinki)"
            data:
              labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
              datasets:
                - label: "°C"
                  data: [-5, -6, -2, 4, 11, 16, 19, 17, 12, 6, 1, -3]
                  borderColor: "#ef4444"
                  backgroundColor: "rgba(239,68,68,0.1)"
        - key: "chart:categories"
          value:
            type: doughnut
            title: "App Categories"
            data:
              labels: ["Productivity", "Games", "Social", "Education", "Utilities"]
              datasets:
                - label: "Count"
                  data: [12, 8, 15, 6, 9]
                  backgroundColor: ["#6366f1", "#f59e0b", "#ec4899", "#10b981", "#3b82f6"]

    - type: lib
      name: aimeat-charts
      filename: aimeat-charts.js
      exports:
        - ChartPanel
        - ChartBuilder
        - TYPES
      api_surface: |
        AIMEAT.charts.ChartPanel({elementId, chartKey, nodeUrl, token?})
          Reads chart:* key from storage, renders Chart.js chart. Auto-responsive.

        AIMEAT.charts.ChartBuilder({elementId, data, type, options?})
          Renders chart from inline data.
          data: {labels:[], datasets:[{label, data:[], backgroundColor?, borderColor?}]}
          type: 'bar'|'line'|'pie'|'doughnut'|'radar'|'scatter'|'bubble'

        AIMEAT.charts.TYPES = ['bar','line','pie','doughnut','radar','scatter','bubble']

        Requires: <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
```

**Step 2: Create the charts library**

Create `aimeat/public/cortex-bundled/aimeat-charts.js`. This is an IIFE that wraps Chart.js. The full implementation should include:

- Register as `AIMEAT.register('aimeat-charts', { ChartPanel, ChartBuilder, TYPES })`
- `ChartPanel({elementId, chartKey, nodeUrl, token})` — fetches chart data from AIMEAT memory, creates a canvas, and instantiates a Chart.js chart. Uses `ResizeObserver` for auto-responsive.
- `ChartBuilder({elementId, data, type, options})` — takes inline data, creates canvas, renders Chart.js chart. Merges AIMEAT color palette as defaults.
- `TYPES` array with all supported chart types
- AIMEAT color palette: `['#6366f1','#8b5cf6','#a78bfa','#c4b5fd','#f59e0b','#10b981','#ef4444','#3b82f6','#ec4899','#14b8a6']`
- Error handling (Chart.js not loaded → shows error message in element)
- CSS injection for canvas container (sets up responsive sizing)

Size target: 200-400 lines. Use the `recipe-ui.js` IIFE pattern from `test/fixtures/cortex/recipe-ui.js` as reference.

**Step 3: Commit**

```bash
git add aimeat/public/cortex-bundled/
git commit -m "feat(cortex): add aimeat-charts bundled extension (Chart.js wrapper)"
```

---

## Task 3: Create aimeat-canvas extension (YAML + JS)

**Files:**
- Create: `aimeat/public/cortex-bundled/aimeat-canvas.yaml`
- Create: `aimeat/public/cortex-bundled/aimeat-canvas.js`

**Step 1: Create the canvas manifest**

Create `aimeat/public/cortex-bundled/aimeat-canvas.yaml` following the same pattern as aimeat-charts.yaml:

- Schema: `drawing:*` — validates drawing data (strokes, canvasSize, backgroundColor, metadata)
- Prompt: `canvas-assistant` — comprehensive prompt explaining how to create apps with the drawing canvas, all config options, example usage
- Seed-data: 1 simple example drawing (`drawing:welcome` with a few strokes)
- Lib: `aimeat-canvas.js` with exports and api_surface

See design doc for the full schema and API surface definitions.

**Step 2: Create the canvas library**

Create `aimeat/public/cortex-bundled/aimeat-canvas.js`. This is a pure Canvas API implementation (no external deps). The IIFE should register `AIMEAT.register('aimeat-canvas', { DrawingCanvas })` and provide:

**DrawingCanvas({elementId, storageKey, nodeUrl, token, options})** returns a controller object.

Core features:
- **Tools**: pen, line, rectangle, circle, eraser, text
- **Color picker**: predefined palette + custom hex input
- **Line width**: slider (1-20px)
- **Opacity**: slider (0.1-1.0)
- **Undo/redo**: array of canvas states, Ctrl+Z / Ctrl+Y, three-finger touch gesture
- **Touch support**: draw with finger, pinch zoom (transform matrix), two-finger pan
- **Mouse support**: draw, scroll zoom, middle-button pan
- **Mobile layout**: toolbar at bottom, icons smaller
- **Auto-save**: debounced (configurable delay, default 2000ms), saves stroke data to AIMEAT storage via fetch
- **Export**: PNG (canvas.toDataURL) and SVG (reconstruct from strokes) download buttons
- **Load from storage**: on init, fetch existing drawing data and replay strokes

Internal data model:
```javascript
{
  strokes: [
    { tool: 'pen', color: '#000', lineWidth: 2, opacity: 1, points: [[x,y],[x,y],...] },
    { tool: 'rect', color: '#f00', lineWidth: 1, opacity: 0.8, points: [[x1,y1],[x2,y2]] },
    { tool: 'text', color: '#000', fontSize: 16, text: 'Hello', points: [[x,y]] },
  ],
  canvasSize: { width: 800, height: 600 },
  backgroundColor: '#ffffff',
  metadata: { createdAt: '...', updatedAt: '...' }
}
```

The toolbar UI is injected as HTML above/below the canvas element. CSS is injected inline. No external dependencies.

Size target: 600-1000 lines.

**Step 3: Commit**

```bash
git add aimeat/public/cortex-bundled/
git commit -m "feat(cortex): add aimeat-canvas bundled extension (drawing canvas)"
```

---

## Task 4: Create the scaffolding prompt

**Files:**
- Modify: `aimeat/public/views/profile.js`

**Step 1: Add buildCortexPrompt function**

In `aimeat/public/views/profile.js`, add a new function near `buildAgentPrompt` (around line 78). The function takes a session object and returns a comprehensive prompt string.

```javascript
function buildCortexPrompt(sess) {
  const url = NODE_URL;
  const owner = sess.owner || 'user';
  return `... (see below for content) ...`;
}
```

The prompt content should include (this can be very large — no size limit for PoC):

**Section 1: Introduction for the AI**
- What Cortex extensions are
- What they enable for the user
- The 7 component types with brief descriptions

**Section 2: Full YAML manifest structure**
- Complete annotated template showing every field
- Required vs optional fields marked

**Section 3: Component type details with examples**
For each of the 7 types (schema, prompt, action, board-template, ontology, seed-data, lib):
- What it does
- Full YAML example
- Common patterns

**Section 4: Library (JS) patterns**
- The IIFE registration pattern
- `AIMEAT.register('name', { exports })`
- How to interact with AIMEAT storage from the lib
- Example lib code

**Section 5: Node context (auto-filled)**
- `Node URL: ${url}`
- `Owner: ${owner}`
- Storage API endpoints for the lib to use

**Section 6: Instructions for the AI**
- Ask the user what they want to build
- Give short examples: "chart dashboard, drawing app, recipe manager, project tracker, IoT monitor, quiz game, budget tracker, workout log..."
- Build the complete YAML manifest based on user's answers
- If a JS library is needed, build that too
- Explain how to install: go to Profile → Extensions → + Lisää → paste YAML → paste JS if needed
- Test the result by creating a small app that uses the extension

**Step 2: Commit**

```bash
git add aimeat/public/views/profile.js
git commit -m "feat(cortex): add scaffolding prompt builder for AI-assisted extension creation"
```

---

## Task 5: Update i18n translations

**Files:**
- Modify: `aimeat/locales/en.json`
- Modify: `aimeat/locales/fi.json`

**Step 1: Update English translations**

In the `profile.extensions` section, update/add:

```json
"install": "+ Lisää",
"createWithAi": "Luo AI:lla",
"promptCopied": "Prompt copied! Paste it into AI Chat.",
"readyExtensions": "Ready-made extensions:",
"addThis": "Add this",
"visibility": {
  "private": "Private",
  "public": "Public"
},
"publish": "Make public",
"unpublish": "Make private",
"installModal": {
  "title": "Add Cortex Extension",
  ...existing keys...
}
```

Also update `"empty"` to a more inviting message that doesn't reference "+ Install Extension" anymore.

**Step 2: Update Finnish translations**

Same keys in Finnish:

```json
"install": "+ Lisää",
"createWithAi": "Luo AI:lla",
"promptCopied": "Prompt kopioitu! Liitä se AI Chatiin.",
"readyExtensions": "Valmiita laajennuksia:",
"addThis": "Lisää tämä",
"visibility": {
  "private": "Yksityinen",
  "public": "Julkinen"
},
"publish": "Julkaise",
"unpublish": "Tee yksityiseksi"
```

**Step 3: Commit**

```bash
git add aimeat/locales/en.json aimeat/locales/fi.json
git commit -m "feat(i18n): update extension translation keys — add visibility, prompt, bundled"
```

---

## Task 6: Redesign renderExtensions in profile.js

**Files:**
- Modify: `aimeat/public/views/profile.js`
- Modify: `aimeat/public/css/views/profile.css`

**Step 1: Add state for bundled extensions**

In profile.js, near the existing extension state hooks, add:

```javascript
const [bundledInstalling, setBundledInstalling] = useState(null); // name of extension being installed
```

**Step 2: Add bundled extension install function**

This function fetches the YAML and JS from `/cortex-bundled/`, then calls `POST /v1/cortex`:

```javascript
async function installBundledExtension(name) {
  setBundledInstalling(name);
  const s = getSession();
  try {
    // Fetch manifest YAML
    const yamlResp = await fetch(NODE_URL + '/cortex-bundled/' + name + '.yaml');
    const manifest = await yamlResp.text();

    // Try to fetch lib JS (may not exist)
    const libs = {};
    try {
      const jsResp = await fetch(NODE_URL + '/cortex-bundled/' + name + '.js');
      if (jsResp.ok) {
        const jsContent = await jsResp.text();
        libs[name + '.js'] = btoa(unescape(encodeURIComponent(jsContent)));
      }
    } catch(e) { /* no lib file */ }

    const body = { manifest };
    if (Object.keys(libs).length > 0) body.libs = libs;

    const resp = await s.fetch('/v1/cortex', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error?.message || 'Failed');

    showToast(t('profile.extensions.success.installed'));
    loadExtensions();
  } catch(e) {
    showToast(t('profile.extensions.error.installFailed') + ': ' + e.message, true);
  } finally {
    setBundledInstalling(null);
  }
}
```

**Step 3: Add "copy prompt" function**

```javascript
function copyExtensionPrompt() {
  const sess = getSession()?.getSession?.() || { owner: 'user' };
  const prompt = buildCortexPrompt(sess);
  copyToClipboard(prompt);
  showToast(t('profile.extensions.promptCopied'));
}
```

**Step 4: Rewrite renderExtensions**

Replace the grid view section of `renderExtensions` (keep the detail view as-is, just add visibility badge). The grid view becomes:

**Hero section** (always visible):
- Title + description (user-friendly language from design)
- Two buttons: "🤖 Luo AI:lla" (calls `copyExtensionPrompt()`) + "+ Lisää" (opens install modal)

**Extensions grid** (if extensions exist):
- Same cards as before, but add visibility badge (🔒/🌐) to each card
- Detail view adds visibility toggle button

**Bundled extensions section** (show if not all bundled extensions are already installed):
- "Valmiita laajennuksia:" header
- Cards for `aimeat-charts` and `aimeat-canvas` with descriptions and "Lisää tämä" button
- Hide cards for extensions that are already installed (check `extensions` array by name)

**Step 5: Add visibility badge to cards**

In the card rendering, after the version badge:
```javascript
html`<span class="ext-visibility-badge ${ext.visibility || 'private'}">${ext.visibility === 'public' ? '🌐' : '🔒'} ${t('profile.extensions.visibility.' + (ext.visibility || 'private'))}</span>`
```

**Step 6: Add visibility toggle to detail view**

In the detail view, near the activate/deactivate buttons, add:

```javascript
html`<button class="btn-outline" onClick=${() => toggleVisibility(ext.name, ext.visibility)}>
  ${ext.visibility === 'public' ? t('profile.extensions.unpublish') : t('profile.extensions.publish')}
</button>`
```

And the function:
```javascript
async function toggleVisibility(name, current) {
  const s = getSession();
  const newVis = current === 'public' ? 'private' : 'public';
  try {
    await s.fetch('/v1/cortex/' + encodeURIComponent(name) + '/visibility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility: newVis }),
    });
    showToast(newVis === 'public' ? t('profile.extensions.publish') : t('profile.extensions.unpublish'));
    loadExtensions();
    loadExtDetail(name); // refresh detail
  } catch(e) { showToast(e.message, true); }
}
```

**Step 7: Add CSS**

In `aimeat/public/css/views/profile.css`, add:

```css
/* Extensions hero */
.pf .ext-hero{margin-bottom:1.5rem}
.pf .ext-hero-desc{font-size:.95rem;color:var(--muted);line-height:1.7;margin-bottom:1.25rem;max-width:600px}
.pf .ext-hero-actions{display:flex;gap:.75rem;flex-wrap:wrap;margin-bottom:1.5rem}

/* Bundled extension cards */
.pf .ext-bundled-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1rem;margin-top:.75rem}
.pf .ext-bundled-card{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:1.25rem;transition:all .2s}
.pf .ext-bundled-card:hover{background:rgba(255,255,255,0.07);border-color:rgba(255,255,255,0.15)}
.pf .ext-bundled-icon{font-size:2rem;margin-bottom:.75rem}
.pf .ext-bundled-name{font-weight:700;font-size:1rem;margin-bottom:.5rem}
.pf .ext-bundled-desc{font-size:.85rem;color:var(--muted);line-height:1.5;margin-bottom:1rem}

/* Visibility badge */
.pf .ext-visibility-badge{font-size:.7rem;padding:2px 8px;border-radius:6px;background:rgba(255,255,255,0.08);margin-left:.5rem}
.pf .ext-visibility-badge.public{color:#4ade80}
.pf .ext-visibility-badge.private{color:var(--muted)}
```

**Step 8: Run tsc --noEmit**

```bash
cd aimeat && npx tsc --noEmit
```

**Step 9: Commit**

```bash
git add aimeat/public/views/profile.js aimeat/public/css/views/profile.css
git commit -m "feat(ui): redesign Extensions tab — hero, prompt, bundled cards, visibility"
```

---

## Task 7: Serve bundled files via Express static

**Files:**
- Modify: `aimeat/src/server.ts`

**Step 1: Add static serving for cortex-bundled directory**

In `aimeat/src/server.ts`, find where static files are served (look for `express.static`). Add:

```typescript
app.use('/cortex-bundled', express.static(path.join(__dirname, '../public/cortex-bundled')));
```

This serves the bundled YAML and JS files so the UI can fetch them for one-click install.

**Step 2: Run tsc --noEmit and pnpm build**

```bash
cd aimeat && npx tsc --noEmit && pnpm build
```

**Step 3: Commit**

```bash
git add aimeat/src/server.ts
git commit -m "feat: serve cortex-bundled directory for one-click extension install"
```

---

## Task 8: Manual testing & polish

**Step 1: Start dev server**

```bash
cd aimeat && pnpm dev
```

**Step 2: Test empty state**

1. Navigate to profile → Extensions tab
2. Verify hero text is user-friendly (not technical jargon)
3. Verify "🤖 Luo AI:lla" button copies prompt to clipboard
4. Verify "+ Lisää" button opens install modal (title says "Lisää" not "Asenna")
5. Verify two bundled extension cards appear (Charts + Canvas)

**Step 3: Test bundled install**

1. Click "Lisää tämä" on Charts card
2. Should install successfully, card appears in grid with 🔒 Private badge
3. Click the card — detail view shows description, prompt, lib, schemas, seed data
4. Activate the extension
5. Repeat for Canvas

**Step 4: Test visibility**

1. In detail view, click "Julkaise"
2. Badge should change to 🌐 Public
3. Click "Tee yksityiseksi" — back to 🔒 Private

**Step 5: Test scaffolding prompt**

1. Click "🤖 Luo AI:lla"
2. Verify toast appears
3. Paste prompt into an AI chat — verify it's comprehensive and includes node URL

**Step 6: Fix any issues found**

**Step 7: Final commit**

```bash
git add -A
git commit -m "fix(ui): polish Extensions tab v2"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Visibility backend support | interface.ts, memory.ts, mongodb.ts, cortex-manifest.ts, cortex.ts |
| 2 | aimeat-charts extension (YAML + JS) | cortex-bundled/aimeat-charts.yaml, .js |
| 3 | aimeat-canvas extension (YAML + JS) | cortex-bundled/aimeat-canvas.yaml, .js |
| 4 | Scaffolding prompt function | profile.js |
| 5 | i18n translation updates | en.json, fi.json |
| 6 | Redesign renderExtensions | profile.js, profile.css |
| 7 | Serve bundled files | server.ts |
| 8 | Manual testing & polish | Various |

**Total: 8 tasks**
