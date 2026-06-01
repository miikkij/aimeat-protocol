# Agent Tasks — Triage, Search, Archive & Per-Task Memory

**Status:** design locked, not yet implemented · **Date:** 2026-06-01

The agent **Tasks** tab is a flat list that shows every task at once (a busy
agent like `workflow-manager` already has 20+, growing fast). This plan replaces
it with a **triage model** (three buckets), on-demand backend search, a
node-level auto-archive config, and a per-task view of the memory entries a task
produced. No pagination (the user dislikes it); length is handled by the
triage split + search.

---

## 1. Information architecture — three buckets ("triage")

```
Tasks
┌──────────────────────────────────────────────────────────────────┐
│ [ Recent (7) ]   [ Keep (3) ]   [ Archive (142) ]       🔍   + New │
└──────────────────────────────────────────────────────────────────┘
```

- **Recent** (last-24h triage inbox) — all non-terminal tasks
  (queued/active/stalled/paused/revision_requested/draft) **plus** terminal
  (done/failed) tasks updated within the archive window that haven't been
  triaged. This is where new work and just-finished work lands.
- **Keep** — tasks the owner manually promoted ("worth keeping"). Never
  auto-archived; stay until manually archived.
- **Archive** — manually archived tasks **plus** un-triaged terminal tasks older
  than the window (auto, when node config enables it). The long tail; this is
  the bucket where search matters.

**Why this and not "old → archive":** a pure age split just turns Archive into a
second dumping ground. Triage forces a cheap decision — promote the few that
matter to **Keep**, let the rest fall to **Archive** — so the working set stays
small and Archive is "stuff I've consciously let go".

---

## 2. Data model — one field

Add to `AgentTaskRecord` (SQLite + MongoDB):

```ts
triage?: 'kept' | 'archived';   // undefined/null = default (auto by age)
```

Bucket derivation (given node config `auto_archive`, `archive_after_hours`):

| triage | status | age | Bucket |
|--------|--------|-----|--------|
| `kept` | any | any | **Keep** |
| `archived` | any | any | **Archive** |
| null | non-terminal | any | **Recent** |
| null | terminal (done/failed) | ≤ window | **Recent** |
| null | terminal | > window AND auto_archive on | **Archive** |
| null | terminal | > window AND auto_archive off | **Recent** (stays until manual) |

Manual actions (buttons on a task row): **Keep** → `triage='kept'`,
**Archive** → `triage='archived'`, **Restore** → clear to null.

---

## 3. API

### `PATCH /v1/agents/{name}/tasks/{id}/triage` (new)
Body `{ triage: 'kept' | 'archived' | null }`. Owner-only. Sets the field,
emits a task event, returns the task.

### `GET /v1/agents/{name}/tasks` (extend)
Add query params:
- `bucket` = `recent` | `keep` | `archive` — server applies the §2 derivation
  (using the node config) and returns only that bucket. Keeps the heavy Archive
  off the wire unless asked for.
- `q` — case-insensitive substring over title + description.
- `updated_before` / `updated_after` — ISO timestamps (the time filter).
- existing `status`, `page`, `per_page` still work (page/per_page used only to
  cap Archive payloads internally, not surfaced as UI pagination).

The UI fetches Recent + Keep eagerly (small), Archive lazily on tab open / search.

---

## 4. Auto-archive config — node level (admin dashboard)

Operator-controlled, in the admin **Config** tab (no per-agent override in v1):

- `tasks.auto_archive` (bool, default **true**) — whether un-triaged terminal
  tasks fall to Archive after the window.
- `tasks.archive_after_hours` (int, default **24**) — the Recent window.

Stored as node config (same mechanism as other `PUT /v1/admin/config` settings).
The tasks list endpoint reads these when deriving buckets.

---

## 5. Search UX

- 🔍 icon in the tab header; hidden search bar that toggles open (not always
  visible). Searches the **current bucket** (Archive most useful).
- Quick time chips: **Today · 7d · 30d · All** → set `updated_after`.
- Backend `q` + time params (§3) so it scales to hundreds/thousands of tasks.

---

## 6. Per-task memory entries

**Problem:** an agent's memory fills with deliverables and it's hard to tell
which task each belongs to. Today a task only links its single `deliverableKey`.

**Current crew reality (aimeat-crewai):** the deliverable is written
deterministically via a task callback (not LLM-dependent), to
`crews.{agent}.{slug}-{short}.latest_output` where `short` is only the **first
segment** of the task id; the live key `agents.{agent}.tasks.{full_id}.live`
uses the **full** id. So keys don't reliably encode the full task id, and slug
is unpredictable — listing "this task's entries" by key alone is fragile.

**Solution — tag convention `task:<full_id>`:**
- **Crew side (aimeat-crewai):** in the same deterministic callback that writes
  the deliverable, add `tags=["task:<full_task_id>", ...]`. Because the callback
  is deterministic, the tag lands as reliably as the deliverable itself — no
  dependence on the LLM remembering to tag.
- **AIMEAT side:** in the expanded task, list its memory entries via
  `GET /v1/agents/{name}/memory?... tags=task:<full_id>` (owner-scoped read),
  on top of the existing `deliverableKey` (primary) and optionally the live key
  `agents.{agent}.tasks.{full_id}.live`. Show key + value preview + updated time.

This is additive — the existing `crews.*.latest_output` key scheme is unchanged;
the tag just makes entries findable per task. Requires an aimeat-crewai release
(we own that package).

---

## 7. Phasing

1. **AIMEAT triage + search + admin config** — `triage` field (both backends),
   `PATCH /triage`, `bucket`/`q`/time params on list, node config, the 3-tab UI
   with Keep/Archive/Restore buttons and the search toggle. Self-contained.
2. **Per-task memory display (AIMEAT)** — expanded-task memory list by
   `task:<id>` tag + deliverableKey + live key.
3. **Crew tagging (aimeat-crewai)** — add `task:<full_id>` tag to the
   deterministic deliverable write; release. Phase 2's list is sparse until this
   ships (only deliverableKey/live show); fully populated after.

---

## 8. Compliance (CLAUDE.md)

- **OpenAPI** (Rule 3): document `/triage` + new list params.
- **i18n** (Rule 4): tab names (Recent/Keep/Archive), button labels, search,
  time chips — en + fi.
- **Storage sync:** `triage` on `AgentTaskRecord` in SQLite + MongoDB.
- **E2E** (Rule 1): triage transitions + bucket derivation + search/time filter,
  on SQLite and MongoDB.
- **Frontend** (Rule 1b / 7): drive via Playwright MCP when done; pf- prefix,
  theme variables, no inline styles.
- **Admin config:** wire into the existing admin Config tab + `PUT /v1/admin/config`.

---

## 9. Open micro-decisions (defaults chosen)

1. **Window default 24h, auto_archive default on.** ✔
2. **Search scoped to the current bucket** (not global). ✔ — flag if you'd
   rather search across all buckets at once.
3. **No per-agent config override in v1** (node-level only, per your call). ✔
