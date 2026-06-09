# Plan — Workspace document-space public sharing + HTML viewer

**Status:** DRAFT for review (no code yet)
**Date:** 2026-06-09
**Scope:** Make an organism workspace's *document-space* content shareable — as rendered HTML
(no-auth viewer) and as raw markdown (API for agents/curl), at single-document OR whole-space
granularity, with a toggleable public/private state. **No PDF** — the browser's native print /
"Save as PDF" covers that for free once an HTML viewer exists.

---

## 1. Goals (from the discussion)

1. Read a **single document** or a **whole document-space** as rendered HTML, no login required, via a
   shareable link.
2. Get the same content as **raw markdown** through a generic API — for agents and humans alike, and
   for assembling larger shareable wholes out of a document-space.
3. **Toggle public/private** per document and per document-space.
4. An HTML **viewer** for public (and, when logged in, private) document content — modelled on the
   existing `public-knowledge-viewer`.

Explicitly **out of scope:** server-side PDF generation (heavy dependency + violates "backend renders
nothing"). The viewer's browser-print is the PDF path.

## 2. Architectural fit

- **Backend stays protocol-only.** New routes are generic JSON/markdown APIs (no SSR). The viewer is a
  client-side SPA view, exactly like `public-knowledge-viewer.js`.
- **Reuses existing precedent.** The public-knowledge viewer already does no-auth reads filtered by a
  public flag, and builds shareable text client-side. We mirror that for workspaces.
- **Reuses existing data.** Document-space pages already store `{ id, title, markdown }` at
  `organism.{id}.w.{ws}.{namespace}.{id}.latest` (published) with the draft→latest→version flow.
- **Reuses existing components.** `Markdown.js`, and `DocumentView` from `organisms-tab.js`.

## 3. Data model — the "share" meta record (recommended)

Add ONE explicit source of truth per workspace, in the existing `…meta.*` namespace:

```
organism.{id}.w.{ws}.meta.share = {
  public: boolean,                       // whole document portion public?
  spaces: { [spaceName: string]: boolean },   // per document-space (objectType name)
  docs:   { [docKey: string]: boolean },      // per-doc override, docKey = "namespace/id"
}
```

Resolution for "is doc D in space S public?": `docs[D]` if set, else `spaces[S]` if set, else `public`.

**Why this over per-record `visibility`:** one toggle point, supports both granularities, handles
*future* published docs in a shared space automatically, and never mutates every content record. It is
a natural sibling of the existing `meta.manifest` / `meta.readme` / `meta.sections` records.

**Hard rule:** only **published** (`.latest`) docs are ever served publicly. Drafts never leak.

## 4. Backend endpoints (generic, no auth on the public ones)

All under the existing `/v1/organisms/:id/workspace/...` family in `organisms.ts`. Register the
`/public/` routes **before** any parameterized catch-all (route-ordering pitfall).

### Public read (NO auth)
- `GET /v1/organisms/:id/workspace/:ws/public/documents`
  → JSON: the public document-spaces and their published docs `{ type, id, title, markdown }`,
  filtered by the share meta. 404 if nothing is public (don't reveal private structure).
- `GET /v1/organisms/:id/workspace/:ws/public/documents/:type/:docId`
  → JSON: a single published+public doc `{ title, markdown }`. 404 otherwise.
- Both accept `?format=md` → returns `text/markdown` (single doc, or the whole space concatenated with
  `#`/`##` headings). This is the agent/curl path — the "markdown bundle" requested.

### Authed share control (workspace write gate)
- `GET /v1/organisms/:id/workspace/:ws/share` → current share meta (for the UI toggles).
- `PUT /v1/organisms/:id/workspace/:ws/share` body `{ public?, spaces?, docs? }` → write the share meta.
  Gated by the same rule as workspace writes (creator or granted member — mirror `canWriteWs` /
  `workspaceAccessMiddleware`). Calls `emitChange('organisms')`.

### MCP parity (follow-up, optional)
- `aimeat_workspace_share` tool so an agent can flip public state. Defer unless wanted in v1.

## 5. Frontend

### New: `public/views/public-workspace-viewer.js` (no auth)
- Clone of `public-knowledge-viewer.js` / `doc-solo.js`, but reads the public endpoints and renders
  markdown with `Markdown.js`.
- Two modes: whole-space index (doc list + read) and single doc.
- URL: a new SPA route, e.g. `/v1/publicworkspaceviewer?org=…&ws=…[&type=…&id=…]` (query-param shape
  like `doc-solo`). Register in `portal.ts` `spaRoutes`.
- Optional `print.css` for clean browser-print output. No PDF code.

### Authed workspace UI (`organisms-tab.js`, document-space view)
- A "Share" control: per-doc and per-space public toggle, "Copy public link", "Open public viewer".
- Reuse existing toast + `aimeat-live-update` patterns.

## 6. Visibility / safety rules

- Only published `.latest` docs are publicly served; drafts never.
- Public endpoints ignore auth and serve ONLY what the share meta marks public; everything else 404
  (no existence disclosure).
- The share meta is writable only via the workspace write gate.
- Existing public-read rate limiting applies.

## 7. Cross-cutting (mandatory rules)

- **openapi.yaml** — add all new routes (Rule 3); `pnpm generate:types`.
- **i18n** — new keys in `locales/en.json` + `fi.json` for the viewer and share UI (Rule 4).
- **File headers** on new files; version-history bumps on touched files (Rule 2).
- **E2E** — new suite: public read of a shared space, single doc, 404 for unshared/draft, toggle
  gating (non-writer denied), `?format=md` for an agent. Happy path + ≥1 failure mode (Rule 1).
- **Frontend guide** — viewer CSS prefixed (e.g. `pwv-`), no inline styles, theme.css vars (Rule 7).

## 8. Suggested build order (each a reviewable slice)

1. Share meta + `GET/PUT …/share` + the two public read endpoints (+ `?format=md`). Generic, agent-
   usable immediately. E2E for these.
2. `public-workspace-viewer.js` + SPA route + `Markdown.js` rendering. Browser-verify via MCP.
3. Authed "Share" toggles + "Open public viewer" in `organisms-tab.js`. Browser-verify via MCP.
4. (Optional) `aimeat_workspace_share` MCP tool for agents.

## 9. Open decision for the developer

- **Data model:** the single `meta.share` record (recommended) vs. per-record `visibility` flags.
  Recommendation: `meta.share` — see §3 rationale.
