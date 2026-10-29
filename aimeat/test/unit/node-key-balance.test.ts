/**
 * @file node-key-balance.test.ts
 * @description A node's own OpenRouter key at its spending limit (UX review 2026-10-29, A1).
 *
 *   A customer node's AI allowance is its key's limit on OpenRouter. OpenRouter answers 403 "Key
 *   limit exceeded" once it is reached (measured by aimeat-commercial on 2026-10-29 with a key capped
 *   at $0.01), and the free router still answers. Four things have to hold: that answer reads as a
 *   spent key and not a refused one; a spent node key is refused before the next call with the
 *   person's notice and its three ways on; the free model takes over only when the person turned it
 *   on; and a raised limit is seen without a restart.
 *
 *   The node's OpenRouter address points at a local stand-in that answers GET /key, the way the
 *   sandbox does (AIMEAT_AI_FIXED_BASEURL_OVERRIDES).
 * @usage cd aimeat && pnpm vitest run test/unit/node-key-balance.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, GHIIRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { loadCatalog } from '../../src/services/ai/catalog/store.js';
import { prepareAiCall } from '../../src/services/ai/completion.js';
import { providerStatusError, isNoCreditFailure } from '../../src/services/ai/errors.js';
import { classifyFailure } from '../../src/services/ai/route-run.js';
import { allowanceShown, markNodeKeySpent, nodeKeySpent, readNodeKeyBalance, resetNodeKeyBalanceForTests } from '../../src/services/ai/node-key-balance.js';
import { setRouting } from '../../src/services/ai/routing.js';

const NODE = 'node-balance';
const KEY_LIMIT_WORDS = 'Key limit exceeded (total limit). Manage it using https://openrouter.ai/workspaces/default/keys/abc123 $0.02 of $0.01 used; does not reset.';

/** The stand-in's key: no limit until a test sets one. */
const key: { limit: number | null; usage: number } = { limit: null, usage: 0 };
let server: Server;
let base: AimeatConfig;

beforeAll(async () => {
  process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = 'true';
  server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/v1/key') {
      res.end(JSON.stringify({ data: { limit: key.limit, usage: key.usage, limit_remaining: key.limit === null ? null : Math.max(0, key.limit - key.usage) } }));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  base = {
    ...loadConfig().config, nodeId: NODE, securityProfile: 'local',
    openrouterInstanceKey: 'sk-node-never-sent', chatFreeAllowanceUsd: 1000,
    aiNodeKeyWhenSpent: 'refuse', modelFreeFallback: 'openrouter/free', aiFreeModelLastResort: true,
    // A paid default, as a customer node has: a call on the free model itself runs on a spent key.
    modelDefaultChat: 'anthropic/claude-opus-4.1', modelDefaultExecution: 'anthropic/claude-opus-4.1',
    aiFixedBaseUrlOverrides: JSON.stringify({ openrouter: `http://127.0.0.1:${port}/api/v1` }),
    siteLinks: { ...loadConfig().config.siteLinks, storeTopup: 'https://shop.example/?topup=seat1' },
  } as AimeatConfig;
});
afterAll(() => { server.close(); });
beforeEach(() => { resetNodeKeyBalanceForTests(); key.limit = null; key.usage = 0; vi.useRealTimers(); });

let n = 0;
async function owner(): Promise<{ storage: Storage; gaii: string }> {
  const storage = new SqliteStorage(':memory:') as unknown as Storage;
  const name = `alice${n++}`;
  const gaii = `${name}@${NODE}`;
  const now = new Date().toISOString();
  await storage.createGHII({ username: name, nodeId: NODE, ghii: gaii, displayName: name, verificationLevel: 0, ownerName: name, createdAt: now, updatedAt: now, totpEnabled: false } as GHIIRecord);
  await loadCatalog(storage, base);
  return { storage, gaii };
}

describe('OpenRouter\'s answer for a key at its limit', () => {
  it('is a spent key (PROVIDER_NO_CREDIT), not a refused one, and its message leaves out the management address', () => {
    const e = providerStatusError(403, KEY_LIMIT_WORDS);
    expect(e.code).toBe('PROVIDER_NO_CREDIT');
    expect(e.message).not.toMatch(/openrouter\.ai\/workspaces/);
    expect(e.details?.provider_message).toMatch(/Key limit exceeded/);
    expect(isNoCreditFailure(e)).toBe(true);
  });

  it('leaves any other 403 a refused key', () => {
    expect(providerStatusError(403, 'Forbidden').code).toBe('INVALID_API_KEY');
    expect(isNoCreditFailure({ status: 403, providerMessage: 'Forbidden' })).toBe(false);
  });

  it('is not an auth failure on the route, so the provider is not skipped as broken', () => {
    expect(classifyFailure({ status: 403, providerMessage: KEY_LIMIT_WORDS })).toBe('bad_request');
    expect(classifyFailure({ status: 403, providerMessage: 'Forbidden' })).toBe('auth');
  });
});

describe('a spent node key', () => {
  it('refuses the next call before it is made, with the person\'s notice and the three ways on', async () => {
    const { storage, gaii } = await owner();
    await setRouting(storage, gaii, { rules: { freeModelLastResort: null } }, [], { kind: 'owner' });
    key.limit = 0.01; key.usage = 0.02;
    markNodeKeySpent();
    const out = prepareAiCall(storage, base, gaii, { caller: 'chat', appId: 'llm-proxy', lang: { chosen: 'fi' } });
    await expect(out).rejects.toMatchObject({ code: 'AI_BALANCE_SPENT', status: 402 });
    const err = await out.catch((e) => e);
    expect(String(err.details.fix)).toMatch(/Tekoälysaldosi on käytetty/);
    const kinds = (err.details.choices as Array<{ kind: string; url?: string }>).map((c) => c.kind);
    expect(kinds).toEqual(['buy', 'own_key', 'free_model']);
    expect(err.details.choices[0].url).toBe('https://shop.example/?topup=seat1&lang=fi');
  });

  it('does not fall to the free model on the node\'s default: the person chooses it', async () => {
    const { storage, gaii } = await owner();
    key.limit = 0.01; key.usage = 0.02;
    markNodeKeySpent();
    // aiFreeModelLastResort is true on this node, and the account has said nothing.
    await expect(prepareAiCall(storage, base, gaii, { caller: 'chat', appId: 'llm-proxy' })).rejects.toMatchObject({ code: 'AI_BALANCE_SPENT' });
  });

  it('runs on the free model once the person turned it on', async () => {
    const { storage, gaii } = await owner();
    await setRouting(storage, gaii, { rules: { freeModelLastResort: true } }, [], { kind: 'owner' });
    key.limit = 0.01; key.usage = 0.02;
    markNodeKeySpent();
    const plan = await prepareAiCall(storage, base, gaii, { caller: 'chat', appId: 'llm-proxy' });
    expect(plan.model).toBe('openrouter/free');
    expect(plan.keyScope).toBe('node');
  });

  it('is seen to have money again after a top-up, without a restart', async () => {
    key.limit = 0.01; key.usage = 0.02;
    markNodeKeySpent();
    expect(await nodeKeySpent(base)).toBe(true);
    key.limit = 10;   // the store raised the limit on OpenRouter
    vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ['Date'] });
    expect(await nodeKeySpent(base)).toBe(false);
  });

  it('is asked about at most once a minute while it stays spent', async () => {
    key.limit = 0.01; key.usage = 0.02;
    markNodeKeySpent();
    key.limit = 10;
    // Within the minute the answer is the one already known: no question to OpenRouter.
    expect(await nodeKeySpent(base)).toBe(true);
  });
});

describe('the balance a page shows', () => {
  it('is the key\'s limit, use and what is left', async () => {
    key.limit = 10; key.usage = 2.5;
    const b = await readNodeKeyBalance(base, { fresh: true });
    expect(b).toMatchObject({ limitUsd: 10, usageUsd: 2.5, remainingUsd: 7.5 });
    expect(await nodeKeySpent(base)).toBe(false);
  });

  it('is what the key has left when that is less than the allowance, and low below a tenth', async () => {
    key.limit = 10; key.usage = 9.5;
    expect(await allowanceShown(base, 1000)).toEqual({ remainingUsd: 0.5, low: true });
    resetNodeKeyBalanceForTests();
    key.usage = 2;
    expect(await allowanceShown(base, 1000)).toEqual({ remainingUsd: 8, low: false });
    resetNodeKeyBalanceForTests();
    key.limit = null;   // a key with no limit: the allowance is the answer
    expect(await allowanceShown(base, 3)).toEqual({ remainingUsd: 3, low: false });
  });

  it('marks the key spent when nothing is left', async () => {
    key.limit = 10; key.usage = 10;
    await readNodeKeyBalance(base, { fresh: true });
    expect(await nodeKeySpent(base)).toBe(true);
  });
});
