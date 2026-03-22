# Generator Extension Test Failure — Root Cause Analysis V3

> **Date:** 2026-03-22
> **Subject:** Extension uses `ctx.getCompany()` — actions calling other actions
> **Status:** Root cause found, generic fix proposed
> **Previous:** v1 (wrong response field), v2 (response envelope fix — worked)

---

## 1. What Worked

The `responseEnvelope` fix from v2 worked perfectly:
- Interview now captures `responseEnvelope: { "totalResults": "number", "companies": "array" }`
- Extension prompt shows it with warning: "Use EXACT field names, do NOT guess"
- All generated code uses `data.companies` instead of `data.results`

## 2. New Bug: `ctx.getCompany is not a function`

```
Extension action failed: prh-tiedonhaku-ja-seurantatarkistus/addToWatchlist
  {"error":"ctx.getCompany is not a function"}
```

The LLM generated `addToWatchlist` like this:

```javascript
// addToWatchlist tries to reuse getCompany action
const companyData = await ctx.getCompany({ businessId: businessId });
```

`getCompany` is another action in the same extension — NOT a `ctx` API method. In the V8 sandbox, `ctx` provides `memory`, `fetch`, `wallet`, `consent`, `trust`, `caller`, `config`, `log`. There is no way for one action to call another action via `ctx`.

The `getCompany` action itself works correctly — it uses `ctx.fetch()` to call the PRH API and `ctx.memory` to cache results. But `addToWatchlist` tries to call it as `ctx.getCompany()` instead of duplicating the fetch logic.

## 3. Why This Happens

The LLM sees that the blueprint has both `getCompany` and `addToWatchlist` as required actions. It correctly understands that `addToWatchlist` needs company data. Instead of duplicating the fetch code, it assumes the extension framework provides a way to call sibling actions. This is a reasonable assumption for most extension systems (many have inter-action calls), but AIMEAT's V8 sandbox does not support this.

The extension prompt's AIMEAT_CONTEXT section lists all `ctx.*` methods, but it doesn't **explicitly say** that actions cannot call each other. The LLM treats this as an undocumented feature rather than an impossibility.

## 4. The Fix: Explicit Rule in Extension Prompt

Add a prominent rule to the extension prompt template (`COMPONENT_TEMPLATES.extension` in `generator-prompts-base.js`):

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║  CRITICAL: Actions are INDEPENDENT. Each action is a separate function.     ║
║  Actions CANNOT call other actions. There is NO ctx.otherAction() method.   ║
║  If two actions need the same logic (e.g., fetching from an API), either:   ║
║  (a) Duplicate the shared code inline in each action, or                    ║
║  (b) Define a helper function ABOVE the action exports and call it.         ║
║  ctx ONLY has: memory, fetch, wallet, consent, trust, caller, config, log.  ║
║  NEVER write ctx.actionName() — it will crash with "not a function" error.  ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

This is a **generic fix** — it prevents any extension from trying inter-action calls regardless of the API being used.

### Where to add it

In `generator-prompts-base.js`, inside `COMPONENT_TEMPLATES.extension`, right after the existing sandbox API documentation. The box format matches the existing `ctx.memory.getPublic()` warning box in `AIMEAT_CONTEXT`.

### Why a box warning

The LLM already has a list of `ctx.*` methods. A flat rule like "actions cannot call each other" would get lost. The box format with the specific error message ("not a function") gives the LLM a pattern to match against — if it's about to write `ctx.getCompany()`, the prominent warning should trigger recall.

## 5. Secondary Improvement: Helper Function Pattern

The prompt should also show the correct pattern — a helper function that multiple actions can share:

```javascript
// ✅ CORRECT — shared helper function above action exports
async function fetchCompanyFromApi(ctx, businessId) {
  const resp = await ctx.fetch('https://api.example.com/companies?id=' + businessId);
  if (!resp.ok) return null;
  const data = JSON.parse(resp.text);
  return data.companies?.[0] || null;
}

// actions/getCompany.js
export default async function(ctx, input) {
  const company = await fetchCompanyFromApi(ctx, input.businessId);
  // ...
}

// actions/addToWatchlist.js
export default async function(ctx, input) {
  const company = await fetchCompanyFromApi(ctx, input.businessId);
  // ...
}
```

This shows the LLM the correct architecture: shared logic lives in plain helper functions, not in `ctx`.
