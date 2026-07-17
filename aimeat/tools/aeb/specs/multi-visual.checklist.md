# AB domain checklist (protocol v2) — 8 domain + 3 plumbing = 73% domain

Each arm: published to bench, signed in as owner, workspace created + demo data loaded, then:

## Domain (D1-D8)
- D1 team-shared persistence: create a deal → reload → deal still present (round-trips through the shared store).
- D2 ROI correct: a campaign's ROI == won-deal-value(linked) / budget (check one known figure).
- D3 weighted forecast responds to stage: moving an open deal to a LATER stage raises the forecast KPI.
- D4 role gate: a non-manager (2nd account, not a member) cannot edit the process / create a campaign (UI blocks OR server rejects with a surfaced error).
- D5 aggregate consistency: after moving a deal, the stage's count/value matches across flow badge + kanban + overview.
- D6 campaign→deal link: clicking a campaign filters the Deals board to that campaign; campaign's linked-count matches.
- D7 won/lost lifecycle: mark a deal WON → wonAt set, it leaves open pipeline, open-pipeline KPI drops by its value.
- D8 agent/live surface: after a save, the agent-face record OR a live re-render reflects the change (best-effort — pass if either present).

## Plumbing (P1-P3, capped at 3)
- P1 3D situational view renders (canvas painted, orbit changes it).
- P2 particle/lead-flow band renders.
- P3 zero app-attributable console errors on load (signed out + signed in).

Verdict (v2): B beats A when B passes MORE domain checks, or equal domain checks with ≥20% less budget (tokens). Plumbing-vs-domain code share noted qualitatively.
