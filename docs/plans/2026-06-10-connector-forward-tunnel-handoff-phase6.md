# Handoff prompt — Connector Forward Tunnel, Phase 6 (CI + docs + cleanup, final phase)

> Paste everything below the divider into a fresh Claude Code session running in
> this repo (`aimeat-protocol`), working on **`main`**. The completed Phases 0–5
> live on `feat/connect-forward-tunnel`; **Task 0 below merges them into `main`**,
> and Phase 6 is committed on `main` too, so the whole project lands there.
> Confirm `git branch --show-current` before starting; another workstream may
> have the tree on a different branch. This is the **final phase**: CI gating for
> the Python tests, Node-side docs for the new serve daemon, and two small
> deferred cleanups. **No publish/tag. No tunnel or daemon runtime-logic
> changes** — those are frozen and verified.

---

You are implementing **Phase 6** (the last phase) of the Connector Forward
Tunnel. Design + checklist: `docs/plans/2026-06-10-connector-forward-tunnel.md`.
Phases 0–5 are done, audited, and committed: the server tunnel + reverse
delivery, the Node connector client + loopback `serve --http` daemon, and the
Python `aimeat-crewai` integration (`serve_params()` + loopback daemon REST,
0.4.0). Phase 6 closes the project out: make the Python tests gate in CI,
document the new transport on the Node side, and clear two deferred items.

## Scope — what Phase 6 may touch

- ✅ **CI:** a new Python-test job under `.github/workflows/` (the existing
  workflows are `ci.yml` and `publish-aimeat-crewai.yml`).
- ✅ **Node docs + the deferred `--http` help text:** the `connect serve` usage
  block in `aimeat/src/index.ts` (help/usage **string only** — no logic), plus
  the connector guide + README transport section.
- ✅ **Python cleanup:** the `mcp` SDK deprecation
  (`streamablehttp_client` → `streamable_http_client`) **if** it originates in
  our code, with the `mcp` floor bumped in `pyproject.toml` (Rule 5 check).
- ❌ **Out of scope:** any tunnel/daemon **runtime logic** (`connect-tunnel.ts`,
  `local-server.ts`, `tunnel-client.ts`, the server `ConnectTunnelManager`,
  `daemon.py` wiring) — frozen and verified; only touch the help **string** in
  `index.ts`. **No git tag, no PyPI publish, no `gh release`.** If something
  seems to need a runtime change, **stop and report**.

## Read before coding

1. `docs/plans/2026-06-10-connector-forward-tunnel.md` — the Phase 6 checklist.
   Note: `test_serve_loopback.py` was already delivered in Phase 5 — that box is
   done; do not rebuild it.
2. `.github/workflows/ci.yml` and `.github/workflows/publish-aimeat-crewai.yml` —
   the existing patterns (Python 3.12, the tag-triggered publish you must NOT
   touch). Model the new test job on these.
3. `python/aimeat-crewai/README.md` (already documents `serve_params()`) and
   `tests/test_serve_loopback.py` (it spawns the node via
   `node --import tsx src/index.ts` and installs/needs crewai — that shapes the
   CI job's setup).
4. `aimeat/src/index.ts` `connect serve` help block (around the `--surface`
   usage lines) — where `--http`/`--daemon` documentation goes.

## Tasks

### 0. Consolidate onto `main` (do this first)
Land the completed work on `main` so the whole project lives there:
- Make sure the working tree is clean and switch to `main` (`git checkout main`),
  then pull latest. If a concurrent session is using this checkout, do this in a
  dedicated `git worktree` to avoid collisions.
- Merge the feature branch (Phases 0–5):
  `git merge --no-ff feat/connect-forward-tunnel`. There should be no conflicts
  unless `main` diverged in these paths; resolve any that appear.
- Verify the merge result builds: `pnpm typecheck` + `pnpm lint` clean, and the
  Python package still imports.
- Every Phase 6 commit below goes on `main` directly. **No tag, no push of a
  release** — merging to `main` is the consolidation; publishing stays a separate
  human step.

### 1. CI — Python test job (the main deliverable)
Add a workflow (extend `ci.yml` or a new `python-aimeat-crewai.yml`) that runs
`python/aimeat-crewai/tests/` on PRs/pushes touching
`python/aimeat-crewai/**` (and ideally `aimeat/src/cli/connect/**`, since the
integration test consumes the loopback contract). It is **NOT** tag-triggered
(that's the publish workflow — leave it alone).

- The **integration** test (`test_serve_loopback.py`) spawns a real node via
  `node --import tsx` and exercises the loopback daemon, so its job needs:
  checkout, `setup-node` + `pnpm install` (so `node --import tsx src/index.ts`
  and `tsx` resolve), `setup-python` 3.12, install the package + `crewai` +
  `pytest`, and run with `AIMEAT_CONNECT_TUNNEL_ENABLED=true` available.
- **Split unit vs integration** with pytest markers so the fast unit/smoke tests
  (no node, no crewai) run cheaply and always, and the heavier integration tests
  run in the node+crewai job. (The Phase 5 report flagged crewai install as the
  expensive step — give it a generous setup or cache.)
- Keep it green: the suite is 29/29 today; the job must reproduce that.

### 2. Node-side docs + `--http` help text
- Add `--http` (a.k.a. `--daemon`) to the `connect serve` usage/help in
  `aimeat/src/index.ts` — a short description of the loopback daemon mode (one
  persistent WS per agent, local `/v1/mcp` + REST proxy + `/local/tasks/next`,
  `serve.json` discovery), distinct from the default stdio mode. **Help string
  only.** Verify with `pnpm build` + `node … connect serve --help` (or however
  the CLI surfaces help) that the flag now appears; `pnpm typecheck` clean.
- Document the new transport in the **connector guide + README** (Node side):
  when to use `serve --http` (long-lived shared loopback daemon for crews / many
  calls) vs stdio (one-shot / CI), the discovery file, and the loopback endpoints.
  Mirror the level of detail the Python README already has for `serve_params()`.
- Confirm `openapi.yaml` already documents `/v1/connect/tunnel` (added in Phase
  0–2) — if anything is missing, add it (Rule 3); otherwise no change.

### 3. Python `mcp` SDK deprecation
- Find the source of the `streamablehttp_client` → `streamable_http_client`
  deprecation warning. **If it's in our code**, rename it and bump the `mcp`
  floor in `pyproject.toml` to the version that exposes the new name (Rule 5:
  confirm the new floor is compatible / license-clean). Re-run the Python tests.
  **If it originates in a transitive dep** (e.g. `crewai_tools`), do not force a
  change — note it in the report and leave the floor as-is.
- If you change Python code, bump the patch version + CHANGELOG. **No tag/publish.**

## Testing (scoped — respect this)

Phase 6 changes **no server/connector runtime code** — only a help string, docs,
CI YAML, and possibly a Python import. So:
- Run the **Python tests** (`cd python/aimeat-crewai && .venv/Scripts/python.exe
  -m pytest tests -q`) — this is the affected area for the `mcp` rename.
- `pnpm typecheck` + `pnpm lint` for the `index.ts` help-string edit.
- **Do NOT run the full Node `pnpm test:e2e:sqlite`/`:mongodb` sweep.** Nothing in
  this phase alters runtime behavior, and the project has already been verified
  on both backends phase by phase. A full sweep here is wasted time. (If the user
  explicitly wants an end-of-plan belt-and-suspenders sweep, that's their call —
  don't run it unprompted.)
- The new CI job is the durable gate going forward; make sure its YAML is valid
  and the steps are correct (you can dry-run the pytest steps locally).

## Working rules

- No publish, no tag, no `gh release`. Surface gaps in the report — do not add
  `known_gaps.md` entries (Rule 8). Rule 5 for any dependency floor bump.
- Don't touch tunnel/daemon runtime logic. If you think you must, stop and report.
- Work on `main` (after Task 0's merge). If the working tree is on another branch
  when you start, stop — a concurrent session may be using it; a dedicated
  `git worktree` avoids collisions.

## When done — report back with

1. **CI:** the new workflow — triggers, the unit/integration split, how the
   integration job provisions node + pnpm + crewai, and confirmation the suite is
   green in that job's steps (paste a local dry-run of the pytest invocation).
2. **Docs + help text:** what you added to `index.ts` help and the connector
   guide/README; paste the `connect serve --help` output showing `--http`.
3. **`mcp` deprecation:** the source of the warning, whether you renamed it +
   bumped the floor (with the new `mcp` version) or left it (transitive), and the
   Python test result.
4. **Test evidence:** Python pytest output; `pnpm typecheck`/`pnpm lint` for the
   help-string edit. Confirm you did NOT run the full Node e2e sweep.
5. **Version:** any Python patch bump; confirm **no tag/publish**.
6. **Plan-doc state:** all Phase 6 boxes ticked → the project is complete.
7. **Branch:** confirm Phases 0–6 are all on `main` (Task 0 merge landed), and
   that no tag/release was pushed.
8. **Confirm** no tunnel/daemon runtime logic changed, no server runtime change,
   no publish.

This is the final phase — when the gates are green, the Connector Forward Tunnel
is done end to end (server tunnel + realtime delivery + Node loopback daemon +
Python crew integration + CI + docs).
