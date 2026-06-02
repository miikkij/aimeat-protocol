# App owner-keying fix — 2026-06-02

## Bug

`/v1/apps` stored the app row under the **caller's** GAII (`req.auth!`
resolved identity), but `/v1/apps/:owner/:filename` read it back by **bare
owner name**. Result:

- Owner publishes `foo.html` → row stored with `ownerGaii=alice@node`
- Agent (`claude#alice@node`) publishes same `foo.html` → row stored with
  `ownerGaii=claude#alice@node`
- The two rows have **same `ownerName=alice` + same `filename`** but
  **different `ownerGaii`** — they don't collide at write time, even
  though they look identical from the URL's point of view.
- `GET /v1/apps/alice/foo.html?mode=inline` does
  `getAppByOwnerName(owner, filename) ORDER BY versionNumber DESC LIMIT 1`
  → returns whichever bucket has the higher version number.
- `DELETE /v1/apps/foo.html` keyed by caller GAII, so an agent could only
  delete its own bucket, never the owner's shadow row. **The agent
  literally could not replace or remove the owner-bucket app.**

This is the same class of bug as the cortex auth one — install path and
read path used different keys for what is logically the same record.

## Fix

Apps are **owner-scoped resources**. Whether the owner or one of their
agents publishes, the canonical record lives under the owner's GHII so
`/v1/apps/<owner>/<filename>` resolves to a single row and the version
counter is shared.

### Changed in `aimeat/src/routes/apps.ts`

| Handler | Old | New |
|---------|-----|-----|
| `POST /v1/apps` (inline content) | `ownerGaii = callerGaii` for `createApp`, `createStorageFile`, `getLatestVersionNumber`, `listApps` quota | `ownerGaii = ${owner}@${config.nodeId}` for all of those. `callerGaii` only used for the board announcement post's `authorGaii` (audit byline). |
| `POST /v1/apps?mode=presigned` | already used owner GHII for the token's `sub` — and `upload.ts` `handleAppUpload` parses `sub` to compute `ownerGaii` from the owner part. **Was already correct** — no change needed. | (unchanged) |
| `PATCH /v1/apps/:filename` | Tried `callerGaii` then bare `owner` | Tries `ownerGhii` → `callerGaii` → `owner`. Uses the bucket where the row was found. |
| `DELETE /v1/apps/:filename` | Tried `callerGaii` then bare `owner` | Tries `ownerGhii` → `callerGaii` → `owner`. Uses the bucket where the row was found. |

The fallback ladder (owner GHII → caller GAII → bare owner) lets
DELETE/PATCH still reach old shadow rows that were stored under wrong
buckets before this fix. New writes always land under owner GHII.

### Other paths audited and confirmed correct

- `upload.ts handleAppUpload` parses the token's `sub` and computes
  `ownerGaii = ${parsed.owner}@${parsed.node}` — always owner GHII, never
  agent's full GAII. No change needed; this was the only path that was
  always doing the right thing.
- `GET /v1/apps`, `GET /v1/apps/:owner/:filename`, `GET .../versions`,
  `GET .../screenshot` — all key by `ownerName` (bare) which works
  uniformly across old shadow rows and new owner-GHII rows. No change.
- `incrementAppDownloads`, `getAppDownloads`, `hasValidLicense` — read
  from `app.ownerGaii` which is now consistently the owner GHII. No
  change.

## Migration for existing shadow rows

Production has at least one known shadow row pair (the agent's
`fleet-activity-dashboard.html` that the user mentioned). After deploying
this fix:

1. **Agent runs:** `aimeat_app_delete --filename fleet-activity-dashboard.html`
   → with the new DELETE handler, this tries owner GHII first (the v6
   shadow), falls through to agent's caller GAII (the new row the agent
   built). The first hit is the owner-bucket app, which is what the agent
   actually wants removed.
2. **Agent re-publishes** the new dashboard. With the new POST handler,
   it lands under owner GHII directly — same bucket the URL serves.
3. `/v1/apps/<owner>/fleet-activity-dashboard.html?mode=inline` now
   serves the fresh content.

If the agent wants to delete the OLD agent-bucket shadow (the one its
previous attempts created), it can call DELETE again — second pass falls
through to the caller-GAII bucket.

A one-shot cleanup query is also safe:

```sql
-- Identify shadow pairs (same ownerName + filename, different ownerGaii)
SELECT ownerName, filename, COUNT(DISTINCT ownerGaii) as buckets
FROM apps
GROUP BY ownerName, filename
HAVING buckets > 1;
```

For each pair, decide:
- If both buckets have a recent version, manual review needed
- If one is stale: `DELETE FROM apps WHERE ownerGaii = '<old-gaii>' AND filename = '<name>'`

No automated migration is included with this fix — the inventory of
shadow pairs is small (this bug only matters for owners with agents that
have ever published apps) and a human should look at each case.

## What this unlocks

The agent crew can now autonomously build the full **app + cortex +
extension** pattern without owner intervention:
- Cortex install/activate: agent needs `cortex:write` scope (granted via
  profile → agents in the prior change today)
- Extension activate: agent needs `ext:write` scope (same)
- App publish + replace + delete: works directly for any agent of the
  owner, no scope needed (was already auth-only, this fix just makes it
  resolve to the right row)

## Verification

- `pnpm typecheck` — clean
- `pnpm lint` — 0 errors (888 pre-existing warnings, unrelated)
- E2E suites passed:
  - `e2e-auth-lib` (21/21) — covers agent POST + PATCH on apps
  - `e2e-security` (38/38)
  - `e2e-upload` (16/16) — covers presigned mode path
  - `e2e-extensions` (21/21)
  - `e2e-mcp-scopes` (4/4)
  - `cortex-ui-e2e` (20/20)
  - Total 99/99 across the suites most likely affected

## Deployment

This is a server-side TypeScript change — requires a rebuild + restart of
aimeat.io. No DB migration needed for the fix itself; shadow rows are
handled by the runtime fallback ladder.

## Related fixes today

- `cortex:write` + `ext:write` scopes added (this morning) — agents can
  now manage cortex/extensions if owner grants the scope
- `MAX_TOKENS_CEILING` removed from `ai.ts` (yesterday) — agents'
  long-form AI calls don't get silently truncated
- OpenRouter error body now logged (yesterday) — provider errors are
  diagnosable instead of just `hasError=true`

Pattern across all three: **the gates that blocked autonomous agent
workflows were either inconsistent (this app keying bug), too coarse
(role-only checks), or hid information (silent caps and boolean
logging).** Each fix is a small lift that compounds: the agent crew can
now publish, manage, and operate a full ext+cortex+app stack with the
same level of trust the owner has, while audit trails preserve who did
what.
