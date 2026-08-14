# Portfolio Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a complete portfolio page system where users build AI-generated portfolio sites, served at public URLs with optional auth-gated sections.

**Architecture:** A Preact SPA view (`views/portfolio.js`) handles both the builder wizard (authenticated) and the public viewer (unauthenticated). A new backend route file (`src/routes/portfolio.ts`) provides the content catalog API, portfolio config storage, and portfolio HTML serving. The portfolio builder generates a prompt the user pastes into any AI chat, which produces a downloadable HTML file they upload back to the node.

**Tech Stack:** Preact + htm (existing SPA stack), Express 5 routes (existing pattern), AIMEAT memory + storage-files APIs (existing), i18n (existing en.json/fi.json)

---

### Task 1: Add Portfolio Config to Backend

**Files:**
- Modify: `src/config.ts:223-230` (add portfolio config fields after cortex block)
- Modify: `src/config.ts:232+` (add defaults in `loadConfig()`)

**Step 1: Add config interface fields**

In `src/config.ts`, add after the cortex block (line 226) and before CORS (line 228):

```typescript
  // Portfolio
  portfolioEnabled: boolean;
  portfolioMaxSizeKb: number;
  portfolioMaxImages: number;
```

**Step 2: Add defaults in loadConfig()**

Find the cortex defaults in `loadConfig()` and add after them:

```typescript
    // Portfolio
    portfolioEnabled: process.env.AIMEAT_PORTFOLIO !== 'false',
    portfolioMaxSizeKb: parseInt(process.env.AIMEAT_PORTFOLIO_MAX_SIZE_KB ?? '512', 10),
    portfolioMaxImages: parseInt(process.env.AIMEAT_PORTFOLIO_MAX_IMAGES ?? '20', 10),
```

**Step 3: Run type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS (new fields have defaults, no consumers yet)

**Step 4: Commit**

```bash
git add src/config.ts
git commit -m "feat(portfolio): add config fields for portfolio feature"
```

---

### Task 2: Create Portfolio Backend Route File

**Files:**
- Create: `src/routes/portfolio.ts`

**Step 1: Create the route file**

```typescript
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, optionalAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';

export function portfolioRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /**
   * GET /v1/portfolio/catalog
   * Returns all publishable content for the authenticated user.
   * Used by the portfolio builder wizard to populate checkboxes.
   */
  router.get('/v1/portfolio/catalog', requireAuth(), async (req, res) => {
    const ownerName = req.auth!.owner;
    const agents = await storage.getAgentsByOwner(ownerName);
    if (!agents.length) {
      res.json(success(config.nodeId, { images: [], apps: [], boards: [], cortex: [], memories: [] }));
      return;
    }

    // Gather images from storage files (portfolio/* and any public images)
    const images: Array<{ key: string; gaii: string; mimeType: string; size: number; url: string }> = [];
    for (const agent of agents) {
      const files = await storage.listStorageFiles(agent.gaii);
      for (const f of files) {
        if (f.mimeType.startsWith('image/')) {
          images.push({
            key: f.key,
            gaii: agent.gaii,
            mimeType: f.mimeType,
            size: f.size,
            url: `/v1/storage/${encodeURIComponent(agent.gaii)}/${encodeURIComponent(f.key)}`,
          });
        }
      }
    }

    // Gather apps
    const apps: Array<{ owner: string; filename: string; size: number; url: string }> = [];
    for (const agent of agents) {
      const files = await storage.listStorageFiles(agent.gaii);
      for (const f of files) {
        if (f.key.startsWith('apps/') && !f.key.startsWith('apps/screenshots/') && f.visibility === 'public') {
          apps.push({
            owner: agent.owner,
            filename: f.key.slice(5),
            size: f.size,
            url: `/v1/apps/${encodeURIComponent(agent.owner)}/${encodeURIComponent(f.key.slice(5))}`,
          });
        }
      }
    }

    // Gather boards owned by user
    const allBoards = await storage.listBoards();
    const myBoards = allBoards.filter(b => agents.some(a => a.gaii === b.ownerGaii));
    const boards = myBoards.map(b => ({
      id: b.id,
      name: b.name,
      visibility: b.visibility,
    }));

    // Gather cortex extensions installed by user
    let cortex: Array<{ name: string; description: string; version: string; tags: string[]; componentTypes: string[] }> = [];
    if (config.cortexEnabled) {
      const allExt = await storage.listCortexExtensions({ namespace: ownerName });
      cortex = allExt.map(e => ({
        name: e.name,
        description: e.description,
        version: e.version,
        tags: e.tags,
        componentTypes: [...new Set(e.components.map(c => c.type))],
      }));
    }

    // Gather public/owner memory entries (exclude system keys)
    const memories: Array<{ key: string; visibility: string; tags: string[] }> = [];
    for (const agent of agents) {
      const mems = await storage.listMemory(agent.gaii);
      for (const m of mems) {
        if (m.visibility !== 'private' && !m.key.startsWith('_sys.')) {
          memories.push({ key: m.key, visibility: m.visibility, tags: m.tags || [] });
        }
      }
    }

    res.json(success(config.nodeId, {
      images: images.slice(0, config.portfolioMaxImages * 2), // offer more than max for selection
      apps,
      boards,
      cortex,
      memories,
    }));
  });

  /**
   * GET /v1/portfolio/config
   * Returns the user's portfolio configuration from memory.
   */
  router.get('/v1/portfolio/config', requireAuth(), async (req, res) => {
    const ownerName = req.auth!.owner;
    const agents = await storage.getAgentsByOwner(ownerName);
    if (!agents.length) {
      res.json(success(config.nodeId, { config: null }));
      return;
    }
    const mem = await storage.getMemory(agents[0].gaii, `portfolio.config`);
    res.json(success(config.nodeId, { config: mem?.value ?? null }));
  });

  /**
   * PUT /v1/portfolio/config
   * Saves the user's portfolio configuration to memory.
   */
  router.put('/v1/portfolio/config', requireAuth(), async (req, res) => {
    const ownerName = req.auth!.owner;
    const agents = await storage.getAgentsByOwner(ownerName);
    if (!agents.length) {
      res.status(400).json(error(config.nodeId, 'NO_AGENT', 'No agent found for this owner'));
      return;
    }
    const body = req.body ?? {};
    await storage.setMemory(agents[0].gaii, 'portfolio.config', body, 'owner', body.tags || ['portfolio']);
    res.json(success(config.nodeId, { saved: true }));
  });

  /**
   * GET /v1/portfolio/data/:username
   * Returns public portfolio data for a user (no auth required for public, auth for gated sections).
   */
  router.get('/v1/portfolio/data/:username', optionalAuth(), async (req, res) => {
    const username = req.params.username as string;
    const ghiiRecord = await storage.getGHIIByOwner(username);
    if (!ghiiRecord) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `User "${username}" not found`));
      return;
    }

    const agents = await storage.getAgentsByOwner(username);
    if (!agents.length) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No agent found for this user'));
      return;
    }

    // Get portfolio config
    const configMem = await storage.getMemory(agents[0].gaii, 'portfolio.config');
    if (!configMem?.value || !(configMem.value as Record<string, unknown>).enabled) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Portfolio not enabled for this user'));
      return;
    }

    const isAuthenticated = !!req.auth;
    const isOwner = req.auth?.owner === username;

    // Check if a generated portfolio HTML file exists in storage
    let portfolioHtml: string | null = null;
    const htmlFile = await storage.getStorageFile(agents[0].gaii, 'portfolio/index.html');
    if (htmlFile) {
      portfolioHtml = htmlFile.data.toString('utf-8');
    }

    res.json(success(config.nodeId, {
      username,
      display_name: ghiiRecord.displayName,
      bio: ghiiRecord.bio,
      avatar: ghiiRecord.avatar,
      has_html: !!portfolioHtml,
      portfolio_html: portfolioHtml,
      viewer_authenticated: isAuthenticated,
      viewer_is_owner: isOwner,
    }));
  });

  return router;
}
```

**Step 2: Run type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add src/routes/portfolio.ts
git commit -m "feat(portfolio): add backend route file with catalog, config, and data endpoints"
```

---

### Task 3: Mount Portfolio Router in Server

**Files:**
- Modify: `src/server.ts:39-52` (add import)
- Modify: `src/server.ts:529` (mount router near portal)

**Step 1: Add import**

After the existing import of `portalRouter` (line 39):

```typescript
import { portfolioRouter } from './routes/portfolio.js';
```

**Step 2: Mount router**

After `app.use(portalRouter(config, storage));` (line 529), add:

```typescript
  if (config.portfolioEnabled) {
    app.use(portfolioRouter(config, storage));
  }
```

**Step 3: Run type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat(portfolio): mount portfolio router in server"
```

---

### Task 4: Add SPA Route for Portfolio (Server-Side)

**Files:**
- Modify: `src/routes/portal.ts:643-662` (add portfolio to spaRoutes)

**Step 1: Add portfolio routes to spaRoutes array**

In portal.ts, find the `spaRoutes` array (line 643) and add:

```typescript
  const spaRoutes = [
    '/v1/profile',
    '/v1/guides',
    '/v1/aimeat-os',
    '/v1/hobbies',
    '/v1/marketplace',
    '/v1/openclaw',
    '/v1/classic',
    '/v1/portfolio',
  ];
```

**Step 2: Add the `/v1/portfolio/me` redirect route**

Add BEFORE the `spaRoutes` loop (to prevent it being caught by the generic handler). Insert before line 643:

```typescript
  // Portfolio /me redirect — lookup authenticated user's username
  router.get('/v1/portfolio/me', requireAuth(), async (req, res) => {
    const ownerName = req.auth!.owner;
    res.redirect(302, `/v1/portfolio/${encodeURIComponent(ownerName)}`);
  });

  // Portfolio public view — /v1/portfolio/:username (parameterized, serves SPA)
  router.get('/v1/portfolio/:username', (_req, res) => {
    const spaPath = resolvePublicFile('spa.html');
    if (spaPath) {
      serveSpa(res, spaPath);
    } else {
      res.redirect(302, '/spa.html');
    }
  });
```

NOTE: Add `requireAuth` to the import at the top of portal.ts if not already imported. Check the existing imports first.

**Step 3: Run type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add src/routes/portal.ts
git commit -m "feat(portfolio): add SPA routes and /me redirect to portal"
```

---

### Task 5: Add Client-Side SPA Routing for Portfolio

**Files:**
- Modify: `public/spa.html:87-104` (add route entry + parameterized matching)

**Step 1: Add portfolio route to ROUTES map**

In spa.html, add to the ROUTES object (after the `/v1/classic` entry, line 95):

```javascript
      '/v1/portfolio':   () => import('/views/portfolio.js' + B),
```

**Step 2: Update matchRoute() to handle parameterized portfolio routes**

Replace the `matchRoute` function (lines 99-105):

```javascript
    function matchRoute(pathname, search) {
      // Dev portal is ?view=dev on /v1/portal
      if (pathname === '/v1/portal' && search.includes('view=dev')) {
        return () => import('/views/portal-dev.js' + B);
      }
      // Portfolio public view: /v1/portfolio/<username>
      if (pathname.startsWith('/v1/portfolio/') && pathname !== '/v1/portfolio/') {
        return () => import('/views/portfolio.js' + B);
      }
      return ROUTES[pathname] || ROUTES['/v1/portal'];
    }
```

**Step 3: Add CSS preload for portfolio view**

In the `<head>` section (after the openclaw.css preload, line 21), add:

```html
  <link rel="stylesheet" href="/css/views/portfolio.css">
```

**Step 4: Commit**

```bash
git add public/spa.html
git commit -m "feat(portfolio): add client-side SPA routing with parameterized path support"
```

---

### Task 6: Create Portfolio CSS

**Files:**
- Create: `public/css/views/portfolio.css`

**Step 1: Create the CSS file**

```css
/* ── Portfolio View ────────────────────────────────────── */

.portfolio-container {
  max-width: 900px;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}

/* ── Builder Wizard ── */
.portfolio-builder {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.portfolio-step {
  background: var(--card-bg, rgba(255,255,255,0.03));
  border: 1px solid var(--border, rgba(255,255,255,0.08));
  border-radius: 12px;
  padding: 1.5rem;
}

.portfolio-step h3 {
  margin: 0 0 1rem;
  font-size: 1.1rem;
  color: var(--text-bright, #fff);
}

.portfolio-step-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--accent, #7c5cff);
  color: #fff;
  font-size: 0.85rem;
  font-weight: 700;
  margin-right: 0.5rem;
}

/* ── Content Checkboxes ── */
.portfolio-source-group {
  margin-bottom: 1.5rem;
}

.portfolio-source-group summary {
  cursor: pointer;
  font-weight: 600;
  color: var(--text-bright, #fff);
  padding: 0.5rem 0;
  user-select: none;
}

.portfolio-source-group summary::marker {
  color: var(--accent, #7c5cff);
}

.portfolio-source-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.5rem 0 0.5rem 1.5rem;
}

.portfolio-source-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.5rem;
  border-radius: 6px;
  transition: background 0.15s;
}

.portfolio-source-item:hover {
  background: rgba(255,255,255,0.04);
}

.portfolio-source-item label {
  cursor: pointer;
  color: var(--text-dim, #aaa);
  font-size: 0.9rem;
}

.portfolio-source-item input[type="checkbox"] {
  accent-color: var(--accent, #7c5cff);
  width: 16px;
  height: 16px;
}

.portfolio-source-meta {
  font-size: 0.75rem;
  color: var(--text-dim, #666);
  margin-left: auto;
}

/* ── Style Selector ── */
.portfolio-options {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0.75rem;
}

.portfolio-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border, rgba(255,255,255,0.08));
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}

.portfolio-option:hover {
  border-color: var(--accent, #7c5cff);
}

.portfolio-option.selected {
  border-color: var(--accent, #7c5cff);
  background: rgba(124,92,255,0.08);
}

.portfolio-option input[type="radio"] {
  accent-color: var(--accent, #7c5cff);
}

/* ── Auth Gate Section ── */
.portfolio-auth-gates {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.5rem 0;
}

/* ── Prompt Output ── */
.portfolio-prompt-output {
  position: relative;
  background: var(--code-bg, rgba(0,0,0,0.3));
  border: 1px solid var(--border, rgba(255,255,255,0.08));
  border-radius: 8px;
  padding: 1rem;
  max-height: 300px;
  overflow-y: auto;
  font-family: var(--font-mono, monospace);
  font-size: 0.8rem;
  line-height: 1.5;
  white-space: pre-wrap;
  color: var(--text-dim, #aaa);
}

.portfolio-prompt-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1rem;
  flex-wrap: wrap;
}

/* ── Instructions ── */
.portfolio-instructions {
  background: rgba(124,92,255,0.06);
  border: 1px solid rgba(124,92,255,0.15);
  border-radius: 8px;
  padding: 1rem 1.25rem;
  margin-top: 1rem;
}

.portfolio-instructions ol {
  margin: 0.5rem 0 0;
  padding-left: 1.2rem;
}

.portfolio-instructions li {
  margin-bottom: 0.4rem;
  color: var(--text-dim, #aaa);
  font-size: 0.9rem;
}

/* ── Public Viewer ── */
.portfolio-viewer {
  min-height: 60vh;
}

.portfolio-viewer-frame {
  width: 100%;
  border: none;
  border-radius: 8px;
  min-height: 70vh;
  background: #fff;
}

.portfolio-not-found {
  text-align: center;
  padding: 4rem 2rem;
  color: var(--text-dim, #888);
}

.portfolio-not-found h2 {
  color: var(--text-bright, #fff);
  margin-bottom: 0.5rem;
}

/* ── Upload Section ── */
.portfolio-upload-zone {
  border: 2px dashed var(--border, rgba(255,255,255,0.15));
  border-radius: 12px;
  padding: 2rem;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}

.portfolio-upload-zone:hover,
.portfolio-upload-zone.dragover {
  border-color: var(--accent, #7c5cff);
  background: rgba(124,92,255,0.04);
}

.portfolio-upload-zone input[type="file"] {
  display: none;
}

/* ── Responsive ── */
@media (max-width: 600px) {
  .portfolio-container {
    padding: 1rem;
  }
  .portfolio-options {
    grid-template-columns: 1fr;
  }
  .portfolio-prompt-actions {
    flex-direction: column;
  }
}
```

**Step 2: Commit**

```bash
git add public/css/views/portfolio.css
git commit -m "feat(portfolio): add portfolio view CSS"
```

---

### Task 7: Add i18n Translation Keys

**Files:**
- Modify: `locales/en.json`
- Modify: `locales/fi.json`

**Step 1: Add English translations**

Add a `"portfolio"` top-level key to en.json:

```json
"portfolio": {
  "title": "Portfolio",
  "tabLabel": "Portfolio",
  "builder": {
    "heading": "Build Your Portfolio",
    "subtitle": "Select your content, choose a style, and generate your portfolio with AI.",
    "step1Title": "Select Content",
    "step2Title": "Style & Purpose",
    "step3Title": "Auth-Gated Sections",
    "step4Title": "Generate Prompt",
    "step5Title": "Upload Portfolio",
    "noContent": "No publishable content found. Upload images or create apps first.",
    "imagesGroup": "Images",
    "appsGroup": "Published Apps",
    "boardsGroup": "Board Posts",
    "cortexGroup": "Cortex Extensions",
    "memoriesGroup": "Memory Entries",
    "portfolioType": "Portfolio type",
    "typeCV": "Professional / CV",
    "typeCreative": "Creative / Art Showcase",
    "typeDev": "Developer / Technical",
    "typePersonal": "Personal / Blog-style",
    "typeCustom": "Custom (describe in prompt)",
    "designStyle": "Design style",
    "styleMinimal": "Minimal & Clean",
    "styleBold": "Bold & Colorful",
    "styleDark": "Dark & Modern",
    "styleClassic": "Classic & Elegant",
    "authGateLabel": "Which sections should require login to view?",
    "gateContact": "Contact information",
    "gateProjectDetails": "Project details",
    "gateDownloads": "Download links",
    "gateCustom": "Custom sections (specify in prompt)",
    "generateBtn": "Generate Prompt",
    "copyPrompt": "Copy Prompt to Clipboard",
    "downloadPrompt": "Download as .txt",
    "promptCopied": "Copied!",
    "instructions": "Instructions",
    "inst1": "Copy the prompt above or download it",
    "inst2": "Paste it into any AI chat (ChatGPT, Claude, etc.)",
    "inst3": "The AI will create your portfolio as a downloadable HTML file",
    "inst4": "Upload the HTML file below to publish it",
    "uploadTitle": "Upload Your Portfolio HTML",
    "uploadDragDrop": "Drag & drop your HTML file here, or click to browse",
    "uploadBtn": "Upload & Publish",
    "uploadSuccess": "Portfolio published!",
    "uploadSizeError": "File too large. Maximum size: {max}KB",
    "enabled": "Portfolio published",
    "disabled": "Portfolio hidden",
    "viewPublic": "View public portfolio",
    "regenerate": "Regenerate",
    "delete": "Delete portfolio"
  },
  "viewer": {
    "notFound": "Portfolio not found",
    "notFoundDesc": "This user hasn't published a portfolio yet.",
    "loginToSeeMore": "Log in to see more content",
    "backToPortal": "Back to portal"
  }
}
```

**Step 2: Add Finnish translations**

Add a `"portfolio"` top-level key to fi.json:

```json
"portfolio": {
  "title": "Portfolio",
  "tabLabel": "Portfolio",
  "builder": {
    "heading": "Rakenna portfoliosi",
    "subtitle": "Valitse sis\u00e4lt\u00f6si, tyyli ja luo portfolio teko\u00e4lyn avulla.",
    "step1Title": "Valitse sis\u00e4lt\u00f6",
    "step2Title": "Tyyli ja tarkoitus",
    "step3Title": "Kirjautumista vaativat osiot",
    "step4Title": "Luo prompti",
    "step5Title": "Lataa portfolio",
    "noContent": "Julkaistavaa sis\u00e4lt\u00f6\u00e4 ei l\u00f6ytynyt. Lataa kuvia tai luo sovelluksia ensin.",
    "imagesGroup": "Kuvat",
    "appsGroup": "Julkaistut sovellukset",
    "boardsGroup": "Foorumiviestit",
    "cortexGroup": "Cortex-laajennukset",
    "memoriesGroup": "Muistimerkinn\u00e4t",
    "portfolioType": "Portfolion tyyppi",
    "typeCV": "Ammatillinen / CV",
    "typeCreative": "Luova / Taidegalleria",
    "typeDev": "Kehitt\u00e4j\u00e4 / Tekninen",
    "typePersonal": "Henkil\u00f6kohtainen / Blogi",
    "typeCustom": "Mukautettu (kuvaile promptissa)",
    "designStyle": "Visuaalinen tyyli",
    "styleMinimal": "Minimalistinen ja selke\u00e4",
    "styleBold": "Rohkea ja v\u00e4rik\u00e4s",
    "styleDark": "Tumma ja moderni",
    "styleClassic": "Klassinen ja tyylik\u00e4s",
    "authGateLabel": "Mitk\u00e4 osiot vaativat kirjautumisen?",
    "gateContact": "Yhteystiedot",
    "gateProjectDetails": "Projektien tiedot",
    "gateDownloads": "Latauslinkit",
    "gateCustom": "Mukautetut osiot (m\u00e4\u00e4rit\u00e4 promptissa)",
    "generateBtn": "Luo prompti",
    "copyPrompt": "Kopioi leikep\u00f6yd\u00e4lle",
    "downloadPrompt": "Lataa .txt-tiedostona",
    "promptCopied": "Kopioitu!",
    "instructions": "Ohjeet",
    "inst1": "Kopioi yll\u00e4 oleva prompti tai lataa se",
    "inst2": "Liit\u00e4 se mihin tahansa AI-chattiin (ChatGPT, Claude jne.)",
    "inst3": "AI luo portfoliosi ladattavana HTML-tiedostona",
    "inst4": "Lataa HTML-tiedosto alle julkaistaksesi sen",
    "uploadTitle": "Lataa portfolio-HTML",
    "uploadDragDrop": "Ved\u00e4 ja pudota HTML-tiedosto t\u00e4h\u00e4n tai napsauta selataksesi",
    "uploadBtn": "Lataa ja julkaise",
    "uploadSuccess": "Portfolio julkaistu!",
    "uploadSizeError": "Tiedosto liian suuri. Enimm\u00e4iskoko: {max}KB",
    "enabled": "Portfolio julkaistu",
    "disabled": "Portfolio piilotettu",
    "viewPublic": "N\u00e4yt\u00e4 julkinen portfolio",
    "regenerate": "Luo uudelleen",
    "delete": "Poista portfolio"
  },
  "viewer": {
    "notFound": "Portfoliota ei l\u00f6ytynyt",
    "notFoundDesc": "T\u00e4m\u00e4 k\u00e4ytt\u00e4j\u00e4 ei ole julkaissut portfoliota.",
    "loginToSeeMore": "Kirjaudu sis\u00e4\u00e4n n\u00e4hd\u00e4ksesi lis\u00e4\u00e4",
    "backToPortal": "Takaisin portaaliin"
  }
}
```

**Step 3: Commit**

```bash
git add locales/en.json locales/fi.json
git commit -m "feat(portfolio): add i18n translations (en + fi)"
```

---

### Task 8: Add Portfolio Tab to Profile Page

**Files:**
- Modify: `public/views/profile.js:546-562`

**Step 1: Insert portfolio tab as the first entry in TABS**

Replace the TABS array so `portfolio` is at index 0 (before `agents`):

```javascript
const TABS = [
  { id:'portfolio', key:'portfolio.tabLabel' },
  { id:'agents', key:'profile.tabs.agents' },
  { id:'chatsessions', key:'profile.tabs.chatSessions' },
  { id:'wallet', key:'profile.tabs.wallet' },
  { id:'memory', key:'profile.tabs.memory' },
  { id:'work', key:'profile.tabs.work' },
  { id:'actions', key:'profile.tabs.services' },
  { id:'boards', key:'profile.tabs.boards' },
  { id:'apps', key:'profile.tabs.apps' },
  { id:'extensions', key:'profile.tabs.extensions' },
  { id:'federation', key:'profile.tabs.federation' },
  { id:'nodes', key:'profile.tabs.nodes' },
  { id:'access', key:'profile.tabs.access' },
  { id:'dataWallet', key:'profile.tabs.dataWallet' },
  { id:'nodeStats', key:'profile.tabs.nodeStats' },
  { id:'security', key:'profile.tabs.security' },
];
```

**Step 2: Add the portfolio tab render case**

In the Profile component's tab content render section (search for the switch/if-else block that renders based on `activeTab`), add:

```javascript
      ${activeTab === 'portfolio' && html`
        <div class="tab-content">
          <div style="text-align:center; padding:2rem;">
            <h3>${t('portfolio.builder.heading')}</h3>
            <p style="color:var(--text-dim); margin-bottom:1.5rem;">${t('portfolio.builder.subtitle')}</p>
            <button class="btn btn-primary" onClick=${() => navigate('/v1/portfolio')}>
              ${t('portfolio.builder.heading')}
            </button>
            <br/><br/>
            ${session && html`
              <a href="/v1/portfolio/${encodeURIComponent(session.owner)}" class="btn btn-ghost" target="_blank">
                ${t('portfolio.builder.viewPublic')}
              </a>
            `}
          </div>
        </div>
      `}
```

**Step 3: Commit**

```bash
git add public/views/profile.js
git commit -m "feat(portfolio): add portfolio tab to profile view"
```

---

### Task 9: Create Portfolio View — Builder Wizard + Public Viewer

**Files:**
- Create: `public/views/portfolio.js`

**Step 1: Create the full portfolio view**

This is the largest file. It handles two modes:
- **Builder mode** (`/v1/portfolio`): Authenticated user builds their portfolio prompt
- **Viewer mode** (`/v1/portfolio/:username`): Anyone views a published portfolio

```javascript
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, copyToClipboard } from '/js/utils.js';
import { apiGet, apiPost, apiPut } from '/js/api.js';

const NODE_URL = typeof window !== 'undefined' ? window.location.origin : '';

/* ── Auth helpers ── */
function getSession() {
  const a = window.AIMEAT?.auth;
  if (!a || typeof a.getSession !== 'function') return null;
  const s = a.getSession();
  if (!s || !s.jwt) return null;
  return s;
}

/* ── Portfolio Types ── */
const PORTFOLIO_TYPES = [
  { id: 'cv', key: 'portfolio.builder.typeCV' },
  { id: 'creative', key: 'portfolio.builder.typeCreative' },
  { id: 'dev', key: 'portfolio.builder.typeDev' },
  { id: 'personal', key: 'portfolio.builder.typePersonal' },
  { id: 'custom', key: 'portfolio.builder.typeCustom' },
];

const DESIGN_STYLES = [
  { id: 'minimal', key: 'portfolio.builder.styleMinimal' },
  { id: 'bold', key: 'portfolio.builder.styleBold' },
  { id: 'dark', key: 'portfolio.builder.styleDark' },
  { id: 'classic', key: 'portfolio.builder.styleClassic' },
];

const AUTH_GATES = [
  { id: 'contact', key: 'portfolio.builder.gateContact' },
  { id: 'projectDetails', key: 'portfolio.builder.gateProjectDetails' },
  { id: 'downloads', key: 'portfolio.builder.gateDownloads' },
  { id: 'custom', key: 'portfolio.builder.gateCustom' },
];

/* ── Prompt Builder ── */
function buildPortfolioPrompt({ session, catalog, selectedImages, selectedApps, selectedBoards, selectedCortex, selectedMemories, portfolioType, designStyle, authGates }) {
  const ghii = session.ghii || (session.owner + '@unknown');
  const url = NODE_URL;

  let prompt = `You are a portfolio website builder for AIMEAT.

The user wants to create a personal portfolio website. Generate a single, self-contained, downloadable HTML file.

## User Context
- GHII: ${ghii}
- Display Name: ${session.displayName || session.owner}
- Node URL: ${url}
`;

  // Selected images
  if (selectedImages.length > 0) {
    prompt += `\n## Selected Images (from AIMEAT storage)\n`;
    for (const img of selectedImages) {
      const sizeKb = Math.round(img.size / 1024);
      prompt += `- ${img.key} (${sizeKb}KB, ${img.mimeType}) \u2192 ${url}${img.url}\n`;
    }
  }

  // Selected apps
  if (selectedApps.length > 0) {
    prompt += `\n## Published Apps\n`;
    for (const app of selectedApps) {
      prompt += `- ${app.filename} \u2192 ${url}${app.url}\n`;
    }
  }

  // Selected boards
  if (selectedBoards.length > 0) {
    prompt += `\n## Boards (published discussions)\n`;
    for (const board of selectedBoards) {
      prompt += `- ${board.name} (${board.visibility}) \u2192 ${url}/v1/boards/${board.id}/posts\n`;
    }
  }

  // Selected cortex extensions
  if (selectedCortex.length > 0) {
    prompt += `\n## Cortex Extensions\n`;
    for (const ext of selectedCortex) {
      prompt += `- ${ext.name} v${ext.version} \u2014 "${ext.description}"\n`;
      prompt += `  Components: ${ext.componentTypes.join(', ')}\n`;
    }
  }

  // Selected memory entries
  if (selectedMemories.length > 0) {
    prompt += `\n## Memory Entries\n`;
    prompt += `These entries can be fetched live from the node API for dynamic portfolio content:\n`;
    for (const mem of selectedMemories) {
      prompt += `- ${mem.key} (${mem.visibility}) \u2192 GET ${url}/v1/memory/${encodeURIComponent(mem.key)}\n`;
    }
  }

  // Portfolio requirements
  const typeLabels = { cv: 'Professional / CV', creative: 'Creative / Art Showcase', dev: 'Developer / Technical', personal: 'Personal / Blog-style', custom: 'Custom' };
  const styleLabels = { minimal: 'Minimal & Clean', bold: 'Bold & Colorful', dark: 'Dark & Modern', classic: 'Classic & Elegant' };

  prompt += `
## Portfolio Requirements
- Type: ${typeLabels[portfolioType] || portfolioType}
- Design Style: ${styleLabels[designStyle] || designStyle}
`;

  // Auth-gated sections
  if (authGates.length > 0) {
    const gateLabels = { contact: 'Contact information', projectDetails: 'Project details', downloads: 'Download links', custom: 'Custom sections (ask user)' };
    prompt += `- Auth-gated sections (show only to logged-in viewers):\n`;
    for (const gate of authGates) {
      prompt += `  - ${gateLabels[gate] || gate}\n`;
    }
  }

  prompt += `
## Technical Requirements
- Generate a SINGLE downloadable HTML file with ALL CSS inline (no external dependencies)
- Images: Reference via absolute AIMEAT storage URLs (they are publicly accessible)
- If memory entries are selected: Fetch them live with fetch() calls to the node API URLs above
- Mobile-responsive design (works on phone, tablet, desktop)
- Include proper <meta> tags for SEO and social sharing (og:title, og:description, og:image)
`;

  if (authGates.length > 0) {
    prompt += `
## Auth-Gated Sections Implementation
Sections marked as auth-gated should be hidden by default and only shown when the viewer is
logged in to the AIMEAT node. Use this detection pattern:

\`\`\`javascript
// Check if the viewer is authenticated on this AIMEAT node
const isLoggedIn = window.AIMEAT?.auth?.hasSession?.() || false;
document.querySelectorAll('[data-auth-required]').forEach(el => {
  el.style.display = isLoggedIn ? '' : 'none';
});
// Show placeholder for unauthenticated viewers
document.querySelectorAll('[data-auth-placeholder]').forEach(el => {
  el.style.display = isLoggedIn ? 'none' : '';
});
\`\`\`

Wrap auth-gated content in \`<div data-auth-required>\` and add a placeholder:
\`<div data-auth-placeholder>Log in to see more content</div>\`

NOTE: This is a convenience feature, not a security boundary. The content is in the HTML source.
For truly private data, use the AIMEAT consent system.
`;
  }

  prompt += `
## Debug Panel
Include a hidden debug panel (toggle with Ctrl+Shift+D) that shows:
- Auth state (logged in / anonymous)
- Number of loaded images, their URLs and load status
- API fetch activity log (if memory entries are used)
- Section visibility states
- Any JavaScript errors
Style it as a fixed overlay, semi-transparent dark background, monospace font.

## Delivery
After generating the HTML, tell the user:
1. Save the HTML file
2. Go to their AIMEAT profile page
3. Navigate to the Portfolio tab
4. Upload the HTML file to publish it at: ${url}/v1/portfolio/${session.owner}
`;

  return prompt;
}


/* ── Builder Component ── */
function PortfolioBuilder({ session, navigate }) {
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Selections
  const [selectedImages, setSelectedImages] = useState(new Set());
  const [selectedApps, setSelectedApps] = useState(new Set());
  const [selectedBoards, setSelectedBoards] = useState(new Set());
  const [selectedCortex, setSelectedCortex] = useState(new Set());
  const [selectedMemories, setSelectedMemories] = useState(new Set());

  // Style
  const [portfolioType, setPortfolioType] = useState('dev');
  const [designStyle, setDesignStyle] = useState('dark');
  const [authGates, setAuthGates] = useState(new Set());

  // Prompt
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);

  // Upload
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);
  const fileInputRef = useRef(null);
  const [dragover, setDragover] = useState(false);

  // Existing portfolio state
  const [existingConfig, setExistingConfig] = useState(null);

  // Load catalog + existing config
  useEffect(() => {
    if (!session) return;
    Promise.all([
      apiGet('/v1/portfolio/catalog'),
      apiGet('/v1/portfolio/config'),
    ]).then(([catRes, cfgRes]) => {
      if (catRes.ok !== false && catRes.data) setCatalog(catRes.data);
      else setError('Failed to load content catalog');
      if (cfgRes.ok !== false && cfgRes.data?.config) setExistingConfig(cfgRes.data.config);
      setLoading(false);
    }).catch(() => {
      setError('Network error');
      setLoading(false);
    });
  }, [session]);

  // Toggle helpers
  const toggleSet = (setter, value) => {
    setter(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  };
  const toggleAll = (setter, items, keyFn) => {
    setter(prev => {
      const keys = items.map(keyFn);
      const allSelected = keys.every(k => prev.has(k));
      if (allSelected) return new Set();
      return new Set(keys);
    });
  };

  // Generate prompt
  const handleGenerate = () => {
    if (!catalog) return;
    const imgList = catalog.images.filter(i => selectedImages.has(i.key));
    const appList = catalog.apps.filter(a => selectedApps.has(a.filename));
    const boardList = catalog.boards.filter(b => selectedBoards.has(b.id));
    const cortexList = catalog.cortex.filter(c => selectedCortex.has(c.name));
    const memList = catalog.memories.filter(m => selectedMemories.has(m.key));

    const prompt = buildPortfolioPrompt({
      session,
      catalog,
      selectedImages: imgList,
      selectedApps: appList,
      selectedBoards: boardList,
      selectedCortex: cortexList,
      selectedMemories: memList,
      portfolioType,
      designStyle,
      authGates: [...authGates],
    });
    setGeneratedPrompt(prompt);

    // Save config
    apiPut('/v1/portfolio/config', {
      enabled: existingConfig?.enabled || false,
      portfolioType,
      designStyle,
      authGates: [...authGates],
      selectedImages: [...selectedImages],
      selectedApps: [...selectedApps],
      selectedBoards: [...selectedBoards],
      selectedCortex: [...selectedCortex],
      selectedMemories: [...selectedMemories],
      tags: ['portfolio'],
    });
  };

  // Copy prompt
  const handleCopyPrompt = async () => {
    await copyToClipboard(generatedPrompt);
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 2000);
  };

  // Download prompt as .txt
  const handleDownloadPrompt = () => {
    const blob = new Blob([generatedPrompt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'portfolio-prompt.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Upload HTML
  const handleUpload = async (file) => {
    if (!file || !file.name.endsWith('.html')) {
      setUploadStatus({ ok: false, msg: 'Please select an HTML file' });
      return;
    }
    const text = await file.text();
    const sizeKb = Math.round(text.length / 1024);

    setUploading(true);
    setUploadStatus(null);

    // Upload via storage files API
    const formData = new FormData();
    formData.append('file', file);

    try {
      const resp = await fetch('/v1/storage/portfolio/index.html', {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + session.jwt,
          'Content-Type': 'text/html',
          'X-Visibility': 'public',
        },
        body: text,
      });
      const result = await resp.json();
      if (resp.ok) {
        // Enable portfolio
        await apiPut('/v1/portfolio/config', {
          ...(existingConfig || {}),
          enabled: true,
          portfolioType,
          designStyle,
          authGates: [...authGates],
          publishedAt: new Date().toISOString(),
          htmlSizeKb: sizeKb,
          tags: ['portfolio'],
        });
        setExistingConfig({ ...(existingConfig || {}), enabled: true });
        setUploadStatus({ ok: true, msg: t('portfolio.builder.uploadSuccess') });
      } else {
        setUploadStatus({ ok: false, msg: result.error?.message || 'Upload failed' });
      }
    } catch (err) {
      setUploadStatus({ ok: false, msg: err.message || 'Network error' });
    }
    setUploading(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragover(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleUpload(file);
  };

  // Render
  if (loading) return html`<div class="portfolio-container"><div class="view-loading">${t('loading') || 'Loading...'}</div></div>`;
  if (error) return html`<div class="portfolio-container"><div class="alert alert-error">${escHtml(error)}</div></div>`;
  if (!session) return html`<div class="portfolio-container"><div class="portfolio-not-found"><h2>${t('nav.signIn')}</h2><p>Sign in to build your portfolio.</p></div></div>`;

  const hasContent = catalog && (catalog.images.length || catalog.apps.length || catalog.boards.length || catalog.cortex.length || catalog.memories.length);

  return html`
    <div class="portfolio-container">
      <h1>${t('portfolio.builder.heading')}</h1>
      <p style="color:var(--text-dim); margin-bottom:2rem;">${t('portfolio.builder.subtitle')}</p>

      ${existingConfig?.enabled && html`
        <div style="margin-bottom:1.5rem; padding:0.75rem 1rem; background:rgba(80,200,120,0.08); border:1px solid rgba(80,200,120,0.2); border-radius:8px; display:flex; align-items:center; gap:0.75rem;">
          <span style="color:#50c878;">●</span>
          <span>${t('portfolio.builder.enabled')}</span>
          <a href="/v1/portfolio/${encodeURIComponent(session.owner)}" target="_blank" style="margin-left:auto;">${t('portfolio.builder.viewPublic')}</a>
        </div>
      `}

      <div class="portfolio-builder">

        <!-- Step 1: Select Content -->
        <div class="portfolio-step">
          <h3><span class="portfolio-step-number">1</span> ${t('portfolio.builder.step1Title')}</h3>

          ${!hasContent && html`<p style="color:var(--text-dim);">${t('portfolio.builder.noContent')}</p>`}

          ${catalog.images.length > 0 && html`
            <details class="portfolio-source-group" open>
              <summary>${t('portfolio.builder.imagesGroup')} (${catalog.images.length})</summary>
              <div class="portfolio-source-list">
                ${catalog.images.map(img => html`
                  <div class="portfolio-source-item">
                    <input type="checkbox" id=${'img-' + img.key} checked=${selectedImages.has(img.key)}
                      onChange=${() => toggleSet(setSelectedImages, img.key)} />
                    <label for=${'img-' + img.key}>${img.key}</label>
                    <span class="portfolio-source-meta">${Math.round(img.size / 1024)}KB \u2022 ${img.mimeType.split('/')[1]}</span>
                  </div>
                `)}
              </div>
            </details>
          `}

          ${catalog.apps.length > 0 && html`
            <details class="portfolio-source-group">
              <summary>${t('portfolio.builder.appsGroup')} (${catalog.apps.length})</summary>
              <div class="portfolio-source-list">
                ${catalog.apps.map(app => html`
                  <div class="portfolio-source-item">
                    <input type="checkbox" id=${'app-' + app.filename} checked=${selectedApps.has(app.filename)}
                      onChange=${() => toggleSet(setSelectedApps, app.filename)} />
                    <label for=${'app-' + app.filename}>${app.filename}</label>
                    <span class="portfolio-source-meta">${Math.round(app.size / 1024)}KB</span>
                  </div>
                `)}
              </div>
            </details>
          `}

          ${catalog.boards.length > 0 && html`
            <details class="portfolio-source-group">
              <summary>${t('portfolio.builder.boardsGroup')} (${catalog.boards.length})</summary>
              <div class="portfolio-source-list">
                ${catalog.boards.map(board => html`
                  <div class="portfolio-source-item">
                    <input type="checkbox" id=${'brd-' + board.id} checked=${selectedBoards.has(board.id)}
                      onChange=${() => toggleSet(setSelectedBoards, board.id)} />
                    <label for=${'brd-' + board.id}>${board.name}</label>
                    <span class="portfolio-source-meta">${board.visibility}</span>
                  </div>
                `)}
              </div>
            </details>
          `}

          ${catalog.cortex.length > 0 && html`
            <details class="portfolio-source-group">
              <summary>${t('portfolio.builder.cortexGroup')} (${catalog.cortex.length})</summary>
              <div class="portfolio-source-list">
                ${catalog.cortex.map(ext => html`
                  <div class="portfolio-source-item">
                    <input type="checkbox" id=${'ctx-' + ext.name} checked=${selectedCortex.has(ext.name)}
                      onChange=${() => toggleSet(setSelectedCortex, ext.name)} />
                    <label for=${'ctx-' + ext.name}>${ext.name} v${ext.version}</label>
                    <span class="portfolio-source-meta">${ext.componentTypes.join(', ')}</span>
                  </div>
                `)}
              </div>
            </details>
          `}

          ${catalog.memories.length > 0 && html`
            <details class="portfolio-source-group">
              <summary>${t('portfolio.builder.memoriesGroup')} (${catalog.memories.length})</summary>
              <div class="portfolio-source-list">
                ${catalog.memories.map(mem => html`
                  <div class="portfolio-source-item">
                    <input type="checkbox" id=${'mem-' + mem.key} checked=${selectedMemories.has(mem.key)}
                      onChange=${() => toggleSet(setSelectedMemories, mem.key)} />
                    <label for=${'mem-' + mem.key}>${mem.key}</label>
                    <span class="portfolio-source-meta">${mem.visibility} ${mem.tags.length ? '\u2022 ' + mem.tags.join(', ') : ''}</span>
                  </div>
                `)}
              </div>
            </details>
          `}
        </div>

        <!-- Step 2: Style & Purpose -->
        <div class="portfolio-step">
          <h3><span class="portfolio-step-number">2</span> ${t('portfolio.builder.step2Title')}</h3>

          <p style="color:var(--text-bright); font-size:0.95rem; margin-bottom:0.5rem;">${t('portfolio.builder.portfolioType')}</p>
          <div class="portfolio-options">
            ${PORTFOLIO_TYPES.map(pt => html`
              <div class="portfolio-option ${portfolioType === pt.id ? 'selected' : ''}"
                onClick=${() => setPortfolioType(pt.id)}>
                <input type="radio" name="ptype" checked=${portfolioType === pt.id} />
                <span>${t(pt.key)}</span>
              </div>
            `)}
          </div>

          <p style="color:var(--text-bright); font-size:0.95rem; margin:1.5rem 0 0.5rem;">${t('portfolio.builder.designStyle')}</p>
          <div class="portfolio-options">
            ${DESIGN_STYLES.map(ds => html`
              <div class="portfolio-option ${designStyle === ds.id ? 'selected' : ''}"
                onClick=${() => setDesignStyle(ds.id)}>
                <input type="radio" name="dstyle" checked=${designStyle === ds.id} />
                <span>${t(ds.key)}</span>
              </div>
            `)}
          </div>
        </div>

        <!-- Step 3: Auth-Gated Sections -->
        <div class="portfolio-step">
          <h3><span class="portfolio-step-number">3</span> ${t('portfolio.builder.step3Title')}</h3>
          <p style="color:var(--text-dim); font-size:0.9rem; margin-bottom:0.75rem;">${t('portfolio.builder.authGateLabel')}</p>
          <div class="portfolio-auth-gates">
            ${AUTH_GATES.map(gate => html`
              <div class="portfolio-source-item">
                <input type="checkbox" id=${'gate-' + gate.id} checked=${authGates.has(gate.id)}
                  onChange=${() => toggleSet(setAuthGates, gate.id)} />
                <label for=${'gate-' + gate.id}>${t(gate.key)}</label>
              </div>
            `)}
          </div>
        </div>

        <!-- Step 4: Generate Prompt -->
        <div class="portfolio-step">
          <h3><span class="portfolio-step-number">4</span> ${t('portfolio.builder.step4Title')}</h3>

          <button class="btn btn-primary" onClick=${handleGenerate} style="margin-bottom:1rem;">
            ${t('portfolio.builder.generateBtn')}
          </button>

          ${generatedPrompt && html`
            <div class="portfolio-prompt-output">${generatedPrompt}</div>
            <div class="portfolio-prompt-actions">
              <button class="btn btn-primary" onClick=${handleCopyPrompt}>
                ${promptCopied ? t('portfolio.builder.promptCopied') : t('portfolio.builder.copyPrompt')}
              </button>
              <button class="btn btn-ghost" onClick=${handleDownloadPrompt}>
                ${t('portfolio.builder.downloadPrompt')}
              </button>
            </div>

            <div class="portfolio-instructions">
              <strong>${t('portfolio.builder.instructions')}</strong>
              <ol>
                <li>${t('portfolio.builder.inst1')}</li>
                <li>${t('portfolio.builder.inst2')}</li>
                <li>${t('portfolio.builder.inst3')}</li>
                <li>${t('portfolio.builder.inst4')}</li>
              </ol>
            </div>
          `}
        </div>

        <!-- Step 5: Upload Portfolio HTML -->
        <div class="portfolio-step">
          <h3><span class="portfolio-step-number">5</span> ${t('portfolio.builder.step5Title')}</h3>

          <div class="portfolio-upload-zone ${dragover ? 'dragover' : ''}"
            onClick=${() => fileInputRef.current?.click()}
            onDragOver=${(e) => { e.preventDefault(); setDragover(true); }}
            onDragLeave=${() => setDragover(false)}
            onDrop=${handleDrop}>
            <input type="file" accept=".html" ref=${fileInputRef}
              onChange=${(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
            <p style="margin:0; color:var(--text-dim);">
              ${uploading ? '...' : t('portfolio.builder.uploadDragDrop')}
            </p>
          </div>

          ${uploadStatus && html`
            <div style="margin-top:0.75rem; padding:0.5rem 1rem; border-radius:8px;
              background:${uploadStatus.ok ? 'rgba(80,200,120,0.08)' : 'rgba(255,80,80,0.08)'};
              border:1px solid ${uploadStatus.ok ? 'rgba(80,200,120,0.2)' : 'rgba(255,80,80,0.2)'};
              color:${uploadStatus.ok ? '#50c878' : '#ff5050'};">
              ${uploadStatus.msg}
            </div>
          `}
        </div>

      </div>

      <div style="margin-top:2rem;">
        <button class="btn btn-ghost" onClick=${() => navigate('/v1/profile')}>
          ${t('portfolio.viewer.backToPortal')}
        </button>
      </div>
    </div>
  `;
}


/* ── Viewer Component ── */
function PortfolioViewer({ username, navigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${NODE_URL}/v1/portfolio/data/${encodeURIComponent(username)}`)
      .then(r => r.json())
      .then(result => {
        if (result.ok === false) {
          setError(result.error?.message || 'Not found');
        } else {
          setData(result.data);
        }
        setLoading(false);
      })
      .catch(() => {
        setError('Network error');
        setLoading(false);
      });
  }, [username]);

  if (loading) return html`<div class="portfolio-container"><div class="view-loading">Loading portfolio...</div></div>`;

  if (error || !data) {
    return html`
      <div class="portfolio-container">
        <div class="portfolio-not-found">
          <h2>${t('portfolio.viewer.notFound')}</h2>
          <p>${t('portfolio.viewer.notFoundDesc')}</p>
          <button class="btn btn-ghost" style="margin-top:1rem;" onClick=${() => navigate('/v1/portal')}>
            ${t('portfolio.viewer.backToPortal')}
          </button>
        </div>
      </div>
    `;
  }

  // If portfolio HTML exists, render it in a sandboxed iframe
  if (data.has_html && data.portfolio_html) {
    const blob = new Blob([data.portfolio_html], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);

    return html`
      <div class="portfolio-container portfolio-viewer">
        <div style="display:flex; align-items:center; gap:1rem; margin-bottom:1rem;">
          <button class="btn btn-ghost" onClick=${() => navigate('/v1/portal')}>
            \u2190 ${t('portfolio.viewer.backToPortal')}
          </button>
          <span style="color:var(--text-dim);">${escHtml(data.display_name || username)}'s portfolio</span>
        </div>
        <iframe class="portfolio-viewer-frame" src=${blobUrl}
          sandbox="allow-scripts allow-same-origin"
          onLoad=${(e) => {
            // Auto-resize iframe to content height
            try {
              const h = e.target.contentDocument?.body?.scrollHeight;
              if (h) e.target.style.height = h + 40 + 'px';
            } catch (_) { /* cross-origin — ignore */ }
          }}
        ></iframe>
      </div>
    `;
  }

  // No portfolio HTML — show basic profile info
  return html`
    <div class="portfolio-container">
      <div class="portfolio-not-found">
        <h2>${escHtml(data.display_name || username)}</h2>
        <p>${data.bio ? escHtml(data.bio) : t('portfolio.viewer.notFoundDesc')}</p>
        <button class="btn btn-ghost" style="margin-top:1rem;" onClick=${() => navigate('/v1/portal')}>
          ${t('portfolio.viewer.backToPortal')}
        </button>
      </div>
    </div>
  `;
}


/* ── Main Export ── */
export default function Portfolio({ navigate, locale }) {
  const [session, setSession] = useState(null);

  useEffect(() => {
    const s = getSession();
    if (s) setSession(s);
    const handler = () => setSession(getSession());
    window.addEventListener('aimeat-auth-change', handler);
    return () => window.removeEventListener('aimeat-auth-change', handler);
  }, []);

  // Determine mode from URL
  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  const match = path.match(/^\/v1\/portfolio\/(.+)$/);
  const username = match ? decodeURIComponent(match[1]) : null;

  // /v1/portfolio/:username → viewer mode
  if (username) {
    return html`<${PortfolioViewer} username=${username} navigate=${navigate} />`;
  }

  // /v1/portfolio → builder mode (requires auth)
  return html`<${PortfolioBuilder} session=${session} navigate=${navigate} />`;
}
```

**Step 2: Run type-check (JS files don't type-check, but verify no syntax errors by loading dev server)**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS (only checks .ts files; the .js view file is not type-checked)

**Step 3: Commit**

```bash
git add public/views/portfolio.js
git commit -m "feat(portfolio): add complete portfolio view with builder wizard and public viewer"
```

---

### Task 10: Add requireAuth Import to Portal Route

**Files:**
- Modify: `src/routes/portal.ts:1-8` (add requireAuth import if missing)

**Step 1: Check and add import**

The `/v1/portfolio/me` redirect needs `requireAuth`. Check if portal.ts already imports it. If not, add:

```typescript
import { requireAuth } from '../auth/middleware.js';
```

**Step 2: Run type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add src/routes/portal.ts
git commit -m "feat(portfolio): add requireAuth import for /me redirect"
```

---

### Task 11: Full Type-Check and Dev Server Smoke Test

**Step 1: Type-check the entire project**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS with 0 errors

**Step 2: Start dev server and verify endpoints**

Run: `cd aimeat && pnpm dev`

Then in another terminal verify:

```bash
# SPA routes should return HTML
curl -s -o /dev/null -w "%{http_code}" http://localhost:40050/v1/portfolio
# Expected: 200

curl -s -o /dev/null -w "%{http_code}" http://localhost:40050/v1/portfolio/testuser
# Expected: 200

# /me without auth should fail
curl -s -o /dev/null -w "%{http_code}" http://localhost:40050/v1/portfolio/me
# Expected: 401

# API catalog without auth should fail
curl -s -o /dev/null -w "%{http_code}" http://localhost:40050/v1/portfolio/catalog
# Expected: 401

# Data endpoint for nonexistent user should return 404
curl -s http://localhost:40050/v1/portfolio/data/nonexistent | head -c 200
# Expected: {"ok":false,...,"error":{"code":"NOT_FOUND"...}}
```

**Step 3: Commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(portfolio): address any issues found during smoke test"
```

---

### Task 12: Update .env.example

**Files:**
- Modify: `aimeat/.env.example`

**Step 1: Add portfolio config variables**

Find the cortex section and add after it:

```bash
# ── Portfolio ──
# AIMEAT_PORTFOLIO=true              # Enable portfolio feature (default: true)
# AIMEAT_PORTFOLIO_MAX_SIZE_KB=512   # Max portfolio HTML file size (default: 512KB)
# AIMEAT_PORTFOLIO_MAX_IMAGES=20     # Max images selectable for portfolio prompt (default: 20)
```

**Step 2: Commit**

```bash
git add .env.example
git commit -m "docs(portfolio): add portfolio config to .env.example"
```

---

### Task 13: Final Consolidated Commit

**Step 1: Verify everything compiles**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 2: Verify file list**

The complete set of new/modified files should be:

**New files (3):**
- `src/routes/portfolio.ts`
- `public/views/portfolio.js`
- `public/css/views/portfolio.css`

**Modified files (7):**
- `src/config.ts` — portfolio config fields
- `src/server.ts` — import + mount portfolio router
- `src/routes/portal.ts` — SPA routes + /me redirect + parameterized route
- `public/spa.html` — route entry + CSS preload + matchRoute() update
- `public/views/profile.js` — TABS array with portfolio tab
- `locales/en.json` — portfolio translations
- `locales/fi.json` — portfolio translations
- `.env.example` — portfolio env vars

---

Plan complete and saved to `docs/plans/2026-03-06-portfolio-page-plan.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
