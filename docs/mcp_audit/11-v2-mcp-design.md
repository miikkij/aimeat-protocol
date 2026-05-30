# Design: `/v2/mcp` — a consolidated, structured, opt-in MCP surface

**Status:** DESIGN — review before implementing.
**Date:** 2026-05-30
**Author:** MCP-audit session
**Builds on:** the canonical-catalog spine from audit phases 1–6 (`src/mcp/catalog/*`, `annotations.ts`).

---

## 1. Why v2 (and not the alternatives)

We want a leaner, fully-structured tool surface (audit F2 + F4 + F7) without the downsides of the two obvious routes:

- **Mutating `/v1/mcp`** → breaks existing agents, forces migration aliases/deprecation, and the consolidation can't be validated without a live-LLM eval first (the eval gate exists precisely to protect live consumers).
- **A `search_tools` progressive-disclosure facade** → forces the agent to "discover before doing" (chicken-and-egg), which is awkward and not how core MCP is meant to work. Lazy tool-loading only pays off at *hundreds* of tools; at ~50–100 the right answer is **fewer, better tools**, which `tools/list` shows normally.

**Decision: add a new `/v2/mcp` surface.** `v1/mcp` is frozen and keeps working as-is for current consumers. `v2/mcp` is the opt-in, consolidated, structured-by-default, fully-reconciled surface. Because v2 has **no consumers yet**, we can consolidate boldly and iterate — the eval becomes a *refinement* tool, not a release blocker.

> Versioned surfaces are a known pattern (REST `/v1` `/v2`). The cost is "another surface to keep in sync" — addressed in §6.

---

## 2. Non-negotiable principle: v2 is a *projection of the canonical catalog*, not a fork

The whole point of phases 1–6 was one canonical source (`src/mcp/catalog/definitions.ts` + `shape.ts` + `scopes.ts` + `output-schemas.ts`, all transport-neutral). **v2 MUST reuse it.** v2 differs from v1 only in:

1. **which tools it registers** (a consolidated set), and
2. **always** returning `structuredContent`/`outputSchema` and `response_format`.

It must **not** duplicate handler logic. We just spent a full phase (F10) killing drift between *two* surfaces; a third forked implementation would triple it.

### The enabling refactor: a tool-logic layer

Today each handler body lives inline inside `registerXxxTools(mcp, ...)`. To share logic between v1 (granular tools) and v2 (merged tools), extract each tool's body into a plain async function:

```
src/mcp/logic/<domain>.ts
  export async function memoryRead(storage, config, gaii, { key }): Promise<MemoryReadResult> { ... }
  export async function memoryList(...) { ... }
  ...
```

- **v1** `registerXxxTools` → thin `mcp.tool(...)` wrappers that call the logic fns (granular, unchanged behavior).
- **v2** `registerXxxToolsV2` → `mcp.registerTool(...)` wrappers, some of which **dispatch** (by `op`/`kind`) to several logic fns, all returning `structuredResult(...)`.

This is the main cost of v2 and the main payoff: after extraction, v1 and v2 are two thin projections over identical logic — they *cannot* drift in behavior.

---

## 3. What v2 changes vs v1

| Aspect | v1/mcp | v2/mcp |
|--------|--------|--------|
| Tool set | full granular (~98) | consolidated (~target below) |
| Output | text; structuredContent on 6 tools | `structuredContent` + `outputSchema` on **all** reads |
| `response_format` | 5 read tools | all list/read tools |
| Input schemas | reconciled (F10) | same, canonical only (no legacy aliases) |
| Scope enforcement (F1) | yes | yes (same `scopes.ts`) |
| Descriptions | canonical catalog | same catalog |
| Stability | **frozen** (no breaking changes) | evolving until declared stable |
| Discovery | `tools/list` | `tools/list` (no facade) |

OAuth, transport (Streamable HTTP), session handling: **shared with v1** (same `mcpRouter` machinery; v2 is a second `createMcpServer` variant + route mounts).

---

## 4. Consolidation map (PROPOSED — refine with surface-weight + eval)

Baseline today: **99 tools, ~12.9k tokens** of `tools/list` context. Per-domain heaviest: task(9), board(9), agent(6), extension(7), capabilities(7), onboarding(5), group(5), app(5), cortex(5), organism(5), catalogue(4), knowledge(4), admin(4).

Merges use a discriminator param (`kind`/`op`/`action`) **only where the operations are genuinely variants of one workflow** — never force unrelated ops together (that hurts agents). Granular state-machine tools that agents call distinctly stay split.

| Domain | Today | v2 proposal | Net | Notes |
|--------|-------|-------------|-----|-------|
| catalogue | 4 (search/agents/boards/directory) | 1 `catalogue_search(kind=actions\|agents\|boards\|people)` | −3 | clean: all are "discover X" |
| capabilities | 7 | `capability_manage(op=create\|update\|delete\|vouch)` + keep get/list/invoke | −3 | keep invoke/get/list distinct |
| onboarding | 5 | `onboarding_step(step=…)` + keep status | −3 | steps are one flow |
| extension | 7 | `extension_lifecycle(action=activate\|deactivate\|delete)` + keep install/invoke/get/list | −2 | |
| cortex | 5 | `cortex_lifecycle(action=…)` + keep install/list | −2 | |
| board | 9 | `board_browse`(list+read) · `board_post`(post/reply/react via kind) · `board_admin`(create/delete/members/subscribe) | −6 | most aggressive; **eval this** |
| task | 9 | merge complete+fail → `task_resolve(outcome=)`, event+todo → `task_progress(kind=)`; keep create/get/list/propose_todos/request_changes | −3 | tasks are a state machine — don't over-merge |
| agent | 6 | mode_set+tags_set → `agent_classify` (owner) | −1 | keep reports/activity/profile |
| organism | 5 | join+leave → `organism_membership(action=)` | −1 | |
| group | 5 | add_member+remove_member → `group_member(op=)` | −1 | |
| app | 5 | get+versions → `app_get(include_versions?)` | −1 | (note: v1 app_* drift is a backend split — resolve here) |
| knowledge/memory/consent/work/wallet/storage/instance/flag/action/message/admin/handbook | ~ | keep granular | 0 | already focused |

**Projected: ~99 → ~73 tools, ~12.9k → ~9–10k tokens.** This is a *meaningful* reduction, not the optimistic "~50" — honest workflow merges only. If the eval shows specific merges don't hurt task success, we can go further; if a merge hurts discovery, we split it back. **v2's no-consumer status makes this safe to iterate.**

> The `app_*` and `handbook_get` v1 drifts (left baselined in F10) are *semantic* splits (different backends per surface). v2 is the place to make the deliberate call: pick ONE meaning per tool, or expose both as clearly-named distinct tools.

---

## 5. No `search_tools` facade

Explicitly rejected for v2. Reasons: (1) the discover-before-act chicken-and-egg is poor UX, (2) it doesn't reduce `tools/list` cost unless tools are *unregistered* (which breaks normal clients), (3) at ~73 tools plain listing is fine. If v2 ever grows past a few hundred tools, revisit — until then, **fewer/better tools** is the token win.

---

## 6. Drift control (the thing that makes v2 safe)

Extend the Phase 6 audit (`scripts/audit-mcp-schemas.ts`) to capture **three** surfaces: v1 server, v2 server, connector. Add checks:

- Every v2 merged tool's dispatched-to logic exists and is covered.
- v2 and v1 share the same canonical input names for non-merged tools.
- v2 tools all declare an `outputSchema` (gate: v2 read tools without one fail).
- The existing `--strict` ratchet covers v1↔connector; add a v2 lane.

Without this, v2 silently drifts; with it, the ratchet holds all surfaces to the catalog.

---

## 7. Coexistence & lifecycle

- `v1/mcp` stays mounted, frozen (bug-fixes only). Existing agents unaffected.
- `v2/mcp` mounted alongside; opt-in via the connector/client config (`/v2/mcp` URL).
- `.well-known` discovery advertises both; clients choose.
- Optional far-future: once v2 is stable and adopted, deprecate v1 with a long window. **Not** part of this work.

---

## 8. Implementation phases (incremental, each verifiable)

**P0 — Scaffolding.** Mount `/v2/mcp` route (reuse `mcpRouter`'s OAuth/transport; add a `createMcpServerV2`). Register the **same** tools as v1 initially (via shared logic where already extracted, inline otherwise) so v2 is functionally complete from day 1. Verify: v2 `tools/list` works, scope-filtering applies, e2e smoke.

**P1 — Tool-logic layer.** Extract handler bodies → `src/mcp/logic/<domain>.ts`. Re-point v1 wrappers at them (no behavior change — existing e2e must stay green). This is the big, careful step; do it domain-by-domain with the e2e suite per domain.

**P2 — Structured-by-default in v2.** All v2 read/list tools use `registerTool` + `outputSchema` + `structuredResult` (reuse `output-schemas.ts`, extend it per domain). v1 unchanged.

**P3 — Consolidate v2 (domain by domain).** Apply the §4 map: add merged tools (dispatch to logic fns), drop the granular ones from v2 only. Run `eval:mcp-surface` after each domain (token delta) and the eval tasks where feasible. v1 keeps the granular tools.

**P4 — Audit + tests.** Extend `audit-mcp-schemas.ts` to the v2 lane (§6). New `test/e2e-mcp-v2.ts`. Full sweep.

Each phase: typecheck + lint + relevant e2e green before commit; bump file headers (Rule 2); OpenAPI for the new `/v2/mcp` routes (Rule 3).

---

## 9. Open decisions (need owner/developer input)

1. **How aggressive to merge** (esp. board 9→3, task) — start moderate, let `eval:mcp-surface` + the live eval push further. Default: implement the table, measure, adjust.
2. **`group_*` naming** (`group_` vs `sharing_group_`) — product decision, still open from Phase 5.
3. **`app_*` / `handbook_get` semantic split** — decide the single canonical meaning per tool in v2, or expose two clearly-named tools.
4. **Run the live eval?** — recommended before declaring v2 "stable", but not blocking P0–P3 since v2 has no consumers.

---

## 10. Risks

- **Two/three surfaces to maintain.** Mitigated by the shared logic layer (P1) + the extended audit (P2/§6). Without P1 this whole thing re-creates the drift we fixed — P1 is non-negotiable.
- **Logic-extraction regressions.** Mitigated by doing it domain-by-domain with the existing e2e suites as the safety net (behavior must not change in P1).
- **Consolidation hurting agent ergonomics.** Mitigated by v2's no-consumer status (iterate freely) + surface-weight + eval.
- **Scope creep.** v2 is large; the phasing (P0–P4) keeps each step shippable and reversible.

## 11. Definition of done (the whole effort)

- [ ] `/v2/mcp` mounted; OAuth/transport shared with v1; scope-filtering applies.
- [ ] `src/mcp/logic/*` extracted; v1 re-pointed at it; **all existing e2e green** (behavior unchanged).
- [ ] v2 reads/lists return `structuredContent` + `outputSchema`; `response_format` everywhere sensible.
- [ ] v2 consolidated per §4 (as refined); `eval:mcp-surface` shows the token drop, documented before/after.
- [ ] `audit:mcp-schemas` covers v1 + v2 + connector; `--strict` ratchet green across all.
- [ ] `test/e2e-mcp-v2.ts` covers v2 happy-paths + a consolidated dispatcher + scope-filtering.
- [ ] OpenAPI documents `/v2/mcp`; `pnpm generate:types` clean.
- [ ] Full `pnpm test:e2e:sqlite` + `:mongodb` green (Rule 1).
