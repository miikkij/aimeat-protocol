# MCP tool eval harness (audit Phase 5 / F2)

Tool consolidation must be **measured, not guessed** (audit doc 07). This harness provides the two
measurements the plan calls for:

## 1. Surface weight — deterministic, runnable now

```bash
pnpm eval:mcp-surface           # human-readable
pnpm eval:mcp-surface -- --json # machine-readable
```

Reports the **context cost** of the tool surface: the approximate tokens every client pays just to
load `tools/list` (name + title + description + input schema), per tool and per domain. This is what
consolidation and progressive disclosure (Phase 7) optimize.

**Baseline (2026-05-30, 99 tools): ~11,720 tokens.** Heaviest domains: `task` (9 tools, ~1,212),
`board` (9, ~1,058), `agent` (6, ~948), `extension` (7, ~776), `capabilities` (7, ~743).

Run it **before and after** any consolidation; the token delta is the hard number.

## 2. Task success — live LLM, developer-run

`tasks.ts` defines realistic multi-step tasks. Running them needs a model (spend + nondeterminism),
so it is **not** part of CI and is not run by the agent that built this. To run:

1. `export ANTHROPIC_API_KEY=...`
2. Start a node and connect an agent with broad scopes (so nothing is scope-filtered):
   `pnpm start` then register an agent and obtain an MCP token (see `test/e2e-mcp.ts` for the OAuth
   PATH A flow), or point the loop at `aimeat connect serve`.
3. For each task in `EVAL_TASKS`, run an agentic loop (alternate model call ↔ MCP `tools/call`) and
   record: tool-call count, total tokens, tool errors, and whether `verify` is satisfied (string
   match or Claude-as-judge).
4. Compare the aggregate before/after a consolidation. **Accept the consolidation only if tool-calls
   and tokens drop without task-success regressing or errors rising.**

## How this gates Phase 5 consolidation

The audit named these consolidation candidates (now backed by the weight numbers above):

| Candidate | Note |
|-----------|------|
| `catalogue_search` + `_agents` + `_boards` + `_directory` → `catalogue_search(kind=)` | distinct endpoints/params; merge only if eval shows the kind-switch doesn't hurt discovery |
| `capabilities_create/update/delete/vouch` → `capability_manage(op=)` | keep `get/list/invoke` separate |
| `board_create` + `subscribe` | assess as a create-then-subscribe workflow tool |
| `aimeat_group_*` naming | **product decision** (`group_` vs `sharing_group_`) — owner decides, not inferred |

Merges land **after** a developer runs the live eval and makes the naming decision. When they do,
mark the old names deprecated (keep them as thin aliases for a migration window) and re-run both
measurements; the count reduction is realized when the aliases are finally removed.
