# Subtype Damage Mitigation Plan

## Problem

`subtype` (data/component/app-domain) for cortex components was never stored in component records. It was only in the blueprint. This caused 23+ lookups to return `undefined`, breaking:

- Spec generation (can't find data cortex)
- Code generation (missing data cortex API)
- Test routing (wrong test prompt)
- Test page script ordering (wrong dependency order)
- UI spec validation (wrong validator)
- Resolver context building (empty data cortex info)

Current state: 3 enrichment fallbacks in autopilot, 1 in UI API route. These silently patch the data with ZERO logging. New code that reads subtype will silently break for old projects.

## Principle

**Each phase's prompts and processes are LOCKED once working. New phases must not modify shared code that affects working phases.**

## Fix Steps

### Step 1: Add loud warning when enrichment fallback fires

Every enrichment point must log a visible warning so we know when subtype is missing from stored records. This is our canary.

**Files:** `generator-autopilot.ts` (3 places), `generator.ts` (1 place)

### Step 2: Make loadComponents auto-enrich from blueprint

Instead of enriching at every call site, enrich ONCE inside `loadComponents()` itself. The blueprint is available in the autopilot closure. This eliminates the need for per-call-site enrichment and prevents future code from forgetting to enrich.

**File:** `generator-autopilot.ts` — move enrichment into `loadComponents()`

### Step 3: Fix test page script ordering

The test page route reads `val.subtype` from stored components for cortex script ordering. It does NOT have the enrichment fallback. Add it, with loud warning.

**File:** `generator.ts` — test page route (lines 686-694 and 711-720)

### Step 4: Verify foundry has same fix

Foundry (the other generator system) reads subtype in the same way. Check if it's affected too.

**File:** `foundry.ts` — lines 646-653, 666-675

### Step 5: Add subtype to component initialization in foundry-tab too

Same as generator-tab.js fix — foundry-tab.js also initializes components from blueprints.

**File:** `public/views/profile/foundry-tab.js`

### Step 6: Document the rule

Add to CLAUDE.md: "subtype MUST be stored on component records at initialization. It comes from blueprint.components[].subtype. Enrichment fallbacks exist but must log warnings. New phases must never modify code that affects working phases."

## Verification

- `pnpm typecheck` passes
- Existing tests pass
- Terminal shows warning when enrichment fires on old projects
- New projects store subtype from the start
- Extension pipeline unaffected (no subtype usage)
