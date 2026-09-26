---
paths:
  - "**/aimeat/test/**"
  - "**/aimeat/scripts/{test-env-init,kill-test-servers,gate}.ts"
  - "**/.github/workflows/**"
---

<!-- Moved verbatim from CLAUDE.md on 2026-09-13. It loads when Claude reads a file matching `paths`, not at session start. -->

## Gates for this area

- **The guard tier blocks a merge; the full sweep does not.** `pnpm test:e2e:guards:sqlite` and `pnpm test:e2e:guards:postgres-kysely` run the 138 suites CI refuses to merge without, every one of them a refusal or an isolation boundary; the runner prints the assertion total, and takes a few minutes per backend. **A suite joins by earning it, never by looking safe:** alone, on a freshly deleted database, three consecutive identical green runs on BOTH backends. The 44 promoted on 2026-09-04 were measured that way — 264 runs, zero flakes, and per-suite counts identical between the backends. Run it through `pnpm gate` once when a change under `src/routes/`, `src/auth/`, `src/services/`, `src/storage/`, `src/mcp/`, `src/middleware/`, `src/utils/`, `src/commerce/`, `src/server-bootstrap/` or the configuration files is finished, not on every push; CI runs it on every push regardless. Both E2E steps were `continue-on-error: true` until 2026-08-15, so no red suite had ever stopped anything; the full sweep stays advisory because it takes two hours and §18 makes it occasionally wrong. Fixing a suite so it can join the tier is the intended direction. → `docs/coding-guidelines/testing-requirements.md` Rule 1b
- **Never claim you broke nothing from a full-sweep total.** The E2E runner clears the database between suites and not before the first, and kills the server on a fixed one-second wait, so a slipped restart hands the next suite the previous one's data and produces hundreds of unrelated `403`s. One suite failed 78 times in a sweep and passes 95 of 95 alone. A regression claim needs one suite at a time, freshly deleted database, run on a worktree of the commit you started from as well. Your own gitignored `aimeat/.env` is loaded by the test server, so that worktree does not have it and the comparison flatters the new tree. → `docs/pitfalls.md` §18
- **When a test goes green after your change, say which of three it was**: it asserted the hole you closed, the source was broken, or its setup no longer matched production. Write it in the diff with the finding id. A suite in this repo asserted `agent of owner should inherit owner role` in one line. → `docs/pitfalls.md` §19
