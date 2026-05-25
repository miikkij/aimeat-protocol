# Public Knowledge Viewer -- Design Spec

**Date:** 2026-05-26
**Status:** Approved

## Summary

A read-only, no-login-required SPA view at `/v1/publicknowledgeviewer` where anyone can browse, search, and read public knowledge packages. Discoverable by anyone with the URL -- no authentication wall.

## Goals

1. Make public knowledge packages accessible to unauthenticated visitors
2. Allow discovery through search, filtering, and sorting
3. Allow reading full package content (public entries) in-browser
4. Provide shareable direct links to individual packages
5. Encourage engagement (clone, export) for logged-in visitors

## Non-Goals

- Editing or creating knowledge packages (existing profile tab handles this)
- Private/owner/group visibility entries (only `visibility: 'public'` shown)
- User accounts or registration prompts
- Comments or social features (reviews are read-only display)

## URL Structure

- Browse/list: `/v1/publicknowledgeviewer`
- Single package: `/v1/publicknowledgeviewer?id={packageId}`

## Architecture

### No New Backend Code

All required APIs already exist and work without authentication for public packages:

| API | Purpose |
|-----|---------|
| `GET /v1/catalogue/knowledge` | Discovery -- lists public packages with filters |
| `GET /v1/knowledge/:id` | Package manifest (public scan) |
| `GET /v1/knowledge/:id/export` | Full package export as JSON |
| `GET /v1/knowledge/:id/reputation` | Quality signals (review count, avg score, clone count) |
| `GET /v1/knowledge/:id/reviews` | Review list (requires auth -- skip or show if logged in) |
| `GET /v1/knowledge/:id/links` | Related package links |
| `GET /v1/memory/{key}` | Entry content (public entries only) |

### New Files

| File | Purpose |
|------|---------|
| `public/views/public-knowledge-viewer.js` | Preact + HTM view component |
| `public/css/views/public-knowledge-viewer.css` | Styles with `pkv-` prefix |

### Modified Files

| File | Change |
|------|--------|
| `src/routes/portal.ts` | Add `/v1/publicknowledgeviewer` to SPA routes |
| `public/spa.html` | Add route entry in ROUTES map + importmap if needed |

## UI Design

### Browse Mode (Landing)

```
+------------------------------------------+
| Public Knowledge Library                  |
|                                          |
| [Search input............] [Filters v]   |
|                                          |
| Filters: Content Type | Tags | Language  |
|          Maturity | Sort by              |
|                                          |
| +--------------------------------------+ |
| | Package Card                         | |
| | Title          Author    Language    | |
| | Tags: [tag1] [tag2]     Content Type | |
| | Maturity: published  Entries: 5      | |
| | Reputation: 4.2/5   Clones: 12      | |
| +--------------------------------------+ |
| | Package Card ...                     | |
| +--------------------------------------+ |
|                                          |
| [Load more / pagination]                 |
+------------------------------------------+
```

### Package Detail Mode

```
+------------------------------------------+
| < Back to library                        |
|                                          |
| Package Title                   v1.2.0   |
| By: author@node-id                       |
| Created: 2026-01-15  Updated: 2026-03-20|
|                                          |
| Content Type: research  Language: en     |
| Maturity: published                      |
| Synthesis: assisted (GPT-4 + human edit) |
| Tags: [ml] [transformers] [attention]    |
|                                          |
| License: CC-BY-4.0                       |
| Catalog listed: Yes  Allow clone: Yes    |
|                                          |
| --- Reputation ---                       |
| Score: 4.2/5  Reviews: 3  Clones: 12    |
|                                          |
| --- Entries (public) ---                 |
| > Entry 1: Introduction        [expand] |
| > Entry 2: Methodology         [expand] |
| > Entry 3: Results             [expand] |
|                                          |
| --- References ---                       |
| - Title (url) -- accessed date           |
|                                          |
| --- Related Packages ---                 |
| - Related Package Name (extends)         |
|                                          |
| [Export JSON] [Clone to my library*]     |
| *Clone requires login                    |
+------------------------------------------+
```

## Behavior Details

### Entry Content Loading

- Entries are listed from the manifest's `entries` array
- Only entries with `visibility: 'public'` are shown
- Content is lazy-loaded on expand via `GET /v1/memory/{packageKey}/{entryKey}`
- If the memory endpoint returns 403/404 for a "public" entry, show "Content unavailable"

### Filtering and Search

Leverages `GET /v1/catalogue/knowledge` query params:
- `content_type` -- dropdown filter
- `tags` -- comma-separated tag filter
- `language` -- language selector
- `sort` -- `newest`, `name`, or by reputation (client-side sort if API doesn't support)
- `q` -- text search on name (if API supports, otherwise client-side filter)
- Pagination via `offset` + `limit` params

### Optional Auth Enhancement

- If the viewer happens to be logged in (JWT in localStorage), show "Clone to my library" button
- Clone calls `POST /v1/knowledge/:id/clone` (requires auth)
- Reviews endpoint requires auth -- show reviews section only if logged in, or skip gracefully

### Shareable URLs

- `/v1/publicknowledgeviewer?id=abc-123-def` links directly to package detail view
- Can be shared on social media, chat, email without requiring recipient to have an account

## CSS Approach

- All classes prefixed with `pkv-` (public knowledge viewer)
- Uses existing CSS variables from `theme.css`
- Responsive: card grid on desktop, single column on mobile
- Reuses existing component patterns: cards, badges/pills for tags, expandable sections

## i18n

New translation keys in both `locales/en.json` and `locales/fi.json` under a `"publicKnowledgeViewer"` section:
- Page title, search placeholder, filter labels, empty states, error messages
- Entry visibility labels, reputation labels, action buttons

## Testing

- Playwright test: page loads without auth, packages display, search works, detail view opens, entries expand
- No E2E API test needed (uses existing public APIs)
