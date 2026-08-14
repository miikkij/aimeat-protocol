# Portfolio Page Feature — Research & Feasibility Analysis

**Date:** 2026-03-06
**Status:** Research / Pre-design
**Scope:** User portfolio pages (public + private), AI-assisted portfolio creation via prompt builder

---

## 1. Feature Summary

A portfolio page system for AIMEAT users:

- **Public portfolio:** `https://<node>/portfolio/<GHII-username>` — viewable by anyone, with optional "logged-in only" sections
- **Private portfolio:** `https://<node>/portfolio/me` — redirects to the authenticated user's own portfolio
- **AI-powered creation:** A prompt builder wizard where users select their content (storage images, memory data, cortex extensions, published apps/boards) via checkboxes, answer style/purpose questions, and an AI chat generates a downloadable HTML portfolio
- **Profile integration:** New tab in the profile page, positioned between Overview and Agents

---

## 2. Existing Infrastructure Inventory

### 2.1 What Already Exists (Ready to Use)

| System | Location | Relevance | Status |
|--------|----------|-----------|--------|
| **SPA Router** | `public/spa.html` lines 87–104 | Route map + `matchRoute()` for client-side navigation | Ready — add `/v1/portfolio` entry |
| **Server SPA Routes** | `src/routes/portal.ts` lines 643–662 | `spaRoutes[]` array serves `spa.html` for any registered path | Ready — add `/v1/portfolio` and `/v1/portfolio/:username` |
| **View Template** | `public/views/_template.js` | Documented 6-step process for creating new views | Ready — copy for portfolio view |
| **Profile Tabs** | `public/views/profile.js` lines 546–562 | `TABS[]` array defines profile tabs (15 currently) | Ready — insert new tab |
| **Memory System** | `src/routes/memory.ts` | Key-value storage with visibility (private/owner/public), tags, TTL | Ready — use `portfolio.*` namespace |
| **Storage Files** | `src/routes/storage-files.ts` | Binary file upload/download with visibility control, MIME types | Ready — for images/assets |
| **GHII Public Profile** | `src/routes/ghii.ts` lines 827–853 | `GET /v1/ghii/:ghii` returns display_name, bio, avatar, agents | Ready — use for portfolio header |
| **Consent System** | `src/routes/consent.ts` | Granular data access grants with audit trail | Ready — for "logged-in only" sections |
| **Auth Middleware** | `src/auth/middleware.ts` | `requireAuth()`, `optionalAuth()`, `requireRole()` | Ready — for public vs private access |
| **Apps System** | `src/routes/apps.ts` | File-based app storage with download URLs + screenshots | Ready — portfolio HTML can use same pattern |
| **Cortex Extensions** | `src/routes/cortex.ts` | Extension listing with components, tags, visibility | Ready — include in prompt builder |
| **Boards** | `src/routes/boards.ts` | User-published posts with categories, tags, reactions | Ready — include published posts in portfolio |
| **Prompt Package System** | `src/routes/portal.ts` lines 558–637 | Generates AI prompts with node context, goals, mode | Pattern to follow for portfolio prompt |
| **API Module** | `public/js/api.js` | Session-aware fetch wrapper with retry logic | Ready — use in portfolio view |
| **i18n** | `public/js/i18n.js` + `locales/en.json`, `locales/fi.json` | Client-side translations | Ready — add `portfolio.*` keys |
| **CSS Theme** | `public/css/theme.css` | Design system with variables, components | Ready — use for portfolio builder UI |
| **Response Envelope** | `src/middleware/envelope.ts` | `success()` / `error()` wrapper | Ready — for any new API endpoints |

### 2.2 What Partially Exists (Needs Extension)

| System | What Exists | What's Needed |
|--------|-------------|---------------|
| **GHII profile data** | Username, display_name, bio (500 chars), avatar, verification_level | Portfolio needs extended metadata: portfolio_enabled flag, portfolio_theme, portfolio_sections config |
| **Memory namespace** | `profile.<username>.*` pattern already used for interests/location | Add `portfolio.<username>.*` namespace for portfolio-specific data |
| **Storage visibility** | Files have private/owner/public visibility | Portfolio images need a catalog listing endpoint (list all `portfolio/*` files for a user) |
| **Prompt builders** | Agent prompt (`buildAgentPrompt`) and Cortex prompt (`buildCortexPrompt`) exist in profile.js | Need new `buildPortfolioPrompt()` with checkbox-driven content inclusion |
| **SPA route params** | `matchRoute()` uses exact path matching | Needs pattern matching for `/v1/portfolio/:username` (parameterized route) |
| **GHII username lookup** | `GET /v1/ghii/:ghii` expects full GHII format (`user@node`) | Need lookup by username alone for clean `/portfolio/<username>` URLs |

### 2.3 What Does NOT Exist (Must Be Built)

| Component | Description | Effort |
|-----------|-------------|--------|
| **Portfolio view** | `public/views/portfolio.js` — Preact SPA view | Medium |
| **Portfolio builder wizard** | Multi-step UI: select content sources, style preferences, purpose | Large |
| **Portfolio prompt generator** | `buildPortfolioPrompt()` — assembles selected content into AI prompt | Medium |
| **Portfolio data API endpoints** | `GET /v1/portfolio/:username` (public JSON), `PUT /v1/portfolio/config` (save config) | Medium |
| **Portfolio HTML renderer** | Client-side downloadable HTML generation from AI output | Small |
| **Content catalog endpoint** | Aggregated listing of user's publishable content (images, apps, boards, memory entries) | Medium |
| **Parameterized SPA routing** | Extend `matchRoute()` to handle `/v1/portfolio/:username` patterns | Small |
| **Consent-gated sections** | Portfolio sections that check viewer authentication before rendering | Medium |
| **CSS view styles** | `public/css/views/portfolio.css` | Small |
| **i18n keys** | Translation keys for portfolio builder, labels, instructions | Small |

---

## 3. Architecture Design

### 3.1 URL Structure

```
GET /v1/portfolio/<username>     → Public portfolio (no auth required)
GET /v1/portfolio/me             → Redirect to /v1/portfolio/<own-username> (requires auth)
GET /v1/portfolio                → Portfolio builder/manager (requires auth)
```

**Backend routing (portal.ts):**
- `/v1/portfolio` → serve `spa.html` (builder view)
- `/v1/portfolio/me` → server-side redirect (lookup auth → username → 302)
- `/v1/portfolio/:username` → serve `spa.html` (public view, SPA handles data fetching)

**SPA routing (spa.html):**
- `/v1/portfolio` → load `views/portfolio.js` (builder mode)
- `/v1/portfolio/:username` → load `views/portfolio.js` (view mode, extract username from path)

### 3.2 Data Model

Portfolio configuration stored in memory:

```
portfolio.<username>.config     → { enabled, theme, sections[], visibility_rules }
portfolio.<username>.content    → { bio, headline, featured_items[], custom_html }
portfolio.<username>.generated  → { html, generated_at, prompt_hash }
```

Visibility levels per section:
- `public` — visible to anyone
- `authenticated` — visible only to logged-in users
- `private` — visible only to owner (draft mode)

### 3.3 Portfolio Builder Flow

```
┌─────────────────────────────────────────────────────┐
│  Step 1: Select Content Sources                      │
│  ┌──────────────────────────────────────────────┐   │
│  │ ☑ Storage Images (12 files)                   │   │
│  │   ☑ portfolio/hero.jpg                        │   │
│  │   ☑ portfolio/project1.png                    │   │
│  │   ☐ portfolio/draft-sketch.png                │   │
│  │ ☑ Published Apps (3 apps)                     │   │
│  │   ☑ My Dashboard App                          │   │
│  │   ☑ Weather Widget                            │   │
│  │ ☐ Board Posts (8 posts)                       │   │
│  │ ☑ Cortex Extensions (2 extensions)            │   │
│  │   ☑ data-charts                               │   │
│  │ ☐ Memory Data (custom keys)                   │   │
│  └──────────────────────────────────────────────┘   │
│                                                       │
│  Step 2: Style & Purpose                              │
│  ┌──────────────────────────────────────────────┐   │
│  │ What kind of portfolio?                       │   │
│  │   ○ Professional / CV                         │   │
│  │   ○ Creative / Art Showcase                   │   │
│  │   ○ Developer / Technical                     │   │
│  │   ○ Personal / Blog-style                     │   │
│  │   ○ Custom (describe)                         │   │
│  │                                                │   │
│  │ Design style?                                  │   │
│  │   ○ Minimal & Clean                           │   │
│  │   ○ Bold & Colorful                           │   │
│  │   ○ Dark & Modern                             │   │
│  │   ○ Classic & Elegant                         │   │
│  │                                                │   │
│  │ What sections should be visible to             │   │
│  │ logged-in users only?                          │   │
│  │   ☐ Contact info                              │   │
│  │   ☐ Project details                           │   │
│  │   ☐ Download links                            │   │
│  └──────────────────────────────────────────────┘   │
│                                                       │
│  Step 3: Generate                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │ [Copy Prompt to Clipboard]                    │   │
│  │ [Download Prompt as .txt]                     │   │
│  │                                                │   │
│  │ Instructions:                                  │   │
│  │ 1. Paste this prompt into your AI chat         │   │
│  │ 2. The AI will generate your portfolio HTML    │   │
│  │ 3. Download the HTML file it creates           │   │
│  │ 4. Upload it back here to publish              │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### 3.4 Prompt Structure

The generated prompt follows existing patterns (see `buildAgentPrompt` and `buildCortexPrompt` in profile.js):

```
You are a portfolio website builder for AIMEAT.

## User Context
- GHII: <username>@<node>
- Display Name: <name>
- Bio: <bio>
- Node URL: <url>

## Selected Content
### Images (from AIMEAT storage)
- hero.jpg (1.2MB, image/jpeg) → <node>/v1/storage/<gaii>/portfolio/hero.jpg
- project1.png (340KB, image/png) → <node>/v1/storage/<gaii>/portfolio/project1.png

### Published Apps
- My Dashboard App → <node>/v1/apps/<owner>/dashboard.html
- Weather Widget → <node>/v1/apps/<owner>/weather.html

### Cortex Extensions
- data-charts v1.0.0 — "Interactive data visualization widgets"
  Components: schema, lib, prompt

## Portfolio Requirements
- Type: Developer / Technical
- Style: Dark & Modern
- Sections with auth-gating:
  - Contact info → show only to logged-in users
  - Download links → show only to logged-in users

## Technical Requirements
- Generate a single downloadable HTML file
- Use inline CSS (no external dependencies)
- Images referenced via AIMEAT storage URLs (public visibility)
- Auth-gated sections: check window.AIMEAT?.auth?.hasSession
  for logged-in detection, hide content behind a
  "Log in to see more" message
- Include debug panel (toggle with Ctrl+Shift+D):
  - Shows auth state, loaded images, section visibility
  - Console log of data-fetching activity
- Mobile-responsive design
- Include <meta> tags for SEO and social sharing
```

### 3.5 Auth-Gated Sections

The portfolio HTML checks login state client-side:

```javascript
// In generated portfolio HTML
const isLoggedIn = window.AIMEAT?.auth?.hasSession?.();
document.querySelectorAll('[data-auth="required"]').forEach(el => {
  el.style.display = isLoggedIn ? '' : 'none';
});
if (!isLoggedIn) {
  // Show "Log in to see more" placeholder
}
```

This works because:
1. The portfolio is served from the AIMEAT node domain
2. `aimeat-auth.js` (loaded in spa.html) manages session state
3. Public portfolio data is fetched without auth
4. Auth-gated data requires the viewer to have a JWT

### 3.6 Portfolio Serving Options

**Option A: Static HTML in Apps System (Recommended)**
- Portfolio HTML uploaded via existing `POST /v1/storage` as `apps/portfolio.html`
- Served at `/v1/apps/<owner>/portfolio.html` (existing download mechanism)
- `/v1/portfolio/<username>` route does a server-side lookup → serves the HTML inline
- Pros: Reuses existing infrastructure, file-based, CDN-cacheable
- Cons: Requires regeneration for content updates

**Option B: Dynamic SPA View**
- Portfolio data stored as memory JSON, rendered client-side by Preact
- `/v1/portfolio/<username>` always renders fresh from API data
- Pros: Always up-to-date, no regeneration needed
- Cons: More complex, slower first load, SEO harder

**Option C: Hybrid (Recommended)**
- AI generates downloadable HTML (Option A) for the portfolio showcase
- SPA view at `/v1/portfolio` handles the builder/manager UI
- Public URL at `/v1/portfolio/<username>` serves the generated HTML
- If no generated portfolio exists, falls back to a simple auto-generated profile page

---

## 4. Effort Estimation

### 4.1 Work Breakdown

| Task | Files | Effort | Dependencies |
|------|-------|--------|-------------|
| **1. SPA routing for parameterized paths** | `spa.html`, `portal.ts` | 2h | None |
| **2. Portfolio view skeleton** | `views/portfolio.js`, `css/views/portfolio.css` | 3h | Task 1 |
| **3. Content catalog API** | `src/routes/portfolio.ts` (new) | 4h | None |
| **4. Portfolio config storage** | `src/storage/interface.ts`, `src/storage/memory.ts` | 2h | None |
| **5. Portfolio builder wizard UI** | `views/portfolio.js` (builder mode) | 8h | Tasks 2, 3 |
| **6. Portfolio prompt generator** | `views/portfolio.js` (prompt logic) | 4h | Task 5 |
| **7. Public portfolio serving** | `portal.ts` or new route file | 3h | Task 4 |
| **8. `/portfolio/me` redirect** | `portal.ts` | 1h | Task 7 |
| **9. Auth-gated section logic** | Prompt template + generated HTML pattern | 2h | Task 6 |
| **10. Profile tab integration** | `views/profile.js` | 1h | Task 2 |
| **11. i18n translations** | `locales/en.json`, `locales/fi.json` | 1h | All |
| **12. Debug panel in generated HTML** | Prompt template | 1h | Task 6 |
| **13. OpenAPI spec updates** | `openapi.yaml` | 1h | Tasks 3, 7 |

**Total estimated effort: ~33 hours**

### 4.2 Delivery

**Full implementation** — all 13 tasks delivered in a single pass. See `2026-03-06-portfolio-page-plan.md` for the complete task-by-task implementation plan.

---

## 5. Management & Administration

### 5.1 Configuration

New config options in `src/config.ts`:

```typescript
// Portfolio settings
portfolioEnabled: boolean;           // Enable/disable portfolio feature
portfolioMaxSizeKb: number;          // Max portfolio HTML size (default: 512)
portfolioMaxImagesPerPortfolio: number; // Max images selectable (default: 20)
```

### 5.2 Storage Namespace Convention

```
portfolio.<username>.config       → Portfolio configuration (theme, sections, visibility rules)
portfolio.<username>.content      → Portfolio metadata (headline, featured items)
portfolio.<username>.prompt_log   → Last prompt used for generation (for regeneration)
```

Storage files for portfolio assets:
```
portfolio/<username>/images/*     → Portfolio images
portfolio/<username>/generated/*  → Generated HTML files
```

### 5.3 Moderation

- Portfolio content subject to existing **flag system** (`flagCount` on memory entries)
- Operator can disable individual portfolios via config toggle
- Public portfolios appear in **catalogue/directory** searches (existing mechanism)
- Generated HTML max size enforced server-side on upload

### 5.4 GDPR Compliance

- Portfolio data included in existing `GET /v1/owners/:name/export` GDPR export
- Portfolio deleted as part of cascade delete (`DELETE /v1/owners/:name`)
- Consent audit trail covers portfolio data access

### 5.5 Quota & Economy

- Portfolio images count against existing storage quota (`storageQuotaMb`)
- Portfolio metadata counts against memory quota (`memoryQuotaMb`)
- No additional morsel costs (portfolio is a profile feature, not a service)

---

## 6. Key Technical Decisions Needed

1. **Serving model:** Static generated HTML (Option A) vs dynamic SPA (Option B) vs hybrid (Option C)?
   - Recommendation: **Option C (Hybrid)** — builder is SPA, public portfolio serves generated HTML

2. **Parameterized SPA routing:** How to handle `/v1/portfolio/:username` in the client?
   - Recommendation: Extend `matchRoute()` with prefix matching, pass params as props to view

3. **Image references in generated HTML:** Absolute URLs to node storage vs embedded base64?
   - Recommendation: **Absolute URLs** — keeps HTML small, leverages existing CDN/caching

4. **Auth-gating implementation:** Client-side JS toggle vs server-side content filtering?
   - Recommendation: **Client-side** — the generated HTML includes all content but hides auth-gated sections via JS. Public API endpoints that serve portfolio data can also filter based on auth.

5. **Profile tab position:** Between which existing tabs?
   - Request specifies: After Overview (first tab), before Agents tab
   - This means adding it at index 0 of TABS array (before 'agents')

6. **Portfolio versioning:** Keep history of generated portfolios?
   - Recommendation: Keep only latest + prompt log for regeneration. Simpler, lower storage cost.

---

## 7. Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Generated HTML XSS vulnerability | High | Sanitize on upload, CSP headers on serve |
| Large portfolio files bloating storage | Medium | Enforce `portfolioMaxSizeKb` limit |
| AI generating broken HTML | Low | Debug panel helps users troubleshoot |
| Auth-gating bypassed by inspecting HTML source | Medium | Document that client-side gating is convenience, not security. Truly private data should use consent system. |
| Username collisions in URL paths | Low | GHII usernames are already unique per node |
| SEO for generated portfolios | Low | Include meta tags in prompt template |

---

## 8. Files That Would Be Created or Modified

### New Files
- `public/views/portfolio.js` — Portfolio SPA view (builder + viewer)
- `public/css/views/portfolio.css` — Portfolio styles
- `src/routes/portfolio.ts` — Portfolio API routes (content catalog, config, serve)

### Modified Files
- `public/spa.html` — Add route entry + CSS preload
- `src/routes/portal.ts` — Add SPA route + `/portfolio/me` redirect + parameterized route
- `src/server.ts` — Mount portfolio router
- `src/storage/interface.ts` — Portfolio config types (if dedicated storage needed)
- `src/storage/memory.ts` — Portfolio storage implementation (if dedicated storage needed)
- `public/views/profile.js` — Add portfolio tab to TABS array
- `locales/en.json` — Add `portfolio.*` translation keys
- `locales/fi.json` — Add `portfolio.*` translation keys
- `openapi.yaml` — Document new endpoints
- `src/config.ts` — Add portfolio config options (optional)

---

## 9. Summary

The portfolio feature is **feasible with moderate effort** (~33 hours). Approximately **70% of the infrastructure already exists** — memory storage, file storage, consent/visibility, auth, SPA routing, prompt builders, and the apps system. The main new work is the builder wizard UI, the prompt generator logic, and the public-serving route.

The recommended approach is a **hybrid model**: an SPA-based builder/manager at `/v1/portfolio` and generated static HTML served at `/v1/portfolio/<username>`. This aligns with the project's "no SSR" architecture rule while providing good UX for both creators and viewers.
