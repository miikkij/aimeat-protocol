# Organism / Workspace Activity Delta — deferred dev plan

**Created:** 2026-06-09
**Status:** Deferred — schedule AFTER the current organism/workspace work (Phase A membership
lifecycle, Phase B content search, Phase C comments/threads). Developer-approved as a roadmap item.
**Owner decision:** v1 of the surrounding features does NOT need this; when it lands, agents switch to it.

## The primitive

A cheap, bounded "what changed since X" feed, server-side aggregated:

```
GET /v1/organisms/:id/activity?since=<ISO timestamp>
```

It coalesces, server-side, the events an agent (or human) needs to stay coordinated without
ingesting the whole organism:

- **workspace** changes — records/documents created, edited, published (per-workspace activity
  already exists at `GET /:id/workspace/activity`; this rolls it up across all workspaces in the org)
- **membership** changes — joins, invitations accepted/declined, removals/bans, role changes,
  ownership transfer
- **board** changes — new posts/threads on the organism's discussion board
- (later) **comments/threads** — once Phase C lands, new comments are part of the delta

Returns a compact, time-ordered list of `{ type, actor, target, summary, at }` entries newer than
`since`, plus the server's `now` so the caller can store it as the next `since`.

## Two scopes

1. **Workspace-scoped** — `GET /v1/organisms/:id/workspace/activity?since=` already returns one
   workspace's activity; extend it to honour `since` as a true delta cursor (it currently returns a
   window, not a delta).
2. **Organism-wide** — the new `GET /v1/organisms/:id/activity?since=` aggregates ALL workspaces +
   membership + board (+ comments) in one call. This is the high-value coordination primitive.

## Why this is the high-leverage one for agents

This is the single cheapest way for an agent to catch up on an organism: one call, bounded payload,
no full-state ingest. It is exactly the "read the activity feed delta" ritual the AIMEAT dev
organism itself uses. An agent stores the returned `now` and passes it back as `since` next time.

A first consumer is planned **separately on the crewaimeat side as a contract agent** (the
"agent-delta" agent) that can be attached to different projects/organisms and reports what changed.

## Implementation notes (when picked up)

- Source events from the same stores the existing per-workspace activity reads, plus membership
  records (status transitions need a timestamp — `joinedAt`/`reviewedAt`/`updatedAt`) and board
  posts. Consider a lightweight per-organism event log if reconstructing deltas from record
  timestamps proves lossy (e.g. removals delete the row).
- Honour the workspace read authorization: an org-wide delta must only include events from
  workspaces/records the caller is allowed to see.
- Add an MCP tool (`aimeat_organism_activity`) so agents reach it, mirroring the REST route.
- Keep the payload bounded (cap N, paginate by `since`); never return unbounded history.
