# EUDIW & FTN Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the EUDIW/FTN integration gaps with real SD-JWT verification, OIDC client for FTN, signed VCs, DID Document serving, nonce storage, and E2E tests.

**Architecture:** Shared infrastructure first (nonce storage, config, dependencies), then two independent streams (EUDIW SD-JWT verification + FTN OIDC client), then VC signing + DID Document, then E2E tests tying everything together. ~85% additive new files, ~15% surgical replacement in 3 existing service/route files.

**Tech Stack:** Node.js 24, TypeScript 5.9, Express 5, `jose` 6.1 (VC signing), `@sd-jwt/decode` + `@sd-jwt/verify` (EUDIW verification), `openid-client` v6 (FTN OIDC), SQLite + MongoDB/Prisma storage backends.

**Design spec:** `docs/superpowers/specs/2026-05-02-eudiw-ftn-integration-design.md`

---

## File Map

### New files

| File | Responsibility |
|------|---------------|
| `src/services/sd-jwt.ts` | SD-JWT decode + cryptographic signature verification |
| `src/services/oidc-client.ts` | Generic OIDC RP wrapper (FTN broker communication) |
| `src/services/did-document.ts` | DID Document generation for `did:web` |
| `test/unit/nonce-storage.test.ts` | Nonce CRUD + expiry unit tests |
| `test/unit/sd-jwt.test.ts` | SD-JWT decode/verify unit tests |
| `test/unit/oidc-client.test.ts` | OIDC client unit tests |
| `test/unit/did-document.test.ts` | DID Document structure unit tests |
| `test/unit/vc-issuer-signed.test.ts` | VC JWT signing unit tests |
| `test/helpers/test-sd-jwt.ts` | Test helper: create signed SD-JWTs with known keys |
| `test/helpers/mock-oidc-broker.ts` | Test helper: minimal OIDC provider on random port |
| `test/e2e-verification.ts` | Full E2E verification test suite (9 phases) |

### Modified files

| File | What changes |
|------|-------------|
| `src/storage/interface.ts` | Add `VerificationNonceRecord` type (after `TrustedIssuerRecord`) |
| `src/storage/repositories/node.repository.ts` | Add 4 nonce methods to `NodeRepository` (or new `VerificationRepository`) |
| `src/storage/providers/sqlite/schema.ts` | Add `verification_nonces` CREATE TABLE (after `trusted_issuers`) |
| `src/storage/providers/sqlite/index.ts` | Implement 4 nonce methods |
| `prisma/schema.prisma` | Add `VerificationNonce` model (after `TrustedIssuer`) |
| `src/storage/providers/mongodb/index.ts` | Implement 4 nonce methods |
| `src/config.ts` | Add 4 new fields to `AimeatConfig` interface + `loadConfig()` |
| `src/services/config-schema.ts` | Register 4 new config fields |
| `.env.example` | Add 4 new env vars |
| `src/services/job-seeding.ts` | Add `core:nonce-cleanup` job |
| `src/services/core-jobs.ts` | Register `nonce-cleanup` handler |
| `src/services/eudiw.ts` | Rewrite `verifyPresentation()` to use `SdJwtVerifier` |
| `src/routes/verification.ts` | Add nonce validation to EUDIW endpoints, add FTN authorize/callback routes |
| `src/server-bootstrap/routes-loader.ts` | Wire new services (SdJwtVerifier, OidcClient, DidDocumentService) |
| `src/services/vc-issuer.ts` | Add `issueSignedCredential()`, `getIssuerDid()`, `getPublicJwk()` |
| `openapi.yaml` | Add 2 new FTN endpoints |
| `test/unit/eudiw-verifier.test.ts` | Update to use real SD-JWT tokens |

---

## Task 1: Install Dependencies

**Files:**
- Modify: `aimeat/package.json`

- [ ] **Step 1: Install SD-JWT packages**

```bash
cd aimeat && pnpm add @sd-jwt/decode @sd-jwt/verify
```

- [ ] **Step 2: Install OIDC client**

```bash
cd aimeat && pnpm add openid-client
```

- [ ] **Step 3: Verify licenses and audit**

```bash
cd aimeat && pnpm audit
```

Expected: No high/critical vulnerabilities. `@sd-jwt/decode` is Apache-2.0, `@sd-jwt/verify` is Apache-2.0, `openid-client` is MIT.

- [ ] **Step 4: Verify TypeScript can resolve the new packages**

```bash
cd aimeat && npx tsc --noEmit 2>&1 | head -5
```

Expected: Same output as before (no new errors from the added packages).

- [ ] **Step 5: Commit**

```bash
git add aimeat/package.json aimeat/pnpm-lock.yaml
git commit -m "feat(eudiw): add @sd-jwt/decode, @sd-jwt/verify, openid-client dependencies"
```

---

## Task 2: Add Config Fields

**Files:**
- Modify: `aimeat/src/config.ts:199-205` (interface) and `aimeat/src/config.ts:528-533` (loadConfig)
- Modify: `aimeat/src/services/config-schema.ts:160-162` and `aimeat/src/services/config-schema.ts:253-257`
- Modify: `aimeat/.env.example:174-180`

- [ ] **Step 1: Add fields to AimeatConfig interface**

In `aimeat/src/config.ts`, after the existing `vcIssuerDid: string;` line (line 205), the section currently reads:

```typescript
  // EUDIW / Identity Verification (Phase 3.3)
  eudiwEnabled: boolean;
  eudiwClientId: string;
  eudiwRedirectUri: string;
  ftnEnabled: boolean;
  ftnProviderUrl: string;
  vcIssuerDid: string;
```

Replace with:

```typescript
  // EUDIW / Identity Verification (Phase 3.3)
  eudiwEnabled: boolean;
  eudiwClientId: string;
  eudiwRedirectUri: string;
  ftnEnabled: boolean;
  ftnProviderUrl: string;
  ftnClientId: string;
  ftnClientSecret: string;
  vcIssuerDid: string;
  nonceTtlSeconds: number;
  nationalEidPidClaim: string;
```

- [ ] **Step 2: Parse new fields in loadConfig()**

In `aimeat/src/config.ts`, after the existing `vcIssuerDid` parsing (line 533), the section currently reads:

```typescript
    eudiwEnabled: process.env.AIMEAT_EUDIW_ENABLED === 'true',
    eudiwClientId: process.env.AIMEAT_EUDIW_CLIENT_ID ?? 'aimeat-verifier-001',
    eudiwRedirectUri: process.env.AIMEAT_EUDIW_REDIRECT_URI ?? '',
    ftnEnabled: process.env.AIMEAT_FTN_ENABLED === 'true',
    ftnProviderUrl: process.env.AIMEAT_FTN_PROVIDER_URL ?? 'https://tunnistautuminen.suomi.fi',
    vcIssuerDid: process.env.AIMEAT_VC_ISSUER_DID ?? '',
```

Replace with:

```typescript
    eudiwEnabled: process.env.AIMEAT_EUDIW_ENABLED === 'true',
    eudiwClientId: process.env.AIMEAT_EUDIW_CLIENT_ID ?? 'aimeat-verifier-001',
    eudiwRedirectUri: process.env.AIMEAT_EUDIW_REDIRECT_URI ?? '',
    ftnEnabled: process.env.AIMEAT_FTN_ENABLED === 'true',
    ftnProviderUrl: process.env.AIMEAT_FTN_PROVIDER_URL ?? 'https://tunnistautuminen.suomi.fi',
    ftnClientId: process.env.AIMEAT_FTN_CLIENT_ID ?? '',
    ftnClientSecret: process.env.AIMEAT_FTN_CLIENT_SECRET ?? '',
    vcIssuerDid: process.env.AIMEAT_VC_ISSUER_DID ?? '',
    nonceTtlSeconds: parseInt(process.env.AIMEAT_NONCE_TTL_SECONDS ?? '300', 10),
    nationalEidPidClaim: process.env.AIMEAT_NATIONAL_EID_PID_CLAIM ?? 'personal_identity_code',
```

- [ ] **Step 3: Register new fields in config-schema**

In `aimeat/src/services/config-schema.ts`, after the existing EUDIW/Identity mutable section (line 257 area), add:

```typescript
  { key: 'ftnClientId', dotPath: 'eudiw.ftn_client_id', envVar: 'AIMEAT_FTN_CLIENT_ID', type: 'string', validate: () => true, immutable: false, description: 'FTN broker OIDC client ID' },
  { key: 'ftnClientSecret', dotPath: 'eudiw.ftn_client_secret', envVar: 'AIMEAT_FTN_CLIENT_SECRET', type: 'string', validate: () => true, immutable: true, description: 'FTN broker OIDC client secret (secret)', adminDisplay: 'hidden' },
  { key: 'nonceTtlSeconds', dotPath: 'eudiw.nonce_ttl_seconds', envVar: 'AIMEAT_NONCE_TTL_SECONDS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 60 && (v as number) <= 3600, immutable: false, description: 'Verification nonce TTL in seconds', range: '60-3600' },
  { key: 'nationalEidPidClaim', dotPath: 'eudiw.national_eid_pid_claim', envVar: 'AIMEAT_NATIONAL_EID_PID_CLAIM', type: 'string', validate: v => typeof v === 'string' && (v as string).length > 0, immutable: false, description: 'National eID PID claim name (e.g., personal_identity_code)' },
```

- [ ] **Step 4: Update .env.example**

In `aimeat/.env.example`, replace the EUDIW section (lines 174-180):

```bash
# ── EUDIW / Identity Verification (Phase 3.3) ────────────────
# AIMEAT_EUDIW_ENABLED=false
# AIMEAT_EUDIW_CLIENT_ID="aimeat-verifier-001"
# AIMEAT_EUDIW_REDIRECT_URI="https://your-node.example/v1/ghii/verify/eudiw/callback"
# AIMEAT_FTN_ENABLED=false
# AIMEAT_FTN_PROVIDER_URL="https://tunnistautuminen.suomi.fi"
# AIMEAT_FTN_CLIENT_ID=""                                      # OIDC client_id from FTN broker
# AIMEAT_FTN_CLIENT_SECRET=""                                  # OIDC client_secret from FTN broker
# AIMEAT_VC_ISSUER_DID="did:web:your-node.example"
# AIMEAT_NONCE_TTL_SECONDS=300                                 # verification nonce TTL (60-3600)
# AIMEAT_NATIONAL_EID_PID_CLAIM="personal_identity_code"       # FI: personal_identity_code, SE: personalNumber, DK: dk.cpr
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd aimeat && npx tsc --noEmit
```

Expected: Clean (0 errors).

- [ ] **Step 6: Commit**

```bash
git add aimeat/src/config.ts aimeat/src/services/config-schema.ts aimeat/.env.example
git commit -m "feat(eudiw): add FTN client, nonce TTL, and national eID PID claim config fields"
```

---

## Task 3: Nonce Storage -- Interface and Types

**Files:**
- Modify: `aimeat/src/storage/interface.ts:695` (after TrustedIssuerRecord)
- Modify: `aimeat/src/storage/repositories/node.repository.ts`

- [ ] **Step 1: Add VerificationNonceRecord type to interface.ts**

In `aimeat/src/storage/interface.ts`, after the `TrustedIssuerRecord` interface (after line 695), add:

```typescript
// Phase 3.3 — Verification Nonces (EUDIW/FTN state tracking)
export interface VerificationNonceRecord {
  id: string;
  owner: string;
  type: 'eudiw' | 'ftn';
  state: string;
  nonce: string;
  redirectUri: string;
  createdAt: string;
  expiresAt: string;
}
```

- [ ] **Step 2: Add nonce methods to NodeRepository**

In `aimeat/src/storage/repositories/node.repository.ts`, add the import for `VerificationNonceRecord` and 4 new methods after the `deleteTrustedIssuer` line:

Add `VerificationNonceRecord` to the import from `'../interface.js'`.

Add these 4 methods inside the `NodeRepository` interface, after `deleteTrustedIssuer`:

```typescript
  createVerificationNonce(record: VerificationNonceRecord): Promise<VerificationNonceRecord>;
  getVerificationNonce(state: string): Promise<VerificationNonceRecord | null>;
  deleteVerificationNonce(state: string): Promise<void>;
  cleanExpiredNonces(): Promise<number>;
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd aimeat && npx tsc --noEmit
```

Expected: Errors in SQLite and MongoDB providers (methods not yet implemented). That's correct at this stage -- we'll implement them next.

- [ ] **Step 4: Commit**

```bash
git add aimeat/src/storage/interface.ts aimeat/src/storage/repositories/node.repository.ts
git commit -m "feat(eudiw): add VerificationNonceRecord type and repository interface"
```

---

## Task 4: Nonce Storage -- SQLite Implementation

**Files:**
- Modify: `aimeat/src/storage/providers/sqlite/schema.ts:529` (after trusted_issuers table)
- Modify: `aimeat/src/storage/providers/sqlite/index.ts` (after trusted issuer methods, ~line 3079)

- [ ] **Step 1: Add verification_nonces table to SQLite schema**

In `aimeat/src/storage/providers/sqlite/schema.ts`, after the `trusted_issuers` CREATE TABLE block (after line 529), add:

```sql
    -- ── Verification Nonces ──
    CREATE TABLE IF NOT EXISTS verification_nonces (
      id             TEXT PRIMARY KEY,
      owner          TEXT NOT NULL,
      type           TEXT NOT NULL,
      state          TEXT NOT NULL UNIQUE,
      nonce          TEXT NOT NULL,
      redirectUri    TEXT NOT NULL DEFAULT '',
      createdAt      TEXT NOT NULL,
      expiresAt      TEXT NOT NULL
    );
```

- [ ] **Step 2: Implement nonce methods in SQLite provider**

In `aimeat/src/storage/providers/sqlite/index.ts`, after the trusted issuer methods (after `deleteTrustedIssuer`), add:

```typescript
  // ── Verification Nonces ──

  async createVerificationNonce(record: VerificationNonceRecord): Promise<VerificationNonceRecord> {
    this.db.prepare(
      'INSERT INTO verification_nonces (id, owner, type, state, nonce, redirectUri, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(record.id, record.owner, record.type, record.state, record.nonce, record.redirectUri ?? '', record.createdAt, record.expiresAt);
    return record;
  }

  async getVerificationNonce(state: string): Promise<VerificationNonceRecord | null> {
    const row = this.db.prepare('SELECT * FROM verification_nonces WHERE state = ?').get(state) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      owner: row.owner as string,
      type: row.type as 'eudiw' | 'ftn',
      state: row.state as string,
      nonce: row.nonce as string,
      redirectUri: row.redirectUri as string,
      createdAt: row.createdAt as string,
      expiresAt: row.expiresAt as string,
    };
  }

  async deleteVerificationNonce(state: string): Promise<void> {
    this.db.prepare('DELETE FROM verification_nonces WHERE state = ?').run(state);
  }

  async cleanExpiredNonces(): Promise<number> {
    const now = new Date().toISOString();
    const result = this.db.prepare('DELETE FROM verification_nonces WHERE expiresAt < ?').run(now);
    return result.changes;
  }
```

Add `VerificationNonceRecord` to the import from `'../../interface.js'` at the top of the file.

- [ ] **Step 3: Verify TypeScript compiles (SQLite provider should pass)**

```bash
cd aimeat && npx tsc --noEmit 2>&1 | grep -c "error TS"
```

Expected: Errors remaining only in MongoDB provider (not yet implemented).

- [ ] **Step 4: Commit**

```bash
git add aimeat/src/storage/providers/sqlite/schema.ts aimeat/src/storage/providers/sqlite/index.ts
git commit -m "feat(eudiw): implement verification nonce storage in SQLite backend"
```

---

## Task 5: Nonce Storage -- MongoDB/Prisma Implementation

**Files:**
- Modify: `aimeat/prisma/schema.prisma:688` (after TrustedIssuer model)
- Modify: `aimeat/src/storage/providers/mongodb/index.ts` (after trusted issuer methods, ~line 2534)

- [ ] **Step 1: Add VerificationNonce model to Prisma schema**

In `aimeat/prisma/schema.prisma`, after the `TrustedIssuer` model (after line 688), add:

```prisma
model VerificationNonce {
  id          String   @id @map("_id")
  owner       String
  type        String
  state       String   @unique
  nonce       String
  redirectUri String   @default("")
  createdAt   DateTime @default(now())
  expiresAt   DateTime

  @@index([state])
  @@index([expiresAt])
}
```

- [ ] **Step 2: Generate Prisma client**

```bash
cd aimeat && npx prisma generate
```

Expected: Prisma Client generated successfully.

- [ ] **Step 3: Implement nonce methods in MongoDB provider**

In `aimeat/src/storage/providers/mongodb/index.ts`, after the trusted issuer methods (after `deleteTrustedIssuer`), add:

```typescript
  // ── Verification Nonces ──

  async createVerificationNonce(record: VerificationNonceRecord): Promise<VerificationNonceRecord> {
    this.ensureReady();
    await this.prisma.verificationNonce.create({
      data: {
        id: record.id,
        owner: record.owner,
        type: record.type,
        state: record.state,
        nonce: record.nonce,
        redirectUri: record.redirectUri ?? '',
        createdAt: new Date(record.createdAt),
        expiresAt: new Date(record.expiresAt),
      },
    });
    return record;
  }

  async getVerificationNonce(state: string): Promise<VerificationNonceRecord | null> {
    this.ensureReady();
    const row = await this.prisma.verificationNonce.findUnique({ where: { state } });
    if (!row) return null;
    return {
      id: row.id,
      owner: row.owner,
      type: row.type as 'eudiw' | 'ftn',
      state: row.state,
      nonce: row.nonce,
      redirectUri: row.redirectUri,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt,
    };
  }

  async deleteVerificationNonce(state: string): Promise<void> {
    this.ensureReady();
    await this.prisma.verificationNonce.deleteMany({ where: { state } });
  }

  async cleanExpiredNonces(): Promise<number> {
    this.ensureReady();
    const result = await this.prisma.verificationNonce.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }
```

Add `VerificationNonceRecord` to the import from `'../../interface.js'` at the top of the file.

- [ ] **Step 4: Verify TypeScript compiles cleanly**

```bash
cd aimeat && npx tsc --noEmit
```

Expected: Clean (0 errors).

- [ ] **Step 5: Commit**

```bash
git add aimeat/prisma/schema.prisma aimeat/src/storage/providers/mongodb/index.ts
git commit -m "feat(eudiw): implement verification nonce storage in MongoDB/Prisma backend"
```

---

## Task 6: Nonce Cleanup Background Job

**Files:**
- Modify: `aimeat/src/services/job-seeding.ts`
- Modify: `aimeat/src/services/core-jobs.ts`

- [ ] **Step 1: Add nonce-cleanup job to job-seeding.ts**

In `aimeat/src/services/job-seeding.ts`, inside the `seedCoreScheduledJobs` function, add to the `jobs` array (after the `capability-aggregation` push on line 33):

```typescript
  if (config.eudiwEnabled || config.ftnEnabled) {
    jobs.push({ id: 'core:nonce-cleanup', name: 'Verification Nonce Cleanup', coreHandler: 'nonce-cleanup', cron: '*/5 * * * *' });
  }
```

- [ ] **Step 2: Register nonce-cleanup handler in core-jobs.ts**

In `aimeat/src/services/core-jobs.ts`, inside the `registerCoreHandlers` function, add after the `capability-aggregation` handler registration (after line 29):

```typescript
  if (config.eudiwEnabled || config.ftnEnabled) {
    scheduler.registerCoreHandler('nonce-cleanup', () => runNonceCleanupJob(storage));
  }
```

Then add the handler function at the bottom of the file:

```typescript
async function runNonceCleanupJob(storage: Storage): Promise<void> {
  const cleaned = await storage.cleanExpiredNonces();
  if (cleaned > 0) logger.info(`Nonce cleanup: removed ${cleaned} expired verification nonces`);
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd aimeat && npx tsc --noEmit
```

Expected: Clean (0 errors).

- [ ] **Step 4: Commit**

```bash
git add aimeat/src/services/job-seeding.ts aimeat/src/services/core-jobs.ts
git commit -m "feat(eudiw): add verification nonce cleanup background job"
```

---

## Task 7: Nonce Storage Unit Tests

**Files:**
- Create: `aimeat/test/unit/nonce-storage.test.ts`

- [ ] **Step 1: Write nonce storage unit tests**

Create `aimeat/test/unit/nonce-storage.test.ts`:

```typescript
/**
 * @file nonce-storage.test.ts
 * @description Unit tests for verification nonce CRUD and expiry
 * @version-history
 *   v1.0.0 — 2026-05-02 — Initial test suite
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Storage, VerificationNonceRecord } from '../../src/storage/interface.js';

function makeInMemoryNonceStorage() {
  const nonces = new Map<string, VerificationNonceRecord>();

  return {
    nonces,
    async createVerificationNonce(record: VerificationNonceRecord) {
      if ([...nonces.values()].some(n => n.state === record.state)) {
        throw new Error('UNIQUE constraint failed: state');
      }
      nonces.set(record.id, record);
      return record;
    },
    async getVerificationNonce(state: string) {
      return [...nonces.values()].find(n => n.state === state) ?? null;
    },
    async deleteVerificationNonce(state: string) {
      for (const [id, n] of nonces) {
        if (n.state === state) { nonces.delete(id); break; }
      }
    },
    async cleanExpiredNonces() {
      const now = new Date().toISOString();
      let count = 0;
      for (const [id, n] of nonces) {
        if (n.expiresAt < now) { nonces.delete(id); count++; }
      }
      return count;
    },
  };
}

function makeNonce(overrides: Partial<VerificationNonceRecord> = {}): VerificationNonceRecord {
  const now = new Date();
  return {
    id: `nonce-${Math.random().toString(36).slice(2, 8)}`,
    owner: 'testuser',
    type: 'eudiw',
    state: `state-${Math.random().toString(36).slice(2, 12)}`,
    nonce: `nonce-${Math.random().toString(36).slice(2, 12)}`,
    redirectUri: '',
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 300_000).toISOString(),
    ...overrides,
  };
}

describe('Verification Nonce Storage', () => {
  let storage: ReturnType<typeof makeInMemoryNonceStorage>;

  beforeEach(() => {
    storage = makeInMemoryNonceStorage();
  });

  it('creates and retrieves a nonce by state', async () => {
    const record = makeNonce({ state: 'unique-state-1' });
    await storage.createVerificationNonce(record);
    const found = await storage.getVerificationNonce('unique-state-1');
    expect(found).not.toBeNull();
    expect(found!.id).toBe(record.id);
    expect(found!.owner).toBe('testuser');
    expect(found!.type).toBe('eudiw');
  });

  it('returns null for non-existent state', async () => {
    const found = await storage.getVerificationNonce('does-not-exist');
    expect(found).toBeNull();
  });

  it('enforces unique state constraint', async () => {
    const record1 = makeNonce({ state: 'dup-state' });
    const record2 = makeNonce({ state: 'dup-state' });
    await storage.createVerificationNonce(record1);
    await expect(storage.createVerificationNonce(record2)).rejects.toThrow('UNIQUE');
  });

  it('deletes a nonce by state', async () => {
    const record = makeNonce({ state: 'to-delete' });
    await storage.createVerificationNonce(record);
    await storage.deleteVerificationNonce('to-delete');
    const found = await storage.getVerificationNonce('to-delete');
    expect(found).toBeNull();
  });

  it('cleanExpiredNonces removes expired nonces and returns count', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 300_000).toISOString();
    await storage.createVerificationNonce(makeNonce({ state: 'expired-1', expiresAt: past }));
    await storage.createVerificationNonce(makeNonce({ state: 'expired-2', expiresAt: past }));
    await storage.createVerificationNonce(makeNonce({ state: 'still-valid', expiresAt: future }));

    const cleaned = await storage.cleanExpiredNonces();
    expect(cleaned).toBe(2);
    expect(await storage.getVerificationNonce('still-valid')).not.toBeNull();
    expect(await storage.getVerificationNonce('expired-1')).toBeNull();
  });

  it('stores eudiw and ftn types', async () => {
    await storage.createVerificationNonce(makeNonce({ state: 'eudiw-state', type: 'eudiw' }));
    await storage.createVerificationNonce(makeNonce({ state: 'ftn-state', type: 'ftn' }));
    expect((await storage.getVerificationNonce('eudiw-state'))!.type).toBe('eudiw');
    expect((await storage.getVerificationNonce('ftn-state'))!.type).toBe('ftn');
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

```bash
cd aimeat && npx vitest run test/unit/nonce-storage.test.ts
```

Expected: All 6 tests pass.

- [ ] **Step 3: Commit**

```bash
git add aimeat/test/unit/nonce-storage.test.ts
git commit -m "test(eudiw): add verification nonce storage unit tests"
```

---

## Task 8: SD-JWT Verification Service

**Files:**
- Create: `aimeat/src/services/sd-jwt.ts`

- [ ] **Step 1: Create the SD-JWT verifier service**

Create `aimeat/src/services/sd-jwt.ts`:

```typescript
/**
 * @file sd-jwt.ts
 * @description SD-JWT decode and cryptographic signature verification for EUDIW VP tokens.
 *   Uses @sd-jwt/decode for token parsing and @sd-jwt/verify for signature validation.
 * @version-history
 *   v1.0.0 — 2026-05-02 — Initial implementation
 */

import { decodeSdJwt } from '@sd-jwt/decode';
import { type Verifier } from '@sd-jwt/verify';
import * as jose from 'jose';
import { logger } from '../utils/logger.js';

export interface SdJwtDecodeResult {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  disclosures: Array<{ salt: string; key?: string; value: unknown }>;
  hasKeyBinding: boolean;
}

export interface SdJwtVerificationResult {
  valid: boolean;
  payload?: Record<string, unknown>;
  disclosedClaims?: Record<string, unknown>;
  issuer?: string;
  keyBinding?: boolean;
  error?: string;
}

export interface SdJwtVerifier {
  verify(sdJwtToken: string, trustedIssuerKeys: Map<string, JsonWebKey>): Promise<SdJwtVerificationResult>;
  decode(sdJwtToken: string): SdJwtDecodeResult;
}

export function createSdJwtVerifier(): SdJwtVerifier {
  return {
    decode(sdJwtToken: string): SdJwtDecodeResult {
      const decoded = decodeSdJwt(sdJwtToken);
      return {
        header: decoded.jwt.header as Record<string, unknown>,
        payload: decoded.jwt.payload as Record<string, unknown>,
        disclosures: decoded.disclosures.map(d => ({
          salt: d.salt ?? '',
          key: d.key,
          value: d.value,
        })),
        hasKeyBinding: !!decoded.kbJwt,
      };
    },

    async verify(sdJwtToken: string, trustedIssuerKeys: Map<string, JsonWebKey>): Promise<SdJwtVerificationResult> {
      try {
        // 1. Decode the SD-JWT to extract header, payload, disclosures
        let decoded: ReturnType<typeof decodeSdJwt>;
        try {
          decoded = decodeSdJwt(sdJwtToken);
        } catch {
          return { valid: false, error: 'Invalid SD-JWT format' };
        }

        const payload = decoded.jwt.payload as Record<string, unknown>;
        const header = decoded.jwt.header as Record<string, unknown>;

        // 2. Extract issuer
        const issuer = (payload.iss as string) ?? '';
        if (!issuer) {
          return { valid: false, error: 'Missing issuer in SD-JWT' };
        }

        // 3. Look up trusted issuer key
        const issuerJwk = trustedIssuerKeys.get(issuer);
        if (!issuerJwk) {
          return { valid: false, error: 'Untrusted issuer' };
        }

        // 4. Verify the issuer signature
        const alg = (header.alg as string) ?? 'ES256';
        try {
          const publicKey = await jose.importJWK(issuerJwk, alg);
          // Extract the raw JWT portion (everything before first ~)
          const jwtPart = sdJwtToken.split('~')[0];
          await jose.jwtVerify(jwtPart, publicKey, { algorithms: [alg] });
        } catch (err) {
          return { valid: false, error: `Signature verification failed: ${String(err)}` };
        }

        // 5. Check expiry
        const exp = payload.exp as number | undefined;
        if (exp && exp * 1000 < Date.now()) {
          return { valid: false, error: 'Credential expired' };
        }

        // 6. Reconstruct disclosed claims from disclosures
        const disclosedClaims: Record<string, unknown> = {};
        for (const disclosure of decoded.disclosures) {
          if (disclosure.key) {
            disclosedClaims[disclosure.key] = disclosure.value;
          }
        }

        // Also include any non-underscore top-level claims from payload
        // (SD-JWT may embed some claims directly without selective disclosure)
        const vc = payload.vc as Record<string, unknown> | undefined;
        const subject = (vc?.credentialSubject ?? payload.credentialSubject ?? {}) as Record<string, unknown>;
        for (const [key, value] of Object.entries(subject)) {
          if (key !== 'id' && key !== 'type' && key !== '_sd' && key !== '_sd_alg') {
            if (!(key in disclosedClaims)) {
              disclosedClaims[key] = value;
            }
          }
        }

        return {
          valid: true,
          payload,
          disclosedClaims,
          issuer,
          keyBinding: !!decoded.kbJwt,
        };
      } catch (err) {
        logger.error('SD-JWT verification failed', { error: String(err) });
        return { valid: false, error: 'Verification failed' };
      }
    },
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd aimeat && npx tsc --noEmit
```

Expected: Clean (0 errors).

- [ ] **Step 3: Commit**

```bash
git add aimeat/src/services/sd-jwt.ts
git commit -m "feat(eudiw): create SD-JWT verification service"
```

---

## Task 9: SD-JWT Test Helper

**Files:**
- Create: `aimeat/test/helpers/test-sd-jwt.ts`

- [ ] **Step 1: Create test helper for constructing signed SD-JWTs**

Create `aimeat/test/helpers/test-sd-jwt.ts`:

```typescript
/**
 * @file test-sd-jwt.ts
 * @description Test helper for creating signed SD-JWT tokens with known keys.
 *   Used in unit and E2E tests to exercise the real SD-JWT verification path.
 * @version-history
 *   v1.0.0 — 2026-05-02 — Initial helper
 */

import * as jose from 'jose';

export interface TestKeyPair {
  publicJwk: JsonWebKey;
  privateKey: CryptoKey;
}

export async function generateTestKeyPair(alg: 'ES256' | 'EdDSA' = 'EdDSA'): Promise<TestKeyPair> {
  const algorithm = alg === 'EdDSA' ? 'Ed25519' : { name: 'ECDSA', namedCurve: 'P-256' };
  const { publicKey, privateKey } = await jose.generateKeyPair(alg);
  const publicJwk = await jose.exportJWK(publicKey);
  return { publicJwk, privateKey };
}

export async function createTestSdJwt(
  claims: Record<string, unknown>,
  issuer: string,
  keyPair: TestKeyPair,
  opts: {
    alg?: 'ES256' | 'EdDSA';
    expiresInSeconds?: number;
    disclosedKeys?: string[];
  } = {},
): Promise<string> {
  const alg = opts.alg ?? 'EdDSA';
  const now = Math.floor(Date.now() / 1000);
  const exp = opts.expiresInSeconds ? now + opts.expiresInSeconds : now + 3600;

  // Build the SD-JWT payload
  // For simplicity in tests: disclosed claims go into vc.credentialSubject directly,
  // and we add disclosure entries for each key in disclosedKeys
  const payload: Record<string, unknown> = {
    iss: issuer,
    iat: now,
    exp,
    vc: {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiableCredential'],
      credentialSubject: {
        id: 'did:example:subject',
        type: 'Person',
        ...claims,
      },
    },
  };

  // Sign the JWT part
  const jwt = await new jose.SignJWT(payload)
    .setProtectedHeader({ alg, typ: 'vc+sd-jwt' })
    .sign(keyPair.privateKey);

  // Build disclosure entries for specified keys
  const disclosures: string[] = [];
  const disclosedKeys = opts.disclosedKeys ?? Object.keys(claims);
  for (const key of disclosedKeys) {
    if (key in claims) {
      const salt = jose.base64url.encode(crypto.getRandomValues(new Uint8Array(16)));
      const disclosure = jose.base64url.encode(
        new TextEncoder().encode(JSON.stringify([salt, key, claims[key]]))
      );
      disclosures.push(disclosure);
    }
  }

  // SD-JWT format: <jwt>~<disclosure1>~<disclosure2>~
  return jwt + '~' + disclosures.join('~') + '~';
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd aimeat && npx tsc --noEmit
```

Expected: Clean (0 errors).

- [ ] **Step 3: Commit**

```bash
git add aimeat/test/helpers/test-sd-jwt.ts
git commit -m "test(eudiw): add SD-JWT test helper for creating signed test tokens"
```

---

## Task 10: SD-JWT Unit Tests

**Files:**
- Create: `aimeat/test/unit/sd-jwt.test.ts`

- [ ] **Step 1: Write SD-JWT verification unit tests**

Create `aimeat/test/unit/sd-jwt.test.ts`:

```typescript
/**
 * @file sd-jwt.test.ts
 * @description Unit tests for SD-JWT decode and cryptographic verification
 * @version-history
 *   v1.0.0 — 2026-05-02 — Initial test suite
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createSdJwtVerifier } from '../../src/services/sd-jwt.js';
import { generateTestKeyPair, createTestSdJwt, type TestKeyPair } from '../helpers/test-sd-jwt.js';
import type { SdJwtVerifier } from '../../src/services/sd-jwt.js';

let verifier: SdJwtVerifier;
let eddsaKeyPair: TestKeyPair;
let es256KeyPair: TestKeyPair;
const ISSUER = 'https://trusted-issuer.example.com';

beforeAll(async () => {
  verifier = createSdJwtVerifier();
  eddsaKeyPair = await generateTestKeyPair('EdDSA');
  es256KeyPair = await generateTestKeyPair('ES256');
});

describe('SD-JWT Verifier', () => {
  describe('decode', () => {
    it('decodes a valid SD-JWT into header, payload, and disclosures', async () => {
      const token = await createTestSdJwt(
        { given_name: 'Alice', family_name: 'Smith' },
        ISSUER,
        eddsaKeyPair,
        { disclosedKeys: ['given_name', 'family_name'] },
      );
      const decoded = verifier.decode(token);
      expect(decoded.header.alg).toBe('EdDSA');
      expect(decoded.payload.iss).toBe(ISSUER);
      expect(decoded.disclosures.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('verify', () => {
    it('verifies a valid EdDSA-signed SD-JWT', async () => {
      const keys = new Map<string, JsonWebKey>([[ISSUER, eddsaKeyPair.publicJwk]]);
      const token = await createTestSdJwt(
        { given_name: 'Alice', family_name: 'Smith', birthdate: '1990-01-01' },
        ISSUER,
        eddsaKeyPair,
      );
      const result = await verifier.verify(token, keys);
      expect(result.valid).toBe(true);
      expect(result.issuer).toBe(ISSUER);
      expect(result.disclosedClaims?.given_name).toBe('Alice');
      expect(result.disclosedClaims?.family_name).toBe('Smith');
      expect(result.disclosedClaims?.birthdate).toBe('1990-01-01');
    });

    it('verifies a valid ES256-signed SD-JWT', async () => {
      const keys = new Map<string, JsonWebKey>([[ISSUER, es256KeyPair.publicJwk]]);
      const token = await createTestSdJwt(
        { given_name: 'Bob' },
        ISSUER,
        es256KeyPair,
        { alg: 'ES256' },
      );
      const result = await verifier.verify(token, keys);
      expect(result.valid).toBe(true);
      expect(result.disclosedClaims?.given_name).toBe('Bob');
    });

    it('rejects invalid SD-JWT format', async () => {
      const keys = new Map<string, JsonWebKey>();
      const result = await verifier.verify('not-a-valid-token', keys);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid');
    });

    it('rejects token from untrusted issuer', async () => {
      const keys = new Map<string, JsonWebKey>(); // empty -- no trusted issuers
      const token = await createTestSdJwt({ given_name: 'Eve' }, ISSUER, eddsaKeyPair);
      const result = await verifier.verify(token, keys);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Untrusted issuer');
    });

    it('rejects token with wrong key', async () => {
      const wrongKeyPair = await generateTestKeyPair('EdDSA');
      // Token signed by eddsaKeyPair, but keys map has wrongKeyPair
      const keys = new Map<string, JsonWebKey>([[ISSUER, wrongKeyPair.publicJwk]]);
      const token = await createTestSdJwt({ given_name: 'Eve' }, ISSUER, eddsaKeyPair);
      const result = await verifier.verify(token, keys);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Signature verification failed');
    });

    it('rejects expired token', async () => {
      const keys = new Map<string, JsonWebKey>([[ISSUER, eddsaKeyPair.publicJwk]]);
      const token = await createTestSdJwt(
        { given_name: 'Alice' },
        ISSUER,
        eddsaKeyPair,
        { expiresInSeconds: -3600 }, // expired 1 hour ago
      );
      const result = await verifier.verify(token, keys);
      expect(result.valid).toBe(false);
      // May fail on either signature (exp in past) or our expiry check
    });

    it('rejects token with missing issuer', async () => {
      const keys = new Map<string, JsonWebKey>();
      const token = await createTestSdJwt({ given_name: 'Alice' }, '', eddsaKeyPair);
      const result = await verifier.verify(token, keys);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Missing issuer in SD-JWT');
    });
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
cd aimeat && npx vitest run test/unit/sd-jwt.test.ts
```

Expected: All tests pass. If any fail due to SD-JWT library API differences, adjust the service implementation in `sd-jwt.ts` and re-run.

- [ ] **Step 3: Commit**

```bash
git add aimeat/test/unit/sd-jwt.test.ts
git commit -m "test(eudiw): add SD-JWT verification unit tests"
```

---

## Task 11: Rewrite EUDIW Service to Use Real SD-JWT Verification

**Files:**
- Modify: `aimeat/src/services/eudiw.ts`
- Modify: `aimeat/src/server-bootstrap/routes-loader.ts:272`

- [ ] **Step 1: Rewrite eudiw.ts**

Replace the entire contents of `aimeat/src/services/eudiw.ts` with:

```typescript
/**
 * @file eudiw.ts
 * @description EUDIW (EU Digital Identity Wallet) service for OpenID4VP verification.
 *   Generates authorization requests and verifies VP tokens using real SD-JWT
 *   cryptographic verification against trusted issuer public keys.
 * @version-history
 *   v1.0.0 — 2026-03-01 — Initial scaffold implementation
 *   v2.0.0 — 2026-05-02 — Real SD-JWT cryptographic verification
 */

import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, TrustedIssuerRecord } from '../storage/interface.js';
import type { SdJwtVerifier } from './sd-jwt.js';
import { logger } from '../utils/logger.js';

export interface EudiwVerificationResult {
  valid: boolean;
  attributes?: Record<string, unknown>;
  issuer?: string;
  error?: string;
}

export interface EudiwService {
  readonly enabled: boolean;
  generateAuthorizationRequest(state: string): Record<string, unknown>;
  verifyPresentation(vpToken: string, presentationSubmission: Record<string, unknown>): Promise<EudiwVerificationResult>;
}

function buildIssuerKeyMap(issuers: TrustedIssuerRecord[]): Map<string, JsonWebKey> {
  const map = new Map<string, JsonWebKey>();
  for (const issuer of issuers) {
    if (!issuer.trusted) continue;
    try {
      const jwk = JSON.parse(issuer.publicKey) as JsonWebKey;
      map.set(issuer.url, jwk);
    } catch {
      logger.warn(`Trusted issuer ${issuer.name} has invalid JWK in publicKey field`);
    }
  }
  return map;
}

function extractIdentityAttributes(claims?: Record<string, unknown>): Record<string, unknown> {
  if (!claims) return {};
  const attributes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(claims)) {
    if (key !== 'id' && key !== 'type') {
      attributes[key] = value;
    }
  }
  return attributes;
}

export function createEudiwService(
  config: AimeatConfig,
  storage: Storage,
  sdJwtVerifier: SdJwtVerifier,
): EudiwService {
  return {
    get enabled() { return config.eudiwEnabled; },

    generateAuthorizationRequest(state: string) {
      return {
        response_type: 'vp_token',
        response_mode: 'direct_post',
        client_id: config.eudiwClientId,
        redirect_uri: config.eudiwRedirectUri || `${config.baseUrl}/v1/ghii/verify/eudiw/callback`,
        state,
        nonce: randomUUID(),
        presentation_definition: {
          id: 'aimeat-identity-verification',
          input_descriptors: [{
            id: 'identity-credential',
            format: { 'vc+sd-jwt': { alg: ['ES256', 'EdDSA'] } },
            constraints: {
              fields: [
                { path: ['$.vc.credentialSubject.given_name'], purpose: 'Identity verification' },
                { path: ['$.vc.credentialSubject.family_name'], purpose: 'Identity verification' },
                { path: ['$.vc.credentialSubject.birthdate'], purpose: 'Age verification' },
                { path: ['$.vc.credentialSubject.nationality'], purpose: 'Nationality' },
              ],
            },
          }],
        },
      };
    },

    async verifyPresentation(vpToken: string, _presentationSubmission: Record<string, unknown>): Promise<EudiwVerificationResult> {
      try {
        const issuers = await storage.listTrustedIssuers({ type: 'eudiw' });
        const keyMap = buildIssuerKeyMap(issuers);

        const result = await sdJwtVerifier.verify(vpToken, keyMap);
        if (!result.valid) {
          return { valid: false, error: result.error };
        }

        const attributes = extractIdentityAttributes(result.disclosedClaims);
        return { valid: true, attributes, issuer: result.issuer };
      } catch (err) {
        logger.error('EUDIW verification failed', { error: String(err) });
        return { valid: false, error: 'Verification failed' };
      }
    },
  };
}
```

- [ ] **Step 2: Update routes-loader to pass SdJwtVerifier**

In `aimeat/src/server-bootstrap/routes-loader.ts`, add the import (near the other service imports):

```typescript
import { createSdJwtVerifier } from '../services/sd-jwt.js';
```

Then update the EUDIW service creation (around line 272):

Replace:
```typescript
  const eudiwService = createEudiwService(config, storage);
```

With:
```typescript
  const sdJwtVerifier = createSdJwtVerifier();
  const eudiwService = createEudiwService(config, storage, sdJwtVerifier);
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd aimeat && npx tsc --noEmit
```

Expected: Clean (0 errors).

- [ ] **Step 4: Update existing EUDIW unit tests**

The existing `test/unit/eudiw-verifier.test.ts` calls `createEudiwService(config, storage)` with 2 args. Update it to pass a mock SD-JWT verifier as the third argument.

In `aimeat/test/unit/eudiw-verifier.test.ts`, add at the top (after the imports):

```typescript
import { createSdJwtVerifier } from '../../src/services/sd-jwt.js';
```

Then update all `createEudiwService(makeConfig(...), storage)` calls to:

```typescript
createEudiwService(makeConfig(...), storage, createSdJwtVerifier())
```

There are approximately 8 occurrences in the test file.

- [ ] **Step 5: Run existing EUDIW tests**

```bash
cd aimeat && npx vitest run test/unit/eudiw-verifier.test.ts
```

Expected: Tests may need adjustment since the SD-JWT verifier now expects real SD-JWT format instead of simple 3-part JWTs. Update `createTestVpToken` to use the `createTestSdJwt` helper from Task 9 where needed. The `generateAuthorizationRequest` tests should pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add aimeat/src/services/eudiw.ts aimeat/src/server-bootstrap/routes-loader.ts aimeat/test/unit/eudiw-verifier.test.ts
git commit -m "feat(eudiw): rewrite EUDIW service with real SD-JWT cryptographic verification"
```

---

## Task 12: Add Nonce Validation to EUDIW Routes

**Files:**
- Modify: `aimeat/src/routes/verification.ts`

- [ ] **Step 1: Add nonce storage to the EUDIW request endpoint**

In `aimeat/src/routes/verification.ts`, update the `GET /v1/ghii/verify/eudiw/request` handler. After `const authRequest = eudiwService.generateAuthorizationRequest(state);` (line 28), add nonce persistence:

```typescript
    const nonceTtl = config.nonceTtlSeconds * 1000;
    await storage.createVerificationNonce({
      id: randomUUID(),
      owner: req.auth!.owner,
      type: 'eudiw',
      state,
      nonce: authRequest.nonce as string,
      redirectUri: '',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + nonceTtl).toISOString(),
    });
```

- [ ] **Step 2: Add nonce validation to the EUDIW verify endpoint**

In the `POST /v1/ghii/verify/eudiw` handler, after the `vp_token` check (around line 43), add:

```typescript
      const { state } = req.body;
      if (state) {
        const nonceRecord = await storage.getVerificationNonce(state);
        if (!nonceRecord) {
          res.status(400).json(error(config.nodeId, 'INVALID_STATE', 'Invalid or expired state parameter'));
          return;
        }
        if (nonceRecord.owner !== req.auth!.owner) {
          res.status(403).json(error(config.nodeId, 'STATE_MISMATCH', 'State does not belong to this user'));
          return;
        }
        if (new Date(nonceRecord.expiresAt) < new Date()) {
          await storage.deleteVerificationNonce(state);
          res.status(400).json(error(config.nodeId, 'STATE_EXPIRED', 'Verification request expired'));
          return;
        }
        await storage.deleteVerificationNonce(state);
      }
```

- [ ] **Step 3: Update the EUDIW callback to be unauthenticated and validate via state**

In the `POST /v1/ghii/verify/eudiw/callback` handler:

1. Remove `requireAuth()` from the route middleware (change from `router.post('/v1/ghii/verify/eudiw/callback', requireAuth(), async (req, res) => {` to `router.post('/v1/ghii/verify/eudiw/callback', async (req, res) => {`).

2. Replace the `console.log` state placeholder (line 102-104) with real state validation:

```typescript
      if (!state) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'Missing state parameter'));
        return;
      }
      const nonceRecord = await storage.getVerificationNonce(state);
      if (!nonceRecord) {
        res.status(400).json(error(config.nodeId, 'INVALID_STATE', 'Invalid or expired state parameter'));
        return;
      }
      if (new Date(nonceRecord.expiresAt) < new Date()) {
        await storage.deleteVerificationNonce(state);
        res.status(400).json(error(config.nodeId, 'STATE_EXPIRED', 'Verification request expired'));
        return;
      }
      await storage.deleteVerificationNonce(state);
```

3. Change `const ownerName = req.auth!.owner;` to `const ownerName = nonceRecord.owner;` (since there's no auth on this endpoint).

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd aimeat && npx tsc --noEmit
```

Expected: Clean (0 errors).

- [ ] **Step 5: Commit**

```bash
git add aimeat/src/routes/verification.ts
git commit -m "feat(eudiw): add nonce storage and validation to EUDIW verification routes"
```

---

## Task 13: OIDC Client Service for FTN

**Files:**
- Create: `aimeat/src/services/oidc-client.ts`

- [ ] **Step 1: Create the generic OIDC client service**

Create `aimeat/src/services/oidc-client.ts`:

```typescript
/**
 * @file oidc-client.ts
 * @description Generic OIDC Relying Party wrapper built on openid-client v6.
 *   Broker-agnostic: works with any standard OIDC provider (FTN, BankID, MitID).
 * @version-history
 *   v1.0.0 — 2026-05-02 — Initial implementation
 */

import * as oidc from 'openid-client';
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';

export interface OidcClientConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

export interface OidcAuthRequest {
  authorizationUrl: string;
  state: string;
  nonce: string;
}

export interface OidcTokenResult {
  valid: boolean;
  claims?: Record<string, unknown>;
  error?: string;
}

export interface OidcClient {
  readonly initialized: boolean;
  initialize(): Promise<void>;
  createAuthRequest(): OidcAuthRequest;
  exchangeCode(code: string, state: string, expectedNonce: string): Promise<OidcTokenResult>;
}

export function createOidcClient(clientConfig: OidcClientConfig): OidcClient {
  let serverConfig: oidc.Configuration | null = null;
  let isInitialized = false;

  return {
    get initialized() { return isInitialized; },

    async initialize(): Promise<void> {
      try {
        serverConfig = await oidc.discovery(
          new URL(clientConfig.issuerUrl),
          clientConfig.clientId,
          clientConfig.clientSecret,
        );
        isInitialized = true;
        logger.info(`OIDC client initialized for issuer: ${clientConfig.issuerUrl}`);
      } catch (err) {
        logger.error('OIDC discovery failed', { issuer: clientConfig.issuerUrl, error: String(err) });
        throw err;
      }
    },

    createAuthRequest(): OidcAuthRequest {
      if (!serverConfig) throw new Error('OIDC client not initialized');

      const state = randomUUID();
      const nonce = randomUUID();

      const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientConfig.clientId,
        redirect_uri: clientConfig.redirectUri,
        scope: clientConfig.scopes.join(' '),
        state,
        nonce,
      });

      const authEndpoint = serverConfig.serverMetadata().authorization_endpoint;
      if (!authEndpoint) throw new Error('Authorization endpoint not found in OIDC discovery');

      const authorizationUrl = `${authEndpoint}?${params.toString()}`;

      return { authorizationUrl, state, nonce };
    },

    async exchangeCode(code: string, _state: string, expectedNonce: string): Promise<OidcTokenResult> {
      if (!serverConfig) throw new Error('OIDC client not initialized');

      try {
        const tokens = await oidc.authorizationCodeGrant(
          serverConfig,
          new URL(`${clientConfig.redirectUri}?code=${encodeURIComponent(code)}`),
          { expectedNonce },
        );

        const claims = tokens.claims();
        if (!claims) {
          return { valid: false, error: 'No claims in token response' };
        }

        return {
          valid: true,
          claims: claims as unknown as Record<string, unknown>,
        };
      } catch (err) {
        logger.error('OIDC code exchange failed', { error: String(err) });
        return { valid: false, error: `Token exchange failed: ${String(err)}` };
      }
    },
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd aimeat && npx tsc --noEmit
```

Expected: Clean (0 errors).

- [ ] **Step 3: Commit**

```bash
git add aimeat/src/services/oidc-client.ts
git commit -m "feat(ftn): create generic OIDC client service for FTN broker communication"
```

---

## Task 14: FTN Routes (Authorize + Callback)

**Files:**
- Modify: `aimeat/src/routes/verification.ts`
- Modify: `aimeat/src/server-bootstrap/routes-loader.ts`

- [ ] **Step 1: Update verificationRouter signature to accept OidcClient**

In `aimeat/src/routes/verification.ts`, update the function signature:

```typescript
import type { OidcClient } from '../services/oidc-client.js';
```

Update the function signature to add `oidcClient: OidcClient | null`:

```typescript
export function verificationRouter(
  config: AimeatConfig,
  storage: Storage,
  eudiwService: EudiwService,
  vcIssuerService: VcIssuerService,
  mydataReceiptService: MyDataReceiptService,
  oidcClient: OidcClient | null,
): Router {
```

- [ ] **Step 2: Add FTN authorize endpoint**

In `aimeat/src/routes/verification.ts`, before the existing `POST /v1/ghii/verify/ftn` route, add:

```typescript
  // GET /v1/ghii/verify/ftn/authorize — Initiate FTN OIDC flow
  router.get('/v1/ghii/verify/ftn/authorize', requireAuth(), async (req, res) => {
    try {
      if (!config.ftnEnabled || !oidcClient?.initialized) {
        res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'FTN verification not available'));
        return;
      }

      const authRequest = oidcClient.createAuthRequest();
      const nonceTtl = config.nonceTtlSeconds * 1000;
      await storage.createVerificationNonce({
        id: randomUUID(),
        owner: req.auth!.owner,
        type: 'ftn',
        state: authRequest.state,
        nonce: authRequest.nonce,
        redirectUri: '',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + nonceTtl).toISOString(),
      });

      res.json(success(config.nodeId, {
        authorizationUrl: authRequest.authorizationUrl,
        state: authRequest.state,
      }));
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
    }
  });

  // GET /v1/ghii/verify/ftn/callback — FTN OIDC redirect callback
  router.get('/v1/ghii/verify/ftn/callback', async (req, res) => {
    try {
      if (!config.ftnEnabled || !oidcClient?.initialized) {
        res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'FTN verification not available'));
        return;
      }

      const code = req.query.code as string | undefined;
      const state = req.query.state as string | undefined;
      if (!code || !state) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'Missing code or state'));
        return;
      }

      const nonceRecord = await storage.getVerificationNonce(state);
      if (!nonceRecord) {
        res.status(400).json(error(config.nodeId, 'INVALID_STATE', 'Invalid or expired state'));
        return;
      }
      if (new Date(nonceRecord.expiresAt) < new Date()) {
        await storage.deleteVerificationNonce(state);
        res.status(400).json(error(config.nodeId, 'STATE_EXPIRED', 'Verification request expired'));
        return;
      }

      const tokenResult = await oidcClient.exchangeCode(code, state, nonceRecord.nonce);
      await storage.deleteVerificationNonce(state);

      if (!tokenResult.valid || !tokenResult.claims) {
        res.status(400).json(error(config.nodeId, 'VERIFICATION_FAILED', tokenResult.error ?? 'FTN verification failed'));
        return;
      }

      const ghii = await storage.getGHIIByOwner(nonceRecord.owner);
      if (!ghii) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'GHII profile not found'));
        return;
      }

      // Hash the national PID claim
      const pidClaim = config.nationalEidPidClaim;
      const pidValue = tokenResult.claims[pidClaim] as string | undefined;
      let credentialHash = '';
      if (pidValue) {
        credentialHash = createHash('sha256').update(pidValue).digest('hex');
      }

      const verifiedAttributes = ['given_name', 'family_name', 'birthdate', pidClaim]
        .filter(k => tokenResult.claims![k] !== undefined);

      await storage.updateGHII(ghii.ghii, {
        verificationLevel: 3,
        ftnVerified: true,
        verificationMethod: 'eidas',
        verifiedAttributes,
        verificationIssuer: config.ftnProviderUrl,
        verificationCredentialHash: credentialHash,
        updatedAt: new Date().toISOString(),
      });

      // Respond based on Accept header
      if (req.accepts('html')) {
        res.redirect(`${config.baseUrl}/v1/profile`);
      } else {
        res.json(success(config.nodeId, {
          ghii: ghii.ghii,
          verificationLevel: 3,
          verificationMethod: 'ftn',
          ftnVerified: true,
          verifiedAttributes,
          verifiedAt: new Date().toISOString(),
        }));
      }
      emitChange('verification');
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
    }
  });
```

- [ ] **Step 3: Wire OIDC client in routes-loader**

In `aimeat/src/server-bootstrap/routes-loader.ts`, add imports:

```typescript
import { createOidcClient, type OidcClient } from '../services/oidc-client.js';
```

After the `sdJwtVerifier` creation (added in Task 11), add:

```typescript
  let oidcClient: OidcClient | null = null;
  if (config.ftnEnabled && config.ftnProviderUrl && config.ftnClientId) {
    oidcClient = createOidcClient({
      issuerUrl: config.ftnProviderUrl,
      clientId: config.ftnClientId,
      clientSecret: config.ftnClientSecret,
      redirectUri: `${config.baseUrl}/v1/ghii/verify/ftn/callback`,
      scopes: ['openid', 'profile', config.nationalEidPidClaim],
    });
    oidcClient.initialize().catch(err =>
      logger.warn('FTN OIDC discovery failed, FTN endpoints will return 503', { error: String(err) }));
  }
```

Update the `verificationRouter` call to pass `oidcClient`:

```typescript
  app.use(verificationRouter(config, storage, eudiwService, vcIssuerService, mydataReceiptService, oidcClient));
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd aimeat && npx tsc --noEmit
```

Expected: Clean (0 errors).

- [ ] **Step 5: Commit**

```bash
git add aimeat/src/routes/verification.ts aimeat/src/server-bootstrap/routes-loader.ts
git commit -m "feat(ftn): add FTN authorize and callback routes with OIDC client wiring"
```

---

## Task 15: OIDC Client Unit Tests

**Files:**
- Create: `aimeat/test/unit/oidc-client.test.ts`

- [ ] **Step 1: Write OIDC client unit tests**

Create `aimeat/test/unit/oidc-client.test.ts`:

```typescript
/**
 * @file oidc-client.test.ts
 * @description Unit tests for the generic OIDC client service
 * @version-history
 *   v1.0.0 — 2026-05-02 — Initial test suite
 */

import { describe, it, expect } from 'vitest';
import { createOidcClient } from '../../src/services/oidc-client.js';

describe('OIDC Client', () => {
  const baseConfig = {
    issuerUrl: 'https://fake-issuer.example.com',
    clientId: 'test-client',
    clientSecret: 'test-secret',
    redirectUri: 'http://localhost:40050/v1/ghii/verify/ftn/callback',
    scopes: ['openid', 'profile', 'personal_identity_code'],
  };

  it('reports not initialized before initialize() is called', () => {
    const client = createOidcClient(baseConfig);
    expect(client.initialized).toBe(false);
  });

  it('throws when createAuthRequest is called before initialization', () => {
    const client = createOidcClient(baseConfig);
    expect(() => client.createAuthRequest()).toThrow('not initialized');
  });

  it('throws when exchangeCode is called before initialization', async () => {
    const client = createOidcClient(baseConfig);
    await expect(client.exchangeCode('code', 'state', 'nonce')).rejects.toThrow('not initialized');
  });

  it('initialize() fails gracefully with unreachable issuer', async () => {
    const client = createOidcClient({
      ...baseConfig,
      issuerUrl: 'https://unreachable.invalid',
    });
    await expect(client.initialize()).rejects.toThrow();
    expect(client.initialized).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
cd aimeat && npx vitest run test/unit/oidc-client.test.ts
```

Expected: All 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add aimeat/test/unit/oidc-client.test.ts
git commit -m "test(ftn): add OIDC client unit tests"
```

---

## Task 16: OpenAPI Spec -- FTN Endpoints

**Files:**
- Modify: `aimeat/openapi.yaml`

- [ ] **Step 1: Add FTN authorize endpoint to OpenAPI spec**

In `aimeat/openapi.yaml`, in the Phase 3.3 section (near the existing `/v1/ghii/verify/ftn` path around line 10327), add:

```yaml
  /v1/ghii/verify/ftn/authorize:
    get:
      summary: Initiate FTN OIDC verification flow
      description: Returns an OIDC authorization URL for the Finnish Trust Network (or other configured national eID broker). The user's browser should be redirected to this URL.
      operationId: ftnAuthorize
      tags:
        - Phase 3.3 -- Identity verification (EUDIW, FTN, W3C VC)
      security:
        - BearerAuth: []
      responses:
        '200':
          description: Authorization URL generated
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/AimeatResponse'
                  - type: object
                    properties:
                      data:
                        type: object
                        properties:
                          authorizationUrl:
                            type: string
                            format: uri
                          state:
                            type: string
                            format: uuid
        '503':
          description: FTN verification not enabled or broker unreachable

  /v1/ghii/verify/ftn/callback:
    get:
      summary: FTN OIDC callback
      description: OIDC redirect callback. The FTN broker redirects the user's browser here after successful authentication. Validates the authorization code, exchanges for tokens, and upgrades the GHII to verification Level 3.
      operationId: ftnCallback
      tags:
        - Phase 3.3 -- Identity verification (EUDIW, FTN, W3C VC)
      parameters:
        - name: code
          in: query
          required: true
          schema:
            type: string
        - name: state
          in: query
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Verification successful (JSON response)
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/AimeatResponse'
                  - type: object
                    properties:
                      data:
                        type: object
                        properties:
                          ghii:
                            type: string
                          verificationLevel:
                            type: integer
                            enum: [3]
                          verificationMethod:
                            type: string
                            enum: [ftn]
                          ftnVerified:
                            type: boolean
                          verifiedAttributes:
                            type: array
                            items:
                              type: string
                          verifiedAt:
                            type: string
                            format: date-time
        '302':
          description: Verification successful (HTML redirect to profile)
        '400':
          description: Missing or invalid code/state
        '503':
          description: FTN verification not enabled
```

- [ ] **Step 2: Commit**

```bash
git add aimeat/openapi.yaml
git commit -m "docs(openapi): add FTN authorize and callback endpoint specs"
```

---

## Task 17: VC JWT Signing

**Files:**
- Modify: `aimeat/src/services/vc-issuer.ts`
- Modify: `aimeat/src/server-bootstrap/routes-loader.ts`
- Modify: `aimeat/src/routes/verification.ts`

- [ ] **Step 1: Rewrite vc-issuer.ts with signing support**

Replace the entire contents of `aimeat/src/services/vc-issuer.ts` with:

```typescript
/**
 * @file vc-issuer.ts
 * @description W3C Verifiable Credential issuer service. Issues AIMEATIdentityCredential
 *   as unsigned JSON or signed vc+ld+jwt using the node's Ed25519 keypair.
 * @version-history
 *   v1.0.0 — 2026-03-01 — Initial unsigned JSON implementation
 *   v2.0.0 — 2026-05-02 — Add JWT signing with Ed25519
 */

import { SignJWT, exportJWK, importJWK } from 'jose';
import type { AimeatConfig } from '../config.js';
import type { GHIIRecord } from '../storage/interface.js';

export interface VerifiableCredential {
  '@context': string[];
  type: string[];
  issuer: string;
  issuanceDate: string;
  credentialSubject: Record<string, unknown>;
}

export interface VcIssuerService {
  issueIdentityCredential(ghiiRecord: GHIIRecord): VerifiableCredential;
  issueSignedCredential(ghiiRecord: GHIIRecord): Promise<string>;
  getIssuerDid(): string;
  getPublicJwk(): Promise<JsonWebKey>;
}

export function createVcIssuerService(
  config: AimeatConfig,
  nodeKeyPair: { publicKey: string; privateKey: string } | null,
): VcIssuerService {
  const issuerDid = config.vcIssuerDid || `did:web:${config.nodeId}.aimeat.example`;

  function buildCredentialPayload(ghiiRecord: GHIIRecord): VerifiableCredential {
    return {
      '@context': [
        'https://www.w3.org/ns/credentials/v2',
        'https://aimeat.spechops.com/ns/credentials/v1',
      ],
      type: ['VerifiableCredential', 'AIMEATIdentityCredential'],
      issuer: issuerDid,
      issuanceDate: new Date().toISOString(),
      credentialSubject: {
        id: `did:aimeat:${ghiiRecord.ghii}`,
        type: 'AIMEATUser',
        verificationLevel: ghiiRecord.verificationLevel,
        memberSince: ghiiRecord.createdAt.split('T')[0],
        displayName: ghiiRecord.displayName,
      },
    };
  }

  async function getPrivateKey() {
    if (!nodeKeyPair) throw new Error('Node keypair not available for VC signing');
    const privateKeyBytes = Buffer.from(nodeKeyPair.privateKey, 'base64');
    const publicKeyBytes = Buffer.from(nodeKeyPair.publicKey, 'base64');
    const jwk = {
      kty: 'OKP' as const,
      crv: 'Ed25519' as const,
      x: Buffer.from(publicKeyBytes).toString('base64url'),
      d: Buffer.from(privateKeyBytes).toString('base64url'),
    };
    return importJWK(jwk, 'EdDSA');
  }

  return {
    issueIdentityCredential(ghiiRecord: GHIIRecord): VerifiableCredential {
      return buildCredentialPayload(ghiiRecord);
    },

    async issueSignedCredential(ghiiRecord: GHIIRecord): Promise<string> {
      const credential = buildCredentialPayload(ghiiRecord);
      const privateKey = await getPrivateKey();

      const now = Math.floor(Date.now() / 1000);
      const validityDays = 365;

      return new SignJWT({ vc: credential })
        .setProtectedHeader({
          alg: 'EdDSA',
          typ: 'vc+ld+jwt',
          kid: `${issuerDid}#key-1`,
        })
        .setIssuer(issuerDid)
        .setSubject(`did:aimeat:${ghiiRecord.ghii}`)
        .setNotBefore(now)
        .setExpirationTime(now + validityDays * 86400)
        .setIssuedAt(now)
        .sign(privateKey);
    },

    getIssuerDid(): string {
      return issuerDid;
    },

    async getPublicJwk(): Promise<JsonWebKey> {
      if (!nodeKeyPair) throw new Error('Node keypair not available');
      const publicKeyBytes = Buffer.from(nodeKeyPair.publicKey, 'base64');
      const jwk = {
        kty: 'OKP' as const,
        crv: 'Ed25519' as const,
        x: Buffer.from(publicKeyBytes).toString('base64url'),
      };
      return jwk;
    },
  };
}
```

- [ ] **Step 2: Update routes-loader to pass node keypair**

In `aimeat/src/server-bootstrap/routes-loader.ts`, the VC issuer is currently created as:

```typescript
const vcIssuerService = createVcIssuerService(config);
```

Change to:

```typescript
const nodeKeyPair = await storage.getNodeKey();
const vcIssuerService = createVcIssuerService(config, nodeKeyPair);
```

Note: `storage.getNodeKey()` is already available (used by `initializeNode`). If the `mountRoutes` function is not async, it already is or you may need to await inside the existing async context.

- [ ] **Step 3: Add ?format=jwt support to credential route**

In `aimeat/src/routes/verification.ts`, update the `GET /v1/ghii/:ghii/credential` handler. After the existing `const credential = vcIssuerService.issueIdentityCredential(ghiiRecord);`, add format handling:

```typescript
      const format = (req.query.format as string) ?? 'json';
      if (format === 'jwt') {
        const signedJwt = await vcIssuerService.issueSignedCredential(ghiiRecord);
        res.json(success(config.nodeId, { credential: signedJwt, format: 'vc+ld+jwt' }));
        return;
      }

      const credential = vcIssuerService.issueIdentityCredential(ghiiRecord);
      res.json(success(config.nodeId, { credential }));
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd aimeat && npx tsc --noEmit
```

Expected: Clean (0 errors).

- [ ] **Step 5: Commit**

```bash
git add aimeat/src/services/vc-issuer.ts aimeat/src/routes/verification.ts aimeat/src/server-bootstrap/routes-loader.ts
git commit -m "feat(vc): add JWT signing (vc+ld+jwt) to verifiable credential issuance"
```

---

## Task 18: VC Signing Unit Tests

**Files:**
- Create: `aimeat/test/unit/vc-issuer-signed.test.ts`

- [ ] **Step 1: Write VC signing unit tests**

Create `aimeat/test/unit/vc-issuer-signed.test.ts`:

```typescript
/**
 * @file vc-issuer-signed.test.ts
 * @description Unit tests for VC JWT signing and round-trip verification
 * @version-history
 *   v1.0.0 — 2026-05-02 — Initial test suite
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createVcIssuerService } from '../../src/services/vc-issuer.js';
import { jwtVerify, importJWK } from 'jose';
import type { AimeatConfig } from '../../src/config.js';
import type { GHIIRecord } from '../../src/storage/interface.js';
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

ed.etc.sha512Sync = (...m: Uint8Array[]) =>
  new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());

let testKeyPair: { publicKey: string; privateKey: string };

beforeAll(async () => {
  const privKey = ed.utils.randomPrivateKey();
  const pubKey = await ed.getPublicKeyAsync(privKey);
  testKeyPair = {
    publicKey: Buffer.from(pubKey).toString('base64'),
    privateKey: Buffer.from(privKey).toString('base64'),
  };
});

function makeConfig(overrides: Partial<AimeatConfig> = {}): AimeatConfig {
  return {
    nodeId: 'test-node-001',
    vcIssuerDid: 'did:web:test-node-001.aimeat.example',
    ...overrides,
  } as AimeatConfig;
}

function makeGhiiRecord(): GHIIRecord {
  return {
    ghii: 'testuser@test-node-001',
    ownerName: 'testuser',
    displayName: 'Test User',
    verificationLevel: 2,
    createdAt: '2026-01-15T10:00:00Z',
  } as GHIIRecord;
}

describe('VC Issuer — Signed Credentials', () => {
  it('issues unsigned JSON credential (backward compatible)', () => {
    const service = createVcIssuerService(makeConfig(), testKeyPair);
    const credential = service.issueIdentityCredential(makeGhiiRecord());
    expect(credential['@context']).toContain('https://www.w3.org/ns/credentials/v2');
    expect(credential.type).toContain('AIMEATIdentityCredential');
    expect(credential.issuer).toBe('did:web:test-node-001.aimeat.example');
    expect(credential.credentialSubject.displayName).toBe('Test User');
  });

  it('issues signed vc+ld+jwt credential', async () => {
    const service = createVcIssuerService(makeConfig(), testKeyPair);
    const jwt = await service.issueSignedCredential(makeGhiiRecord());
    expect(typeof jwt).toBe('string');
    expect(jwt.split('.').length).toBe(3);
  });

  it('signed JWT has correct header', async () => {
    const service = createVcIssuerService(makeConfig(), testKeyPair);
    const jwt = await service.issueSignedCredential(makeGhiiRecord());
    const [headerB64] = jwt.split('.');
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
    expect(header.alg).toBe('EdDSA');
    expect(header.typ).toBe('vc+ld+jwt');
    expect(header.kid).toBe('did:web:test-node-001.aimeat.example#key-1');
  });

  it('signed JWT round-trips: verify with public key', async () => {
    const service = createVcIssuerService(makeConfig(), testKeyPair);
    const jwt = await service.issueSignedCredential(makeGhiiRecord());
    const publicJwk = await service.getPublicJwk();
    const key = await importJWK(publicJwk, 'EdDSA');
    const { payload } = await jwtVerify(jwt, key, { algorithms: ['EdDSA'] });
    expect(payload.iss).toBe('did:web:test-node-001.aimeat.example');
    expect(payload.sub).toBe('did:aimeat:testuser@test-node-001');
    expect((payload as Record<string, unknown>).vc).toBeDefined();
  });

  it('getIssuerDid returns configured DID', () => {
    const service = createVcIssuerService(makeConfig({ vcIssuerDid: 'did:web:custom.example' } as Partial<AimeatConfig> as AimeatConfig), testKeyPair);
    expect(service.getIssuerDid()).toBe('did:web:custom.example');
  });

  it('getPublicJwk returns valid Ed25519 JWK', async () => {
    const service = createVcIssuerService(makeConfig(), testKeyPair);
    const jwk = await service.getPublicJwk();
    expect(jwk.kty).toBe('OKP');
    expect(jwk.crv).toBe('Ed25519');
    expect(jwk.x).toBeTruthy();
    expect(jwk.d).toBeUndefined();
  });

  it('throws when node keypair is null', async () => {
    const service = createVcIssuerService(makeConfig(), null);
    await expect(service.issueSignedCredential(makeGhiiRecord())).rejects.toThrow('Node keypair not available');
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
cd aimeat && npx vitest run test/unit/vc-issuer-signed.test.ts
```

Expected: All 7 tests pass.

- [ ] **Step 3: Commit**

```bash
git add aimeat/test/unit/vc-issuer-signed.test.ts
git commit -m "test(vc): add VC JWT signing unit tests with round-trip verification"
```

---

## Task 19: DID Document Service and Route

**Files:**
- Create: `aimeat/src/services/did-document.ts`
- Modify: `aimeat/src/server-bootstrap/routes-loader.ts`

- [ ] **Step 1: Create DID Document service**

Create `aimeat/src/services/did-document.ts`:

```typescript
/**
 * @file did-document.ts
 * @description DID Document generation for the node's did:web identifier.
 *   Serves at /.well-known/did.json per the did:web specification.
 * @version-history
 *   v1.0.0 — 2026-05-02 — Initial implementation
 */

export interface DidDocument {
  '@context': string[];
  id: string;
  verificationMethod: Array<{
    id: string;
    type: string;
    controller: string;
    publicKeyJwk: JsonWebKey;
  }>;
  authentication: string[];
  assertionMethod: string[];
}

export interface DidDocumentService {
  getDocument(): DidDocument;
}

export function createDidDocumentService(
  issuerDid: string,
  publicJwk: JsonWebKey,
): DidDocumentService {
  const keyId = `${issuerDid}#key-1`;

  const document: DidDocument = {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/jwk/v1',
    ],
    id: issuerDid,
    verificationMethod: [{
      id: keyId,
      type: 'JsonWebKey',
      controller: issuerDid,
      publicKeyJwk: publicJwk,
    }],
    authentication: [keyId],
    assertionMethod: [keyId],
  };

  return {
    getDocument(): DidDocument {
      return document;
    },
  };
}
```

- [ ] **Step 2: Add /.well-known/did.json route in routes-loader**

In `aimeat/src/server-bootstrap/routes-loader.ts`, add the import:

```typescript
import { createDidDocumentService } from '../services/did-document.js';
```

After the `vcIssuerService` creation, add:

```typescript
  // DID Document service + well-known route
  if (nodeKeyPair) {
    const publicJwk = await vcIssuerService.getPublicJwk();
    const didDocService = createDidDocumentService(vcIssuerService.getIssuerDid(), publicJwk);
    app.get('/.well-known/did.json', (_req, res) => {
      res.json(didDocService.getDocument());
    });
  }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd aimeat && npx tsc --noEmit
```

Expected: Clean (0 errors).

- [ ] **Step 4: Commit**

```bash
git add aimeat/src/services/did-document.ts aimeat/src/server-bootstrap/routes-loader.ts
git commit -m "feat(did): add DID Document service and /.well-known/did.json route"
```

---

## Task 20: DID Document Unit Tests

**Files:**
- Create: `aimeat/test/unit/did-document.test.ts`

- [ ] **Step 1: Write DID Document unit tests**

Create `aimeat/test/unit/did-document.test.ts`:

```typescript
/**
 * @file did-document.test.ts
 * @description Unit tests for DID Document generation
 * @version-history
 *   v1.0.0 — 2026-05-02 — Initial test suite
 */

import { describe, it, expect } from 'vitest';
import { createDidDocumentService } from '../../src/services/did-document.js';

const TEST_DID = 'did:web:test-node-001.aimeat.example';
const TEST_JWK: JsonWebKey = {
  kty: 'OKP',
  crv: 'Ed25519',
  x: 'test-base64url-public-key',
};

describe('DID Document Service', () => {
  it('returns a valid DID Document structure', () => {
    const service = createDidDocumentService(TEST_DID, TEST_JWK);
    const doc = service.getDocument();
    expect(doc['@context']).toContain('https://www.w3.org/ns/did/v1');
    expect(doc['@context']).toContain('https://w3id.org/security/jwk/v1');
    expect(doc.id).toBe(TEST_DID);
  });

  it('contains one verification method with the correct key', () => {
    const service = createDidDocumentService(TEST_DID, TEST_JWK);
    const doc = service.getDocument();
    expect(doc.verificationMethod).toHaveLength(1);
    const vm = doc.verificationMethod[0];
    expect(vm.id).toBe(`${TEST_DID}#key-1`);
    expect(vm.type).toBe('JsonWebKey');
    expect(vm.controller).toBe(TEST_DID);
    expect(vm.publicKeyJwk).toEqual(TEST_JWK);
  });

  it('references the key in authentication and assertionMethod', () => {
    const service = createDidDocumentService(TEST_DID, TEST_JWK);
    const doc = service.getDocument();
    expect(doc.authentication).toContain(`${TEST_DID}#key-1`);
    expect(doc.assertionMethod).toContain(`${TEST_DID}#key-1`);
  });

  it('does not include private key material', () => {
    const service = createDidDocumentService(TEST_DID, TEST_JWK);
    const doc = service.getDocument();
    const jwk = doc.verificationMethod[0].publicKeyJwk;
    expect(jwk.d).toBeUndefined();
  });

  it('uses custom DID when provided', () => {
    const customDid = 'did:web:my-custom-node.example.com';
    const service = createDidDocumentService(customDid, TEST_JWK);
    const doc = service.getDocument();
    expect(doc.id).toBe(customDid);
    expect(doc.verificationMethod[0].id).toBe(`${customDid}#key-1`);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
cd aimeat && npx vitest run test/unit/did-document.test.ts
```

Expected: All 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add aimeat/test/unit/did-document.test.ts
git commit -m "test(did): add DID Document unit tests"
```

---

## Task 21: Mock OIDC Broker for E2E Tests

**Files:**
- Create: `aimeat/test/helpers/mock-oidc-broker.ts`

- [ ] **Step 1: Create mock OIDC broker**

Create `aimeat/test/helpers/mock-oidc-broker.ts`:

```typescript
/**
 * @file mock-oidc-broker.ts
 * @description Minimal OIDC provider on a random port for FTN E2E tests.
 *   Serves discovery, JWKS, and token endpoints.
 * @version-history
 *   v1.0.0 — 2026-05-02 — Initial mock
 */

import * as http from 'node:http';
import * as jose from 'jose';

export interface MockBroker {
  url: string;
  port: number;
  publicJwk: JsonWebKey;
  close(): Promise<void>;
}

export async function startMockOidcBroker(claims: Record<string, unknown> = {}): Promise<MockBroker> {
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256');
  const publicJwk = await jose.exportJWK(publicKey);
  publicJwk.kid = 'test-key-1';
  publicJwk.use = 'sig';

  let port = 0;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, `http://localhost:${port}`);

    if (url.pathname === '/.well-known/openid-configuration') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        issuer: `http://localhost:${port}`,
        authorization_endpoint: `http://localhost:${port}/authorize`,
        token_endpoint: `http://localhost:${port}/token`,
        jwks_uri: `http://localhost:${port}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        scopes_supported: ['openid', 'profile', 'personal_identity_code'],
      }));
      return;
    }

    if (url.pathname === '/jwks') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }

    if (url.pathname === '/token' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks).toString();
      const params = new URLSearchParams(body);
      const nonce = params.get('nonce') ?? undefined;

      const idToken = await new jose.SignJWT({
        sub: 'test-subject-001',
        name: 'Test Testinen',
        given_name: 'Test',
        family_name: 'Testinen',
        birthdate: '1990-06-15',
        personal_identity_code: '150690-123A',
        nonce,
        ...claims,
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
        .setIssuer(`http://localhost:${port}`)
        .setAudience(params.get('client_id') ?? 'test-client')
        .setExpirationTime('1h')
        .setIssuedAt()
        .sign(privateKey);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        access_token: 'mock-access-token',
        token_type: 'Bearer',
        id_token: idToken,
        expires_in: 3600,
      }));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    publicJwk,
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close(err => err ? reject(err) : resolve())
      );
    },
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd aimeat && npx tsc --noEmit
```

Expected: Clean (0 errors).

- [ ] **Step 3: Commit**

```bash
git add aimeat/test/helpers/mock-oidc-broker.ts
git commit -m "test(ftn): add mock OIDC broker for E2E tests"
```

---

## Task 22: E2E Verification Test Suite

**Files:**
- Create: `aimeat/test/e2e-verification.ts`

- [ ] **Step 1: Create the E2E verification test suite**

Create `aimeat/test/e2e-verification.ts` following the existing E2E pattern (top-level await, manual test runner, BASE from env):

```typescript
/**
 * @file e2e-verification.ts
 * @description E2E tests for EUDIW/FTN identity verification, VC issuance, and DID Document.
 *   Tests nonce lifecycle, SD-JWT verification, FTN OIDC flow (mocked broker),
 *   signed VC issuance, and DID Document serving.
 * @version-history
 *   v1.0.0 — 2026-05-02 — Initial E2E suite
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import * as jose from 'jose';
import { generateTestKeyPair, createTestSdJwt } from './helpers/test-sd-jwt.js';

ed.etc.sha512Sync = (...m: Uint8Array[]) =>
  new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`  ❌ ${name}: ${err.message}`);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function api(path: string, opts: RequestInit = {}): Promise<any> {
  const url = `${BASE}${path}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers as Record<string, string> ?? {}) };
  const res = await fetch(url, { ...opts, headers });
  const data = await res.json() as any;
  return { ...data, _status: res.status };
}

async function authApi(path: string, jwt: string, opts: RequestInit = {}): Promise<any> {
  return api(path, { ...opts, headers: { ...(opts.headers as Record<string, string> ?? {}), Authorization: `Bearer ${jwt}` } });
}

// ─── State ───
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const username = `verifytest-${Date.now()}`;
const password = 'VerifyPass123';
let ownerJwt = '';
let ownerPrivKey = '';

console.log(`\n=== AIMEAT Verification E2E Test ===\n`);
console.log(`Server: ${BASE}`);
console.log(`Username: ${username}\n`);

// ─── Phase 1: Setup ───
console.log('Phase 1 — Setup');

await test('register test owner', async () => {
  const data = await api('/v1/ghii', {
    method: 'POST',
    body: JSON.stringify({ username, display_name: 'Verify Test User', password }),
  });
  assert(data.ok === true, `Registration failed: ${data.error?.message}`);
  ownerPrivKey = data.data.private_key;
});

await test('login to get JWT', async () => {
  const data = await api('/v1/ghii/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  assert(data.ok === true, `Login failed: ${data.error?.message}`);
  ownerJwt = data.data.token;
});

// ─── Phase 7: DID Document ───
console.log('\nPhase 7 — DID Document');

await test('GET /.well-known/did.json returns valid DID Document', async () => {
  const res = await fetch(`${BASE}/.well-known/did.json`);
  assert(res.status === 200, `Expected 200, got ${res.status}`);
  const doc = await res.json() as any;
  assert(doc['@context']?.includes('https://www.w3.org/ns/did/v1'), 'Missing DID context');
  assert(doc.id?.startsWith('did:web:'), 'DID does not start with did:web:');
  assert(doc.verificationMethod?.length >= 1, 'No verification methods');
  assert(doc.verificationMethod[0].publicKeyJwk?.kty === 'OKP', 'Not Ed25519 key');
});

// ─── Phase 6: VC Issuance ───
console.log('\nPhase 6 — VC Issuance');

await test('GET /v1/ghii/:ghii/credential?format=json returns unsigned VC', async () => {
  const ghii = `${username}@${NODE_ID}`;
  const data = await authApi(`/v1/ghii/${encodeURIComponent(ghii)}/credential?format=json`, ownerJwt);
  assert(data.ok === true, `Failed: ${data.error?.message}`);
  assert(data.data.credential['@context']?.length >= 2, 'Missing contexts');
  assert(data.data.credential.type?.includes('AIMEATIdentityCredential'), 'Wrong credential type');
});

await test('GET /v1/ghii/:ghii/credential?format=jwt returns signed JWT', async () => {
  const ghii = `${username}@${NODE_ID}`;
  const data = await authApi(`/v1/ghii/${encodeURIComponent(ghii)}/credential?format=jwt`, ownerJwt);
  assert(data.ok === true, `Failed: ${data.error?.message}`);
  assert(data.data.format === 'vc+ld+jwt', 'Wrong format label');
  const jwt = data.data.credential;
  assert(typeof jwt === 'string' && jwt.split('.').length === 3, 'Not a valid JWT');

  // Verify the JWT signature against the DID Document key
  const didRes = await fetch(`${BASE}/.well-known/did.json`);
  const didDoc = await didRes.json() as any;
  const publicJwk = didDoc.verificationMethod[0].publicKeyJwk;
  const key = await jose.importJWK(publicJwk, 'EdDSA');
  const { payload } = await jose.jwtVerify(jwt, key, { algorithms: ['EdDSA'] });
  assert(payload.iss?.toString().startsWith('did:web:'), 'JWT issuer not a did:web');
  assert((payload as any).vc !== undefined, 'JWT payload missing vc claim');
});

// ─── Phase 9: Cleanup ───
console.log('\nPhase 9 — Cleanup');

await test('cascade delete test owner', async () => {
  const data = await authApi(`/v1/owners/${username}`, ownerJwt, { method: 'DELETE' });
  assert(data._status === 200 || data._status === 204, `Cleanup failed: ${data._status}`);
});

// ─── Summary ───
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

Note: The EUDIW SD-JWT phases (2, 3) and FTN phases (4, 5) require EUDIW/FTN to be enabled on the test server and are best tested when the full feature is wired. The DID Document (phase 7), VC issuance (phase 6), and cleanup (phase 9) can run immediately. The SD-JWT and FTN phases should be expanded once the full integration is verified to work.

- [ ] **Step 2: Run the E2E test to verify basic phases pass**

```bash
cd aimeat && AIMEAT_PORT=40251 npx tsx test/e2e-verification.ts
```

Expected: Phase 1 (setup), Phase 6 (VC), Phase 7 (DID), and Phase 9 (cleanup) pass. EUDIW/FTN phases are skipped if not enabled on the test server.

- [ ] **Step 3: Commit**

```bash
git add aimeat/test/e2e-verification.ts
git commit -m "test(eudiw): add E2E verification test suite (DID, VC, setup/cleanup phases)"
```

---

## Task 23: Run Full Test Suite

**Files:** None (validation only)

- [ ] **Step 1: Run TypeScript type check**

```bash
cd aimeat && npx tsc --noEmit
```

Expected: Clean (0 errors).

- [ ] **Step 2: Run lint**

```bash
pnpm lint
```

Expected: Clean.

- [ ] **Step 3: Run all unit tests**

```bash
cd aimeat && npx vitest run
```

Expected: All unit tests pass (existing + new).

- [ ] **Step 4: Run E2E tests on memory backend**

```bash
pnpm test:e2e
```

Expected: All tests pass including e2e-verification.

- [ ] **Step 5: Run E2E tests on SQLite backend**

```bash
pnpm test:e2e:sqlite
```

Expected: All tests pass.

- [ ] **Step 6: Run E2E tests on MongoDB backend**

```bash
pnpm test:e2e:mongodb
```

Expected: All tests pass.

- [ ] **Step 7: Fix any failures discovered during testing**

If any test failures occur, fix them before proceeding. This may require adjusting:
- SD-JWT library API usage (if `@sd-jwt/decode` API differs from expected)
- OIDC client configuration
- Nonce serialization in storage providers
- Type assertions in route handlers

---

## Task 24: Final Documentation Update

**Files:**
- Modify: `aimeat/docs/aimeat-eudiw-integration.md`
- Modify: `aimeat/docs/aimeat-vc-spec.md`

- [ ] **Step 1: Update EUDIW integration guide to reflect completed implementation**

In `aimeat/docs/aimeat-eudiw-integration.md`, replace the "Reference Implementation Notes" section (lines 106-114) with:

```markdown
## Implementation Status

The EUDIW integration implements cryptographically complete verification:

- **SD-JWT parsing and signature verification** -- VP tokens are decoded and cryptographically verified against trusted issuer public keys (JWK format). Supports ES256 and EdDSA algorithms.
- **Nonce/state validation** -- All verification flows use database-backed nonces with configurable TTL for CSRF protection and replay prevention.
- **FTN integration** -- Generic OIDC client supporting any FTN broker (Signicat, DVV/Suomi.fi, Telia). Configurable via `AIMEAT_FTN_PROVIDER_URL`, `AIMEAT_FTN_CLIENT_ID`, `AIMEAT_FTN_CLIENT_SECRET`.
- **Multi-country eID support** -- The national PID claim name is configurable via `AIMEAT_NATIONAL_EID_PID_CLAIM` (Finland: `personal_identity_code`, Sweden: `personalNumber`, Denmark: `dk.cpr`).
- **Trusted issuer validation** -- Issuer signatures are verified against public keys stored as JWK in the trusted issuer registry.

**Production deployment requires:**
- Registering with a licensed FTN broker to obtain OIDC client credentials
- Configuring trusted issuers with their real public keys (JWK format)
- For EUDIW: registering as a verifier with the EUDIW infrastructure
```

- [ ] **Step 2: Update VC spec to reflect signed credentials**

In `aimeat/docs/aimeat-vc-spec.md`, replace the "Reference Implementation Notes" section (lines 120-129) with:

```markdown
## Implementation Status

- **Signed JWT format** -- Credentials are issued as `vc+ld+jwt` signed with the node's Ed25519 keypair. Use `?format=jwt` on the credential endpoint.
- **Unsigned JSON** -- Also available as `?format=json` (default) for backward compatibility.
- **DID Document published** -- The node's `did:web` DID Document is served at `/.well-known/did.json`, containing the public key for signature verification.
- **MyData consent receipts** -- KI-CR v1.1.0 format with Finnish jurisdiction.

**Not yet implemented:**
- Credential revocation via W3C Bitstring Status List
- SD-JWT issuance (selective disclosure for issued credentials)
- Data Integrity proof format
```

- [ ] **Step 3: Commit**

```bash
git add aimeat/docs/aimeat-eudiw-integration.md aimeat/docs/aimeat-vc-spec.md
git commit -m "docs: update EUDIW and VC specs to reflect completed implementation"
```

---

## Summary

| Phase | Tasks | Key deliverables |
|-------|-------|-----------------|
| **1: Infrastructure** | Tasks 1-7 | Dependencies, config fields, nonce storage (SQLite + MongoDB), cleanup job, nonce unit tests |
| **2a: EUDIW** | Tasks 8-12 | SD-JWT verifier service, test helper, unit tests, eudiw.ts rewrite, nonce validation in routes |
| **2b: FTN** | Tasks 13-16 | OIDC client service, FTN routes, unit tests, OpenAPI spec |
| **3: VC + DID** | Tasks 17-20 | VC JWT signing, DID Document service, `/.well-known/did.json`, unit tests |
| **4: E2E + Docs** | Tasks 21-24 | Mock OIDC broker, E2E test suite, full test run, documentation updates |

Phases 2a and 2b are independent and can be parallelized. Total: 24 tasks.
