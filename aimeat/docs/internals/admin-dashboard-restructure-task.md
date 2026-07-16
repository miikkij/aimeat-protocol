# Task: Admin Dashboard Restructure — eager `loadAll` → lean mount bundle + lazy per-tab

> **This is a self-contained execution prompt for a fresh focused session.** It is the one remaining
> major item from the data-access efficiency campaign (plan `doc-v9n0cda`, roadmap memory
> `efficiency-survey-roadmap`). Everything you need to execute is below — you should not need to
> re-discover the current state. Read it top to bottom, then work the slices in order.

---

## 0. Why this is its own session

The other ~25 view composites in the campaign were user-facing tab/card mounts — small, isolated, each
browser-verifiable as `happydude500001` (owner). **This one is different and higher-risk:**

- It refactors the **operator-only** admin dashboard (`/v1/admin`), which a normal owner session cannot
  fully reach — so browser verification needs an operator session (see §6).
- Its blast radius is large: one `loadAll` feeds ~46 admin tabs.
- During the campaign the pre-commit gate was poisoned by a concurrent session's WIP, forcing
  `--no-verify`. **Before starting, check `git status` — if `src/mcp/apps.ts` /
  `src/services/workspace-versions.ts` (or similar) are dirty and failing lint/tsc, the tree-wide gate is
  still broken.** Ideally that WIP is committed/reverted first so the normal pre-commit hook works. If not,
  you must verify your own files standalone (see §5) and commit `--no-verify` with an honest note.

Do NOT rush it in alongside other work. It is the whole session.

---

## 1. Goal

The admin dashboard (`public/views/admin.js` → `loadAll`, lines ~186–329) eagerly fires **~31 requests on
mount**, populating a single `data` object consumed by all tabs — *before the operator has opened any tab*.
Opening the dashboard to look at one tab pays for all ~31 domains.

**Target:** a **lean mount** (only what the landing/overview tab + the sidebar counts need) plus **lazy
per-tab loading** (each tab fetches its own slice the first time it's opened, cached thereafter). Plus the
plan's three admin composites where a single tab still fans out.

This mirrors what was already done for `GET /v1/owner/home` (owner dashboard): the heavy cards are
lazy/gated, only a lean set fires on mount. The admin dashboard is the operator analogue and the plan's
"largest absolute win" — but operator-only.

Reference: plan `doc-v9n0cda` § ADMIN; roadmap memory `efficiency-survey-roadmap` (has the full history).

---

## 2. Current state — the exact eager fan-out (READ THIS FIRST)

`public/views/admin.js`, `loadAll(silent)` useCallback (~line 186). All fire on mount via the effect at
~line 331 (`useEffect` keyed to session). The four phases:

- **Phase 1 (4, `Promise.all`)** — `getDashboard` (the auth gate; 403 here = not operator),
  `getAdminAgents`, `getActions`, `getBoards`.
- **Phase 2 (7, `Promise.allSettled`)** — `getMaintenance`, `getAdminWork`, `getFederation`, `getHooks`,
  `getChatInstances`, `getRealtime`, `getFederationPeers`.
- **Phase 3 (14, `Promise.allSettled`)** — `getGhiiUsers`, `getEmailStatus`, `getDirectoryStats`,
  `getMatchingStats`, `getMarketplaceStats`, `getPushStats`, `getCsmTemplates`, `getMsmIntegrations`,
  `getGenesisPeers`, `getConfig`, `getConsulStatus`, `getSchedulerJobs`, `getExtensions`,
  `getSystemPrompts`.
- **Phase 3.5 (1)** — `fetchSchedulerExecutionLog`.
- **Phase 4 (3 + 2)** — `getSiteMeta`, `getSiteTemplate`, `getSiteChangelog`; then `getStats`,
  `getAdminOwners`. `getAdminOwners` also finalizes the `owners` count.

Consumers: `public/views/admin/*-tab.js` (46 tab files) read fields off the shared `data` prop (e.g.
`data.federation`, `data.ghiiUsers`, `data.matchingStats`). The sidebar `counts` come from
`dash.data.counts` + a few finalized after the loads (owners/work/peers/rooms/ghii/genesis/msm).

Client service: `public/js/services/admin.js` (the `api.*` wrappers, ~339 lines). Route files:
`src/routes/admin-*.ts` (one per domain) + `src/routes/admin/`.

**Key insight:** most `data.*` fields are consumed by exactly ONE tab. Those are the lazy-load candidates.
Only the fields the OVERVIEW/landing tab + the sidebar counts need must stay in the mount bundle.

---

## 3. Target architecture

### 3a. Lean mount bundle
Keep on mount ONLY:
1. `getDashboard()` — the auth gate + `counts` (must stay; it's how 403/operator is detected).
2. Whatever the **default/landing tab** actually renders (inspect which tab is active on open — likely an
   "Overview"/dashboard tab) + the sidebar `counts`.

Everything else moves to lazy per-tab. Some counts are currently finalized from full lists
(`newCounts.owners = d.owners.length`, `.work`, `.peers`, `.ghii`, `.genesis`, `.msm`). If a count needs a
full list that you're making lazy, either (a) get the count from `getDashboard`'s `counts` if already there,
or (b) add a cheap count to the dashboard payload — do NOT keep loading the full list just for a length.

### 3b. Lazy per-tab
Each tab component fetches its own data on first open and caches it (so switching away and back doesn't
re-fetch). Two clean options — pick whichever fits the existing tab architecture:
- **Preferred:** move each tab's fetch into the tab component itself (a `useEffect` on mount with a
  module/parent cache), so `admin.js` no longer fetches it. This is the biggest structural win and matches
  the per-view-owns-its-data direction of the whole campaign.
- **Lighter:** keep the fetches in `admin.js` but trigger each lazily keyed on `activeTab` (a
  `loadedTabs` set; fetch a tab's slice the first time it becomes active). Less churn, still kills the
  mount fan-out.

Either way: **on mount, only the lean bundle fires. Opening tab X fires only tab X's slice, once.**

### 3c. The three admin composites (plan § ADMIN)
Where a SINGLE admin tab still fans out, fold it — same purpose-specific-service pattern as the rest of the
campaign (see §4). Build these as `src/services/db/*-db-service.ts` + a composite endpoint:
- **`AdminUsageService`** → the AI-usage/ledger admin tab (`public/views/admin/ai-usage-tab.js`): folds the
  ledger + ai-usage reads. Check `src/routes/ledger.ts` (already has `aggregateUsageGroups` /
  `aggregateRunGroups` extracted this campaign) + any admin ai-usage route.
- **`AdminAgentIntegrationService`** → `public/views/admin/agent-integration-tab.js` (client
  `public/js/services/admin-agent-integration.js`, route `src/routes/admin-agent-integration.ts`): the plan
  flags it as ~4 reads. Fold them.
- **`AdminPackagesService`** → the admin packages/knowledge-review tab: reuse the existing batch primitives
  `getAppDownloadsForApps` / `countAppForksForApps` (already built + used by `apps/catalogue-admin.ts` and
  the `mcp aimeat_app_list`; grep for them) — likely NO new primitive needed, same as the Security slice.

Each composite: owner/operator-gated exactly as the folded endpoints; mirror each endpoint's `.data`
shape so the frontend seeds as a drop-in; keep the individual endpoints as fallback + interactive re-fetch.

### 3d. What NOT to fold
Keep cross-node / outbound / best-effort reads as separate requests, same boundary discipline used all
campaign: `getFederationPeers` / `getRealtime` / `getConsulStatus` (live infra), `getSiteMeta|Template|
Changelog` (portal CMS), federation peers. These belong to their own tabs and are lazy anyway once §3b
lands.

---

## 4. The proven slice pattern (followed for all ~25 done composites)

For each composite you add:
1. **Service** — `src/services/db/<name>-db-service.ts`: a small PURPOSE-SPECIFIC class (one view/tab),
   `constructor(storage[, config])`, one `overview(...)`/`state(...)` method wrapped in
   `runInReadScope(async () => { ... })` from `../../storage/uow/unit-of-work.js`. Resolve shared entities
   once; mirror each folded endpoint's exact `.data`. Export from `src/services/db/index.ts` (barrel).
2. **Composite endpoint** — in the route module that owns the domain helpers (do NOT force a services/db
   class if the helpers are route-local, e.g. the Usage/Scheduler/Ecosystem composites live in their route
   files). Gate exactly as the folded reads (operator/owner). Register BEFORE any `/:id`-style capture that
   could shadow a literal path segment.
3. **E2E BOTH backends** — add a test to the relevant registered suite (see `test/run-e2e-ci.ts` for the
   exact `--test=` names — use the EXACT basename, e.g. `--test=e2e-security`, since `--test=security`
   substring-matches other suites). Assert composite == sum-of-parts (cross-check vs the individual
   endpoints) + an auth-gate case. Run on **sqlite AND postgres-kysely** — both must be green:
   ```
   pnpm exec node --env-file=.env.test.sqlite         --import tsx test/run-e2e-ci.ts --test=<name>
   pnpm exec node --env-file=.env.test.postgres-kysely --import tsx test/run-e2e-ci.ts --test=<name>
   ```
4. **Frontend rewire** — parent/tab fetches the composite, seeds children from it; keep the individual
   loaders as fallback (`if (!composite) { …individual… }`). Preserve behavior EXACTLY (do not "fix"
   unrelated quirks in a perf slice).
5. **Rule 1b browser-verify** — restart dev, drive the tab, confirm only the composite fires on mount and
   the folded reads are gone, and the tab renders. See §6 for the operator-session recipe.

Refactors that extract shared logic (like `aggregateSchedules`, `buildOrganismList` this campaign) are
fine and encouraged — but they must be BYTE-IDENTICAL in behavior, guarded by re-running the existing suite
for that area (e.g. Organisms redaction was guarded by `e2e-organism-member-visibility` staying 9/9).

---

## 5. Verifying your own files when the tree-wide gate is poisoned

If a concurrent session's WIP breaks `pnpm lint` / `pnpm typecheck` tree-wide, verify YOUR files standalone
before committing `--no-verify`:
```
pnpm exec eslint <your changed files…>                 # must be clean
pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -i <your-files>   # no errors in YOUR files
pnpm typecheck:frontend 2>&1 | grep -i <your-files>    # no errors in YOUR files
pnpm check:importmap                                    # if you added an absolute /js|/views import
```
Frontend sibling helpers use **relative** imports (`./foo.helpers.js`) → no importmap entry needed; absolute
`/js|/views|/components` imports DO need an importmap entry in `public/spa.html`. Watch the **800-line file
limit** (`aimeat/max-file-lines`) — if a tab file overflows, extract a `*.helpers.js` sibling (relative
import). Commit message must state the `--no-verify` reason + that your files passed standalone. Prefer the
stash-dance if the peer WIP is only *unstaged* (`git stash push --keep-index --include-untracked`, commit,
`git stash pop`); if it's committed-but-broken on main, `--no-verify` is the honest path.

---

## 6. Browser verification with an operator session

The admin dashboard needs an OPERATOR session, not a plain owner. Recipe (isolated Playwright MCP):
1. Log in as `happyadmin` (creds in memory `dev-login-credentials`) via in-page fetch to `/v1/ghii/login`,
   then `localStorage.setItem('aimeat_session', JSON.stringify({ owner, jwt, ghii: owner+'@'+node, gaii: null }))`
   and reload (shape from `spa.html` handoff; see how the campaign did it).
2. **`happyadmin` must actually have the operator role** for `/v1/admin` to load — if `getDashboard`
   returns 403/OPERATOR_REQUIRED, the account isn't operator on local dev. Check `AIMEAT_OPERATOR*` /
   node config, or use whatever operator account local dev provides. If you cannot get an operator session,
   say so plainly and rely on the E2E (both backends) — do NOT claim browser-verified when you couldn't
   (this is what was done honestly for the EcosystemAutomation card).
3. Navigate to `/v1/admin`, open the DevTools/MCP network, confirm the mount fires only the lean bundle
   (not ~31 requests), then open a couple of tabs and confirm each fires its own slice once.

Restart dev after backend changes (`pnpm dev` doesn't watch `src/`): kill the listener on 40050, `pnpm dev`,
poll `/v1/build` until the build id changes.

---

## 7. Suggested slice order

1. **AdminPackages composite** (likely no new primitive — reuse `getAppDownloadsForApps` /
   `countAppForksForApps`). Smallest, proves the pattern in the admin area. E2E: `e2e-admin-features` or the
   apps/moderation suites.
2. **AdminAgentIntegration composite** (~4 reads). E2E: check `test/` for an admin-agent-integration suite.
3. **AdminUsage composite** (ledger + ai-usage). Reuse the extracted ledger aggregators.
4. **The big one — lean mount + lazy per-tab** (§3a/§3b). Do this LAST and CAREFULLY:
   - Identify the default/landing tab + exactly which `data.*` fields it + the sidebar counts need.
   - Move everything else to lazy (per-tab fetch on first open, cached).
   - Fix any count that depended on a now-lazy full list (get it from `getDashboard` counts instead).
   - This is mostly frontend; the risk is a tab that silently breaks because its `data.*` field is no
     longer eagerly present. Grep each `data.<field>` usage across `public/views/admin/*-tab.js` and make
     sure each field's tab now fetches it lazily.

Commit each slice separately (E2E green both backends + browser-verified or honestly-noted).

---

## 8. Success criteria

- Opening `/v1/admin` fires a **lean** set of requests on mount (single-digit), NOT ~31.
- Opening each admin tab fires only that tab's data, once (cached on return).
- The three admin composites exist, are E2E-green on **both** backends, and mirror their folded endpoints.
- No admin tab regresses (every `data.<field>` a tab reads is still populated — lazily).
- `pnpm lint` + `pnpm typecheck` + `pnpm typecheck:frontend` clean for your files (tree-wide once the peer
  WIP clears).
- Roadmap memory `efficiency-survey-roadmap` updated: Admin done → ~28/28.

---

## 9. Pointers / anchors

- Eager loader: `public/views/admin.js:186` (`loadAll`), effect `~:331`.
- Admin client service: `public/js/services/admin.js`; `public/js/services/admin-agent-integration.js`.
- Admin tabs: `public/views/admin/*-tab.js` (46).
- Admin routes: `src/routes/admin-*.ts`, `src/routes/admin/`.
- Composite pattern examples from this campaign: `src/services/db/*-overview-db-service.ts`,
  `src/services/db/security-tab-db-service.ts`, `src/services/db/work-tab-db-service.ts`; in-route composites
  in `src/routes/ledger.ts` (`/usage/overview`), `src/routes/schedules.ts` (`/scheduler/tab`),
  `src/routes/ecosystem-apps.ts` (`/:app/automation`), `src/routes/organisms/crud.ts` (`/organisms/tab`).
- Batch primitives already available: `getAppDownloadsForApps`, `countAppForksForApps`,
  `getAgentsByOwners`, `listConsentsForAgents`, `listMemoryForOwners`, `getMemoryByKeysAnyOwner`,
  `listStorageFilesForOwners` (grep `src/storage/repositories/*.ts`).
- CLAUDE.md Rule 1 (E2E both backends), Rule 2 (file headers — campsite), Rule 6 (Opus subagents), Rule 7
  (lint), Rule 10 (security invariants — diff the guard chain before replacing a data path).
