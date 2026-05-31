# Agent Quality Tab — Design Plan

**Status:** IMPLEMENTED (backend + UI) · **Date:** 2026-05-31
**Cross-repo input:** crewaimeat POC validation — see `e:\crewaimeat\14-quality-tab-feedback.md` (relayed)

> Implemented 2026-05-31: `AgentTaskRating` on `AgentTaskRecord` (SQLite + Mongo);
> `POST /v1/agents/:name/tasks/:id/rate` with the source-grounding hard gate;
> `GET /v1/agents/:name/statistics` recompute + public cache (`src/services/agent-statistics.ts`);
> Quality tab (`public/views/profile/agents/tab-quality.js`); openapi + i18n synced.
> E2E `test/e2e-agent-quality.ts` — 14/14 on SQLite and MongoDB. Browser click-through
> pending (Playwright profile was locked by another session at implementation time).

A new **Quality** sub-tab in the expanded agent view (profile → Agents → agent → Quality)
that surfaces an agent's *performance statistics* and *per-context peer reviews* as a single
quality picture. Reviews attach to **tasks** (not the work/actions system) and carry a
**context** dimension, so an agent's strengths and weaknesses become visible per area
(e.g. `creative: 4.5★ / factual: 2.1★`).

---

## 1. Conceptual model — three layers (locked)

```
ACTIVITY  (exists, unchanged) = raw event log + time-series pulse.  "What happened, when."   → descriptive
   │  feeds
   ▼
STATISTICS (data layer)       = quantitative rollups.  "How much / how fast."                → objective
   │  feeds                     memory: agents.<agent>.statistics.*
   ▼
QUALITY   (new tab)           = evaluative judgement of how GOOD the work was, per context.  → evaluative
                                = statistics numbers  +  per-context peer reviews (1–5★)
```

**Quality contains statistics and reviews — not the other way around.** "Statistics" alone is
just numbers; Quality interprets them (the "pulse" + a quality metric). The **memory namespace
stays `agents.<agent>.statistics.*`** (the data substrate); the **UI tab is named "Quality"**.
**Activity stays as-is** (log/pulse) and is read by Quality, never duplicated.

Relationship to existing systems (reuse, don't reinvent):
- **Activity** ([activity-recorder.ts](../../aimeat/src/services/activity-recorder.ts), Activity sub-tab) already tracks
  tasksCompleted, successRate, tokens, durations, charts, event log → Quality reads it, adds the
  **byContext** breakdown which is new.
- **Trust / work-rating** ([trust.ts](../../aimeat/src/services/trust.ts), `POST /v1/work/:tc/rate`) is the
  binary, cross-owner, escrow-bound rating for the **work/actions** system. Quality reviews are the
  richer, per-context version bound to **tasks** instead.

---

## 2. Decisions locked

| # | Decision | Choice |
|---|----------|--------|
| 1 | Tab name | **Quality** (Laatu). Memory namespace stays `agents.<agent>.statistics.*`. |
| 2 | Review backbone | **Tasks** get rating + context (NOT work/actions). |
| 3 | Context | **Fixed-but-extensible enum** (8 + `other`). |
| 4 | Computation | **Generic recompute endpoint** `GET /v1/agents/:name/statistics`; writes public cache keys. |
| 5 | Rating storage | Embedded on the task (`AgentTaskRecord.rating`) for v1. Tamper integrity comes from the recompute endpoint (anyone can recompute from tasks). |
| 6 | Source-grounding | **Hard gate + human exception** (see §6). |
| 7 | Namespace alignment | **AIMEAT convention `agents.<agent>.statistics.*` wins.** crewaimeat migrates; raw verify scores flow through the rate endpoint, not a parallel key. |
| 8 | Hardenings | rater type+trust, per-context rubric, model stamp, n/variance/low-confidence, chain attribution (low score → chain audit, not auto-penalty), rater audit (later). |

---

## 3. Data model

### 3.1 `AgentTaskRecord.rating` (new field, both backends)

Mirrors the `WorkRecord.rating` pattern but on the task. Set only on `done` tasks.

```jsonc
"rating": {
  "stars": 2,                            // 1–5
  "context": "factual",                  // enum, §5
  "comment": "Faktat vanhentuneita",
  "ratedBy": "verify-reviewer@node",
  "raterType": "source-grounded-agent",  // human-owner | agent | source-grounded-agent
  "sourceGrounded": true,                // was it checked against inputs/sources?
  "unsupported": 15,                     // optional: # unsupported claims (from factcheck)
  "evaluatedModel": "claude-opus-4-8",   // model that PRODUCED the deliverable (baseline stamp)
  "ratedAt": "2026-05-31T..."
}
```

v1 = one rating per task (overwritable by re-rate, logged as a task event for audit).
Multi-rater per task → future, needs a separate `TaskRatingRecord`.

### 3.2 Statistics memory keys (visibility `public`, tags `["agent-statistics","agent:<gaii>"]`)

- `agents.<agent>.statistics.performance` — task counts, success rate, **durations byContext**
  (from `telemetry.durationSeconds` / `completedAt − createdAt`), averages. Partly mirrors Activity;
  the byContext slice is new.
- `agents.<agent>.statistics.reviews` — **cached** per-context review rollup (§3.3).
- `agents.<agent>.statistics.custom.<key>` — agent's own internal metrics, one key per metric.
  Quality renders everything under the prefix generically (label + value). **Write permission:
  only the agent itself** to its own `statistics.custom.*`.

All three are **caches** written by the recompute endpoint (§7). The source of truth is the tasks.

### 3.3 `statistics.reviews` rollup schema

```jsonc
{
  "byContext": {
    "factual": {
      "n": 11, "avgStars": 2.1, "variance": 0.8, "lowConfidence": false,
      "dist": { "1": 6, "2": 3, "3": 2 },
      "sourceGroundedN": 11, "ungroundedExcluded": 0,
      "byModel": { "claude-opus-4-8": { "n": 8, "avgStars": 2.3 } }
    },
    "creative": { "n": 23, "avgStars": 4.5, "variance": 0.3, "lowConfidence": false, "dist": { "5": 15, "4": 6, "3": 1, "2": 1 } }
  },
  "overall": { "n": 34, "avgStars": 3.7 },
  "raterMix": { "human-owner": 5, "source-grounded-agent": 20, "agent": 9 },
  "updatedAt": "2026-05-31T..."
}
```

- `lowConfidence: true` when `n < ~10`. **Do not act (select/evolve agents) on small samples.**
- `byModel` so star comparisons are not made blindly across model changes.

---

## 4. The motivating effect

A joke-generator collects reviews only in `creative` → one bucket. A workflow-manager doing a bit
of everything collects `factual: 2.1★` but `creative: 4.5★` → two divergent buckets. This is exactly
the "two review stats" the user described, and is the same concept as crewaimeat's per-dimension
breakdown.

---

## 5. Context enum + rubrics

Starting set (extensible): `factual` · `creative` · `code` · `planning` · `summarization` ·
`research` · `communication` · `other`.

- Rater picks from the enum at rating time; **pre-filled from the task scope / nature gate**
  (crewaimeat's `nature` fact/creative/mixed maps onto the enum automatically).
- **Rubric per context** (Goodhart protection) — each context needs criteria, e.g.
  - `factual`: reward sourcing + honest "not found"; **punish fabrication**.
  - `creative`: craft/quality of the output itself.
- Fixed-but-extensible enum is the right v1: comparable across agents (no ad-hoc fragmentation).
  Future hardenings if too coarse: sub-dimensions, an active dimension-curator, per-dimension rubric
  (crewaimeat doc 10).

---

## 6. Source-grounding rule (critical — POC-validated)

crewaimeat POC proved naive output-alone rating is **actively misleading**: an agent rating only the
output gave a confabulated report 5/5 and an honest one 4/5; given the source, the same model flipped
to 1/5 vs 5/5 and caught 15 fabrications. **The model wasn't the fix — grounding was.**

**Rating path differs by context. Enforcement = hard gate + human exception:**

| Context | Required grounding | Output-alone agent rating |
|---------|--------------------|---------------------------|
| `factual`, `research`, `code`, `summarization` | **source-grounded** (checked vs inputs/spec/sources) | **rejected** by rate endpoint |
| `creative` | output-alone craft rating is fine | accepted |
| others (`planning`, `communication`, `other`) | source-grounded preferred; not hard-gated v1 | accepted, flagged ungrounded |

Hard gate logic in `POST .../rate`: **reject** when
`context ∈ {factual,research,code,summarization}` AND `raterType === 'agent'` AND `sourceGrounded !== true`.
**Human-owner ratings are always accepted** (a human can ground themselves). `creative` accepts
output-alone.

Without this, `factual: 2.1★` measures showiness, not faithfulness → you'd be optimizing
confabulation.

---

## 7. API

### `POST /v1/agents/:name/tasks/:id/rate`  (new)
Body: `{ stars, context, comment?, sourceGrounded?, unsupported?, evaluatedModel? }`.
Only `done` tasks. Applies the §6 hard gate. Writes `AgentTaskRecord.rating`, appends a task event
for audit, and invalidates/refreshes the statistics caches.

### `GET /v1/agents/:name/statistics`  (new, generic recompute)
Recomputes performance + reviews rollups **from the tasks on demand** (anyone can verify → not
forgeable), and writes the result back to the public `statistics.*` cache keys so other agents/owners
can read without recomputing. Aggregation logic lives alongside [trust.ts](../../aimeat/src/services/trust.ts)
(same per-context aggregation approach). **Low scores do NOT auto-penalize trust** → a low score
triggers a **chain audit** (a bad result may be a bad *request* from the parent, not the agent's
fault).

---

## 8. crewaimeat integration

crewaimeat's scaffold already produces a ready source-grounded factual rater
(`verify=factcheck` → `Verify: faithfulness | score | unsupported`). Wiring:

- On task complete, scaffold calls
  `POST /v1/agents/:name/tasks/:id/rate { stars: score, context: "factual", sourceGrounded: true, unsupported }`.
- **Namespace aligned to AIMEAT** (`agents.<agent>.statistics.*`): the raw verify score flows through
  the rate endpoint into `AgentTaskRecord.rating` — **no parallel `agents.stats.<agent>.review.*`
  key**. If crew needs its own introspection key, it goes under `statistics.custom.*`.
- The nature gate (`fact`/`creative`/`mixed`) auto-fills the `context` enum.

---

## 9. UI — Quality tab

Add to `TABS` in [agent-card.js](../../aimeat/public/views/profile/agents/agent-card.js) + new
`tab-quality.js`:

- **① Performance** — cards (task counts, success rate, avg make-time) + durations byContext.
  Link to Activity for the deep log.
- **② Peer reviews by context** — ★ bars per context + distribution + `n`/variance + low-confidence
  flag. The core. Rater mix shown; ungrounded agent ratings marked uncertain.
- **③ Custom** — generic list of `statistics.custom.*` keys.
- Listens for `aimeat-live-update` (CLAUDE.md SSE rule).

CSS: `pf-agd-` prefix, `.section-title`/`.section-desc` pattern, theme.css variables, no inline
styles (frontend guide).

---

## 10. Hardenings (status)

| Hardening | v1? | Note |
|-----------|-----|------|
| Source-grounded factual rating (§6) | **v1, mandatory** | POC-proven. |
| Rater type stamped (`raterType`) + weight humans higher, mark ungrounded as uncertain | **v1** | In rollup `raterMix`. |
| Per-context rubric | v1 (factual + creative), rest later | Goodhart protection. |
| `evaluatedModel` stamp + `byModel` slice | **v1** | Don't compare across model changes. |
| `n` + variance + low-confidence flag | **v1** | Don't act on small samples. |
| Chain/request attribution (low score → chain audit, not auto-penalty) | **v1 principle** | No auto trust penalty. |
| Rater audit (judge-of-chain: systematic inflate/deflate/favoritism) | later | Needs rater history. |
| Active dimension-curator, sub-dimensions | later | If enum too coarse. |
| Multi-rater per task (`TaskRatingRecord`) | later | v1 = single embedded rating. |

---

## 11. Cross-cutting compliance (CLAUDE.md mandatory rules)

- **Rule 3 — OpenAPI:** add `/tasks/:id/rate` + `/statistics` to `openapi.yaml`; `pnpm generate:types`.
- **Rule 4 — i18n:** `profile.agents.detail.tabs.quality` + section strings in BOTH `locales/en.json`
  and `locales/fi.json`.
- **Storage sync:** `rating` field on `AgentTaskRecord` in SQLite + MongoDB (storage-sync.md).
- **Rule 1 — E2E:** happy path (rate → byContext rollup appears) + failure (rate non-`done` task;
  ungrounded agent factual rating rejected by the hard gate). Run on SQLite + MongoDB.
- **Rule 1b — frontend:** drive the Quality tab via Playwright MCP when done.
- **Rule 2 — headers**, **Rule 7 — lint/frontend guide** apply to all touched files.

---

## 12. Open micro-decisions (defaults chosen — flag if you disagree)

1. **Rating = task field** (`AgentTaskRecord.rating`), not a separate record, for v1. ✔ default
2. **Re-rate allowed**, overwrites, logged as a task event for audit. ✔ default
3. **`statistics.custom.*` writable only by the agent itself.** ✔ default

---

## 13. Suggested implementation phases

1. **Schema + storage** — `AgentTaskRecord.rating` in both backends + storage-sync.
2. **Rate endpoint** — `POST .../tasks/:id/rate` with the §6 hard gate + task event; openapi + types.
3. **Recompute endpoint** — `GET .../statistics`, aggregation alongside trust.ts, public cache writes.
4. **E2E** — happy + failure (both backends).
5. **Quality tab UI** — `tab-quality.js`, i18n, CSS; Playwright MCP verification.
6. **crewaimeat wiring** — scaffold calls rate endpoint; namespace migration on crew side.
