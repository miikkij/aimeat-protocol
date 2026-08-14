# OpenAPI Spec Sync Plan

**Created:** 2026-03-13
**Status:** Planned
**Priority:** High (Mandatory Rule 3)

## Problem

The `openapi.yaml` specification is severely out of sync with the implementation:

- **271 routes** exist in code but are NOT documented in the spec
- **30 routes** are in the spec but don't match code (parameter naming mismatches, unimplemented endpoints)
- The spec claims "75 paths, 88 operations" but the implementation has **505+ endpoints**

## Strategy: Two-Track Approach

### Track A: Campsite Rule (Ongoing)

When touching any route file, add/update the corresponding OpenAPI definition. This happens naturally during regular development:

1. Check if the routes in the file you're editing are in `openapi.yaml`
2. If not, add them while you're there
3. Run `pnpm generate:types` after spec changes

### Track B: Dedicated Sync Sprint (Batched)

Systematically go through all route files and add missing definitions. Organize by priority:

#### Phase 1: Core API (Highest Priority)

These are protocol-required endpoints that external consumers depend on:

| Route File | Missing Endpoints | Priority |
|-----------|-------------------|----------|
| `agents.ts` | device-authorize, device-token, connect, verify flows | HIGH |
| `boards.ts` | Fix parameter names ({boardId} vs {id}), add subscriptions | HIGH |
| `owners.ts` | Fix parameter names ({name} vs {owner}) | HIGH |
| `memory.ts` | files endpoints, pub endpoint | HIGH |
| `work.ts` | sent, accept, reject, escalate, progress | HIGH |
| `wallet.ts` | Verify all transaction endpoints | HIGH |

#### Phase 2: Extended Features

| Route File | Missing Endpoints | Priority |
|-----------|-------------------|----------|
| `catalogue.ts` | knowledge, CRUD operations | MEDIUM |
| `knowledge.ts` | packages, reviews, links, export, import | MEDIUM |
| `cortex.ts` | Full cortex management API | MEDIUM |
| `extensions.ts` | instances, actions, translations | MEDIUM |
| `marketplace.ts` | Fix spec vs code (listings vs current implementation) | MEDIUM |
| `organisms.ts` | admin management | MEDIUM |
| `csm.ts` / `msm.ts` | Full management API | MEDIUM |
| `storage-files.ts` | wildcard key path ({*key}) | MEDIUM |

#### Phase 3: Infrastructure & Admin

| Route File | Missing Endpoints | Priority |
|-----------|-------------------|----------|
| `admin*.ts` (10 files) | ~60 admin management endpoints | MEDIUM |
| `federation*.ts` (5 files) | ~30 federation endpoints | MEDIUM |
| `portal.ts` / `portal-api.ts` | Portal, prompts, platforms | LOW |
| `personal.ts` | Anchor, mailbox, push subscriptions | LOW |
| `realtime.ts` | Rooms, relay, ICE servers, stats | LOW |
| `chat-instances.ts` | CRUD operations | LOW |
| `push.ts` | Push notification management | LOW |

#### Phase 4: Fix Parameter Inconsistencies

The spec uses different parameter names than the code:

| Spec | Code | Fix |
|------|------|-----|
| `{id}` | `{boardId}` | Update spec to match code |
| `{id}` | `{nodeId}` | Update spec to match code |
| `{owner}` | `{name}` | Update spec to match code |
| `{key}` | `{*key}` | Document wildcard pattern |
| `{extensionName}` | `{extName}` | Standardize |

#### Phase 5: Clean Up Dead Spec Entries

Remove or mark as deprecated:
- `/v1/portal/human/hobbies/*` (5 endpoints — SSR removed, replaced by SPA)
- `/v1/marketplace/listings/*` (if using different implementation pattern)

## Execution Notes

- Each phase can be done in a single session
- After each phase: `pnpm generate:types` + `npx tsc --noEmit`
- The spec file is large (~330KB) — work on one tag/section at a time
- Use existing spec entries as templates for format consistency
- Tags in the spec: Bootstrap, Auth, Identity, Memory, Micro-Memory, Storage, Actions, Work Queue, Economy, Boards, Federation, Observability, Extensions

## Definition of Done

- Every route in `src/routes/*.ts` has a corresponding entry in `openapi.yaml`
- Parameter names in spec match code exactly
- All response schemas document the actual envelope format
- `pnpm generate:types` produces types matching the implementation
- No dead/unimplemented endpoints remain in the spec (or are marked deprecated)
