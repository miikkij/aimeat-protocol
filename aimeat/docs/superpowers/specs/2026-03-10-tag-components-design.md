# Tag Components: Shared TagCloud & TagEditor

**Date:** 2026-03-10
**Status:** Approved

## Problem

Tags exist on memory entries and files but:
1. No way to edit tags on existing files or memories after creation
2. Portfolio builder shows no tags and has no filtering — users can't find content to share
3. Memory entries section has no tag cloud (files section does)
4. The tag cloud + inline tag editor pattern is duplicated / needed in 4+ places

## Design

### Shared Components

Two new Preact+HTM components in `public/js/components/`:

#### `TagCloud({ tags, selected, onToggle, onClear })`

Renders a row of clickable filter pills. Pure display + interaction, no API calls.

- `tags: string[]` — all available tags (sorted alphabetically)
- `selected: Set<string>` — currently active filter tags
- `onToggle(tag: string)` — called when a tag pill is clicked
- `onClear()` — called when "clear" button is clicked
- Shows a "clear" button when any tag is selected

#### `TagEditor({ tags, onSave, maxTags? })`

Inline tag add/remove widget. Shows current tags as pills with X buttons, plus an input field to add new tags.

- `tags: string[]` — current tags on the item
- `onSave(tags: string[])` — called with the new full tag array after add/remove
- `maxTags?: number` — optional limit (default 20, matching schema)
- Saves immediately on each add/remove (no separate save button needed)

#### CSS: `public/css/components/tags.css`

Shared styles with `tag-` prefix. Extracted from existing `file-tag-*` styles in profile.css. Both profile.css and portfolio.css reference this shared stylesheet.

### Backend Changes

#### New endpoint: `PATCH /v1/memory/files/:fileId`

Updates tags on an existing file. Auth required, owner only.

```
PATCH /v1/memory/files/:fileId
Body: { tags: string[] }
Response: updated StorageFileRecord
```

Needs a new storage method: `updateFileTags(ownerGaii, fileKey, tags): Promise<StorageFileRecord>`

#### Portfolio catalog: include file tags

`GET /v1/portfolio/catalog` currently returns images without tags. Add `tags: string[]` to each image entry.

### Frontend Integration Points

#### 1. Memory tab — Files section (memory-tab.js)

**Replace** inline tag cloud with `<TagCloud>` component.
**Add** `<TagEditor>` to each file card row (edit icon → shows inline editor).

#### 2. Memory tab — Entries section (memory-tab.js)

**Add** tag cloud at top of entries list (same pattern as files).
**Add** `<TagEditor>` per memory entry.
Uses existing `PUT /v1/memory/:key` with `tags` field (already supported).

#### 3. Portfolio builder — Images section (portfolio.js)

**Add** `<TagCloud>` above the images list.
Filter images by selected tags (AND logic, same as memory tab).
Requires catalog to return tags (backend change above).

#### 4. Portfolio builder — Memories section (portfolio.js)

**Add** `<TagCloud>` above the memories list.
Filter memories by selected tags.

### Memory service updates (memory.js)

- `updateMemoryTags(key, tags)` — calls `PUT /v1/memory/:key` with `{ tags }`
- `updateFileTags(fileKey, tags)` — calls `PATCH /v1/memory/files/:fileKey` with `{ tags }`

### Storage layer

- Add `updateFileTags(ownerGaii, fileKey, tags)` to Storage interface
- Implement in memory.ts and sqlite provider

### i18n

New keys under `profile.memory.*` and `profile.files.*`:
- `editTags` — "Edit tags"
- `addTag` — "Add tag"
- `noTagsMatch` — "No entries match selected tags"
- `clearFilter` — "Clear"

## Migration

The existing `file-tag-*` CSS classes in profile.css stay as-is initially (no breaking change). The shared `tag-*` classes in tags.css are used by the new component. Profile.css can be cleaned up in a follow-up to remove the duplicated styles.

## Files Changed

| File | Change |
|------|--------|
| `public/js/components/tag-cloud.js` | New — TagCloud component |
| `public/js/components/tag-editor.js` | New — TagEditor component |
| `public/css/components/tags.css` | New — shared tag styles |
| `src/routes/memory.ts` | Add PATCH /v1/memory/files/:fileId |
| `src/storage/interface.ts` | Add updateFileTags method |
| `src/storage/providers/memory.ts` | Implement updateFileTags |
| `src/storage/providers/sqlite/index.ts` | Implement updateFileTags |
| `public/js/services/memory.js` | Add updateMemoryTags, updateFileTags |
| `public/views/profile/memory-tab.js` | Use TagCloud + TagEditor in both sections |
| `public/views/portfolio.js` | Add TagCloud filtering for images + memories |
| `src/routes/portfolio.ts` | Include tags in image catalog entries |
| `locales/en.json` | New i18n keys |
| `locales/fi.json` | New i18n keys |
