---
paths:
  - "**/aimeat/src/mcp/**"
  - "**/aimeat/src/cli/**"
  - "**/python/aimeat-crewai/**"
---

<!-- Moved verbatim from CLAUDE.md on 2026-09-13. It loads when Claude reads a file matching `paths`, not at session start. -->

## Gates for this area

- **A tool has THREE surfaces, not two.** The node MCP (`src/mcp/`), the connector MCP (`src/cli/connect/mcp/tools/`), and the CLI dispatch behind `/local/call/<tool>` (`CONNECT_CLI_TOOLS` in `src/cli/connect/tool-call-defs-*.ts`), which is what a fleet daemon actually calls. A parameter added to the first two does not exist on the third, and it is dropped in silence, so the call succeeds having done less than it was asked. That cost the same defect three times in one week, each found by a crew rather than by us. Two things now stop it: the dispatch REFUSES an undeclared parameter instead of ignoring it (`withDeclaredInputOnly` in `tool-call.ts`, one wrapper on the assembled table so neither door can miss it), and `test/unit/cli-tool-param-forwarding.test.ts` INVOKES every handler against a recording client and fails if a published parameter never leaves the process. Do not gate this by reading handler source: that was tried on 2026-08-16 and was wrong in both directions inside an hour. And the drift is not always a parameter: the same tool NAME meant two different backends for months — `aimeat_app_*` served the 50 single-file apps at `/v1/apps` on the node and the 4 component packages at `/v1/packages` on both connector doors, so a fleet agent could not reach one real app. Packages are `aimeat_package_*` now. When a catalog DESCRIPTION and its own `input` disagree, believe neither and read the route. It reads the worktree rather than the index, so an uncommitted fix can green it falsely. CI runs the same set plus the vitest suite. A second hook, `.githooks/commit-msg`, checks the message itself.
