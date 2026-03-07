# Configurable Per-Endpoint Rate Limits — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make all rate limits configurable via env vars, database, admin dashboard, and init wizard — with per-endpoint overrides falling back to the global default.

**Architecture:** Add individual `rlOwners`, `rlGhii`, etc. fields to `AimeatConfig` so they work with the existing `applyConfigOverrides` pipeline. Build `RateLimitTier` objects from these in `loadConfig()`. Replace the opaque `rateLimits` config-schema object with 13 individual number entries. Wire `server.ts` to use config instead of hardcoded values.

**Tech Stack:** TypeScript, Express rate-limit middleware, config-schema system, Preact admin dashboard (auto-renders from schema)

---

### Task 1: Add per-endpoint fields to AimeatConfig interface

**Files:**
- Modify: `aimeat/src/config.ts:21-40` (RateLimitsConfig interface)
- Modify: `aimeat/src/config.ts:80-94` (AimeatConfig interface)

**Step 1: Extend `RateLimitsConfig` with 8 new tiers**

In `aimeat/src/config.ts`, add to the `RateLimitsConfig` interface after `boards`:

```typescript
export interface RateLimitsConfig {
  global: RateLimitTier;
  auth: RateLimitTier;
  work: RateLimitTier;
  memory: RateLimitTier;
  boards: RateLimitTier;
  roleMultipliers: RoleMultipliers;
  // Per-endpoint overrides (fall back to global when not configured)
  owners: RateLimitTier;
  ghii: RateLimitTier;
  flags: RateLimitTier;
  appeals: RateLimitTier;
  adminSetup: RateLimitTier;
  federation: RateLimitTier;
  catalogue: RateLimitTier;
  authChallenge: RateLimitTier;
}
```

**Step 2: Add individual rl* keys to AimeatConfig**

After the `rateLimits: RateLimitsConfig;` line (~94), add:

```typescript
  // Per-endpoint rate limits (individual keys for config-schema compatibility)
  rlGlobal: number;
  rlAuth: number;
  rlWork: number;
  rlMemory: number;
  rlBoards: number;
  rlOwners: number;
  rlGhii: number;
  rlFlags: number;
  rlAppeals: number;
  rlAdminSetup: number;
  rlFederation: number;
  rlCatalogue: number;
  rlAuthChallenge: number;
```

**Step 3: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: Errors about missing properties in loadConfig() — that's expected, we fix it in Task 2.

**Step 4: Commit**

```bash
git add aimeat/src/config.ts
git commit -m "feat: add per-endpoint rate limit types to AimeatConfig"
```

---

### Task 2: Wire loadConfig() to parse per-endpoint env vars

**Files:**
- Modify: `aimeat/src/config.ts:506-513` (rateLimits in loadConfig)

**Step 1: Update loadConfig() rateLimits block**

Replace the existing `rateLimits` block (~lines 506-513) with:

```typescript
    // Rate limits — parse individual values, per-endpoint falls back to global
    const rlGlobal = Math.max(1, parseInt(process.env.AIMEAT_RL_GLOBAL ?? '300', 10));
    const rlAuth = Math.max(1, parseInt(process.env.AIMEAT_RL_AUTH ?? '20', 10));
    const rlWork = Math.max(1, parseInt(process.env.AIMEAT_RL_WORK ?? '60', 10));
    const rlMemory = Math.max(1, parseInt(process.env.AIMEAT_RL_MEMORY ?? '120', 10));
    const rlBoards = Math.max(1, parseInt(process.env.AIMEAT_RL_BOARDS ?? '60', 10));
    const rlOwners = Math.max(1, parseInt(process.env.AIMEAT_RL_OWNERS ?? String(rlGlobal), 10));
    const rlGhii = Math.max(1, parseInt(process.env.AIMEAT_RL_GHII ?? String(rlGlobal), 10));
    const rlFlags = Math.max(1, parseInt(process.env.AIMEAT_RL_FLAGS ?? String(rlGlobal), 10));
    const rlAppeals = Math.max(1, parseInt(process.env.AIMEAT_RL_APPEALS ?? String(rlGlobal), 10));
    const rlAdminSetup = Math.max(1, parseInt(process.env.AIMEAT_RL_ADMIN_SETUP ?? String(rlGlobal), 10));
    const rlFederation = Math.max(1, parseInt(process.env.AIMEAT_RL_FEDERATION ?? String(rlGlobal), 10));
    const rlCatalogue = Math.max(1, parseInt(process.env.AIMEAT_RL_CATALOGUE ?? String(rlGlobal), 10));
    const rlAuthChallenge = Math.max(1, parseInt(process.env.AIMEAT_RL_AUTH_CHALLENGE ?? String(rlGlobal), 10));
```

Then build the config object with both individual keys and the composed rateLimits:

```typescript
    // Individual rl* keys (for config-schema persistence)
    rlGlobal,
    rlAuth,
    rlWork,
    rlMemory,
    rlBoards,
    rlOwners,
    rlGhii,
    rlFlags,
    rlAppeals,
    rlAdminSetup,
    rlFederation,
    rlCatalogue,
    rlAuthChallenge,

    rateLimits: {
      global: { windowMs: 1_000, max: rlGlobal },
      auth: { windowMs: 1_000, max: rlAuth },
      work: { windowMs: 1_000, max: rlWork },
      memory: { windowMs: 1_000, max: rlMemory },
      boards: { windowMs: 1_000, max: rlBoards },
      owners: { windowMs: 1_000, max: rlOwners },
      ghii: { windowMs: 1_000, max: rlGhii },
      flags: { windowMs: 1_000, max: rlFlags },
      appeals: { windowMs: 1_000, max: rlAppeals },
      adminSetup: { windowMs: 1_000, max: rlAdminSetup },
      federation: { windowMs: 1_000, max: rlFederation },
      catalogue: { windowMs: 1_000, max: rlCatalogue },
      authChallenge: { windowMs: 1_000, max: rlAuthChallenge },
      roleMultipliers: { operator: 10, owner: 2, agent: 1, anonymous: 0.5 },
    },
```

**Step 2: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS (or minor errors in test mocks needing the new fields — fix if so)

**Step 3: Commit**

```bash
git add aimeat/src/config.ts
git commit -m "feat: parse per-endpoint rate limit env vars with global fallback"
```

---

### Task 3: Replace opaque rateLimits config-schema with individual fields

**Files:**
- Modify: `aimeat/src/services/config-schema.ts:83-84`

**Step 1: Replace the single rateLimits object entry**

Remove line 84:
```typescript
  { key: 'rateLimits', dotPath: 'rate_limits', envVar: 'AIMEAT_RATE_LIMITS', type: 'object', validate: v => typeof v === 'object' && v !== null, immutable: false, description: 'Rate limiting configuration per endpoint category' },
```

Replace with 13 individual entries. Validation: `v >= 1`. All mutable.

```typescript
  // ── Rate Limits (mutable, per-endpoint with global fallback) ──
  { key: 'rlGlobal', dotPath: 'rate_limits.global', envVar: 'AIMEAT_RL_GLOBAL', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Global rate limit (requests/second)', range: '1-10000' },
  { key: 'rlAuth', dotPath: 'rate_limits.auth', envVar: 'AIMEAT_RL_AUTH', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Auth endpoint rate limit (req/s)', range: '1-10000' },
  { key: 'rlWork', dotPath: 'rate_limits.work', envVar: 'AIMEAT_RL_WORK', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Work queue rate limit (req/s)', range: '1-10000' },
  { key: 'rlMemory', dotPath: 'rate_limits.memory', envVar: 'AIMEAT_RL_MEMORY', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Memory read/write rate limit (req/s)', range: '1-10000' },
  { key: 'rlBoards', dotPath: 'rate_limits.boards', envVar: 'AIMEAT_RL_BOARDS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Board endpoint rate limit (req/s)', range: '1-10000' },
  { key: 'rlOwners', dotPath: 'rate_limits.owners', envVar: 'AIMEAT_RL_OWNERS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Owner endpoint rate limit (req/s, default: global)', range: '1-10000' },
  { key: 'rlGhii', dotPath: 'rate_limits.ghii', envVar: 'AIMEAT_RL_GHII', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Identity (GHII) rate limit (req/s, default: global)', range: '1-10000' },
  { key: 'rlFlags', dotPath: 'rate_limits.flags', envVar: 'AIMEAT_RL_FLAGS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Content flagging rate limit (req/s, default: global)', range: '1-10000' },
  { key: 'rlAppeals', dotPath: 'rate_limits.appeals', envVar: 'AIMEAT_RL_APPEALS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Flag appeals rate limit (req/s, default: global)', range: '1-10000' },
  { key: 'rlAdminSetup', dotPath: 'rate_limits.admin_setup', envVar: 'AIMEAT_RL_ADMIN_SETUP', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Admin setup rate limit (req/s, default: global)', range: '1-10000' },
  { key: 'rlFederation', dotPath: 'rate_limits.federation', envVar: 'AIMEAT_RL_FEDERATION', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Federation peering rate limit (req/s, default: global)', range: '1-10000' },
  { key: 'rlCatalogue', dotPath: 'rate_limits.catalogue', envVar: 'AIMEAT_RL_CATALOGUE', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Catalogue search rate limit (req/s, default: global)', range: '1-10000' },
  { key: 'rlAuthChallenge', dotPath: 'rate_limits.auth_challenge', envVar: 'AIMEAT_RL_AUTH_CHALLENGE', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Auth challenge rate limit (req/s, default: global)', range: '1-10000' },
```

**Step 2: Handle applyConfigOverrides for rl* keys**

The `applyConfigOverrides` function in `config.ts:528` does `(config as any)[field.key] = value`. For `rlOwners` etc. this sets `config.rlOwners` but does NOT update `config.rateLimits.owners.max`.

Add a sync step after the override loop (after line 557 in `config.ts`):

```typescript
  // Sync rl* individual keys back to rateLimits tiers
  const rlKeys: Array<{ key: keyof AimeatConfig; tier: keyof RateLimitsConfig }> = [
    { key: 'rlGlobal', tier: 'global' },
    { key: 'rlAuth', tier: 'auth' },
    { key: 'rlWork', tier: 'work' },
    { key: 'rlMemory', tier: 'memory' },
    { key: 'rlBoards', tier: 'boards' },
    { key: 'rlOwners', tier: 'owners' },
    { key: 'rlGhii', tier: 'ghii' },
    { key: 'rlFlags', tier: 'flags' },
    { key: 'rlAppeals', tier: 'appeals' },
    { key: 'rlAdminSetup', tier: 'adminSetup' },
    { key: 'rlFederation', tier: 'federation' },
    { key: 'rlCatalogue', tier: 'catalogue' },
    { key: 'rlAuthChallenge', tier: 'authChallenge' },
  ];
  for (const { key, tier } of rlKeys) {
    const val = config[key] as number;
    if (typeof val === 'number' && val >= 1) {
      (config.rateLimits[tier] as RateLimitTier).max = val;
    }
  }
```

Import `RateLimitTier` and `RateLimitsConfig` at the top of config.ts if not already available (they're defined in the same file, so should be fine).

**Step 3: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add aimeat/src/services/config-schema.ts aimeat/src/config.ts
git commit -m "feat: replace opaque rateLimits config-schema with 13 individual fields"
```

---

### Task 4: Wire server.ts per-endpoint limits to config

**Files:**
- Modify: `aimeat/src/server.ts:261-269`

**Step 1: Replace hardcoded limits with config references**

Replace the current block:
```typescript
  // Per-endpoint rate limits (300/s — matching global default)
  app.use('/v1/auth/challenge', rateLimit({ windowMs: 1_000, max: 300 }));
  app.use('/v1/owners', rateLimit({ windowMs: 1_000, max: 300 }));
  app.use('/v1/ghii', rateLimit({ windowMs: 1_000, max: 300 }));
  app.use('/v1/flags', rateLimit({ windowMs: 1_000, max: 300 }));
  app.use('/v1/appeals', rateLimit({ windowMs: 1_000, max: 300 }));
  app.use('/v1/admin/setup', rateLimit({ windowMs: 1_000, max: 300 }));
  app.use('/v1/federation/peer/introduce', rateLimit({ windowMs: 1_000, max: 300 }));
  app.use('/v1/catalogue', rateLimit({ windowMs: 1_000, max: 300 }));
```

With:
```typescript
  // Per-endpoint rate limits (configurable, fall back to global)
  app.use('/v1/auth/challenge', rateLimit(config.rateLimits.authChallenge, config.rateLimits.roleMultipliers));
  app.use('/v1/owners', rateLimit(config.rateLimits.owners, config.rateLimits.roleMultipliers));
  app.use('/v1/ghii', rateLimit(config.rateLimits.ghii, config.rateLimits.roleMultipliers));
  app.use('/v1/flags', rateLimit(config.rateLimits.flags, config.rateLimits.roleMultipliers));
  app.use('/v1/appeals', rateLimit(config.rateLimits.appeals, config.rateLimits.roleMultipliers));
  app.use('/v1/admin/setup', rateLimit(config.rateLimits.adminSetup, config.rateLimits.roleMultipliers));
  app.use('/v1/federation/peer/introduce', rateLimit(config.rateLimits.federation, config.rateLimits.roleMultipliers));
  app.use('/v1/catalogue', rateLimit(config.rateLimits.catalogue, config.rateLimits.roleMultipliers));
```

**Step 2: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add aimeat/src/server.ts
git commit -m "feat: wire per-endpoint rate limits to config system"
```

---

### Task 5: Update env-config.ts CLI display

**Files:**
- Modify: `aimeat/src/utils/env-config.ts:350-384`

**Step 1: Add per-endpoint entries to the Rate Limits section**

After the existing 5 entries (ending with `AIMEAT_RL_BOARDS` at ~line 382), add:

```typescript
        {
          envVar: 'AIMEAT_RL_OWNERS',
          description: 'Owner endpoint rate limit (default: global)',
          value: String(config.rateLimits.owners.max),
          defaultVal: String(config.rateLimits.global.max),
        },
        {
          envVar: 'AIMEAT_RL_GHII',
          description: 'Identity (GHII) rate limit (default: global)',
          value: String(config.rateLimits.ghii.max),
          defaultVal: String(config.rateLimits.global.max),
        },
        {
          envVar: 'AIMEAT_RL_FLAGS',
          description: 'Content flagging rate limit (default: global)',
          value: String(config.rateLimits.flags.max),
          defaultVal: String(config.rateLimits.global.max),
        },
        {
          envVar: 'AIMEAT_RL_APPEALS',
          description: 'Flag appeals rate limit (default: global)',
          value: String(config.rateLimits.appeals.max),
          defaultVal: String(config.rateLimits.global.max),
        },
        {
          envVar: 'AIMEAT_RL_ADMIN_SETUP',
          description: 'Admin setup rate limit (default: global)',
          value: String(config.rateLimits.adminSetup.max),
          defaultVal: String(config.rateLimits.global.max),
        },
        {
          envVar: 'AIMEAT_RL_FEDERATION',
          description: 'Federation peering rate limit (default: global)',
          value: String(config.rateLimits.federation.max),
          defaultVal: String(config.rateLimits.global.max),
        },
        {
          envVar: 'AIMEAT_RL_CATALOGUE',
          description: 'Catalogue search rate limit (default: global)',
          value: String(config.rateLimits.catalogue.max),
          defaultVal: String(config.rateLimits.global.max),
        },
        {
          envVar: 'AIMEAT_RL_AUTH_CHALLENGE',
          description: 'Auth challenge rate limit (default: global)',
          value: String(config.rateLimits.authChallenge.max),
          defaultVal: String(config.rateLimits.global.max),
        },
```

**Step 2: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add aimeat/src/utils/env-config.ts
git commit -m "feat: display per-endpoint rate limits in aimeat config CLI"
```

---

### Task 6: Add global rate limit to init wizard

**Files:**
- Modify: `aimeat/src/cli/init-wizard.ts` (~after line 1135, after maxRelayHops)
- Modify: `aimeat/locales/en.json` (~after line 950)
- Modify: `aimeat/locales/fi.json` (matching location)

**Step 1: Add i18n keys to en.json**

In the `"init"` section, after `"maxRelayHops"`:

```json
    "rateLimitGlobal": "Global rate limit (requests/second)",
    "rateLimitGlobalHint": "Applies to all endpoints unless overridden per-endpoint in admin dashboard",
```

**Step 2: Add Finnish translations to fi.json**

```json
    "rateLimitGlobal": "Yleinen pyyntoraja (pyyntoa/sekunti)",
    "rateLimitGlobalHint": "Koskee kaikkia paatepisteitä ellei ylikirjoiteta hallintapaneelissa",
```

**Step 3: Add prompt to init-wizard.ts**

After the `relayHops` block (~line 1135), before the `// -- Consent Layer --` comment:

```typescript
  const rateLimitGlobal = checkCancel(
    await p.text({
      message: t('init.rateLimitGlobal'),
      defaultValue: String(cfg.rlGlobal),
      validate: val => {
        const n = parseInt(val, 10);
        if (isNaN(n) || n < 1) return t('init.numInvalid');
      },
    }),
    t,
  );
  if (rateLimitGlobal !== '300') settings.AIMEAT_RL_GLOBAL = rateLimitGlobal;
```

**Step 4: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add aimeat/src/cli/init-wizard.ts aimeat/locales/en.json aimeat/locales/fi.json
git commit -m "feat: add global rate limit setting to aimeat init wizard"
```

---

### Task 7: Update .env.example with new env vars

**Files:**
- Modify: `aimeat/.env.example:85-90`

**Step 1: Expand the Rate Limits section**

Replace existing rate limits block with:

```
# ── Rate Limits (requests per second) ─────────────────────────
# Global default — all endpoints inherit this unless overridden
# AIMEAT_RL_GLOBAL=300
#
# Per-tier limits (applied to route groups)
# AIMEAT_RL_AUTH=20
# AIMEAT_RL_WORK=60
# AIMEAT_RL_MEMORY=120
# AIMEAT_RL_BOARDS=60
#
# Per-endpoint overrides (optional — defaults to global if not set)
# AIMEAT_RL_OWNERS=300
# AIMEAT_RL_GHII=300
# AIMEAT_RL_FLAGS=300
# AIMEAT_RL_APPEALS=300
# AIMEAT_RL_ADMIN_SETUP=300
# AIMEAT_RL_FEDERATION=300
# AIMEAT_RL_CATALOGUE=300
# AIMEAT_RL_AUTH_CHALLENGE=300
```

**Step 2: Commit**

```bash
git add aimeat/.env.example
git commit -m "docs: document per-endpoint rate limit env vars in .env.example"
```

---

### Task 8: Fix test mocks and verify build

**Files:**
- Modify: `aimeat/src/middleware/__tests__/cookie-consent.test.ts:110-115` (if it has rateLimits mock)
- Any other test files with hardcoded rateLimits mocks

**Step 1: Search for test files that mock rateLimits**

Run: `cd aimeat && grep -r "rateLimits" --include="*.ts" test/ src/**/__tests__/ | grep -v node_modules`

**Step 2: Update each mock to include the new tiers**

Add the missing fields to any mock config objects:

```typescript
rateLimits: {
  global: { windowMs: 1000, max: 300 },
  auth: { windowMs: 1000, max: 20 },
  work: { windowMs: 1000, max: 60 },
  memory: { windowMs: 1000, max: 120 },
  boards: { windowMs: 1000, max: 60 },
  owners: { windowMs: 1000, max: 300 },
  ghii: { windowMs: 1000, max: 300 },
  flags: { windowMs: 1000, max: 300 },
  appeals: { windowMs: 1000, max: 300 },
  adminSetup: { windowMs: 1000, max: 300 },
  federation: { windowMs: 1000, max: 300 },
  catalogue: { windowMs: 1000, max: 300 },
  authChallenge: { windowMs: 1000, max: 300 },
  roleMultipliers: { operator: 10, owner: 2, agent: 1, anonymous: 0.5 },
},
```

Also add the individual `rl*` keys to mock configs:

```typescript
rlGlobal: 300, rlAuth: 20, rlWork: 60, rlMemory: 120, rlBoards: 60,
rlOwners: 300, rlGhii: 300, rlFlags: 300, rlAppeals: 300,
rlAdminSetup: 300, rlFederation: 300, rlCatalogue: 300, rlAuthChallenge: 300,
```

**Step 3: Run full type check and build**

Run: `cd aimeat && npx tsc --noEmit && pnpm build`
Expected: PASS with no errors

**Step 4: Commit**

```bash
git add -A
git commit -m "fix: update test mocks for per-endpoint rate limit config fields"
```

---

### Task 9: Manual verification

**Step 1: Start dev server**

Run: `cd aimeat && pnpm dev`

**Step 2: Verify admin dashboard shows rate limits**

Navigate to admin dashboard > Config tab. Verify all 13 rate limit fields appear under "Rate limits" group, each with correct current value and editable.

**Step 3: Verify aimeat config CLI**

Run: `cd aimeat && node dist/src/index.js config` (or `pnpm start -- config`)

Verify all 13 rate limit values display in the "Rate Limits" section.

**Step 4: Verify env var override works**

Run: `AIMEAT_RL_OWNERS=50 pnpm dev`

Check that `/v1/owners` endpoint uses 50 req/s limit (visible in config output or admin dashboard).
