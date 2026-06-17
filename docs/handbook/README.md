# AIMEAT Handbook (shippable seed)

Draft content for the **AIMEAT Handbook organism** — the user-facing "how to run and extend
AIMEAT" guide that ships with the desktop package and is mirrored into an AIMEAT organism so it
is maintained on AIMEAT itself (dogfood) and doubles as AI-acceleration for anyone extending the
platform. Workstream F of `docs/plans/2026-06-17-desktop-agent-runtime-plan.md`.

**Status:** draft in the repo. Publishing these as organism Handbook pages (via the appdev MCP)
is a **milestone — held for the developer's explicit go-ahead** (CLAUDE.md ritual #4). Nothing
here auto-publishes.

## Pages

| Page | Audience | Source |
|------|----------|--------|
| [Local agents — getting started](local-agents.md) | Everyone (desktop) + coders (repo) | this repo |

## How it ships

1. **In the desktop package** — bundle these pages as offline docs the local node serves, so a
   fresh install has the handbook without a network round-trip.
2. **As an AIMEAT organism** — publish the same pages as Handbook entries in an "AIMEAT Handbook"
   organism so agents can read them via `aimeat_handbook_get` and the content is maintained on
   AIMEAT. Repo stays canonical for the text; the organism is the live, agent-readable copy.

Keep the two in sync (the repo is the source of truth; an `organism:sync` step — see the plan —
pushes updates to the organism on approval).
