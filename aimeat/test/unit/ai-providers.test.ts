/**
 * @file test/unit/ai-providers.test.ts
 * @description System 2's provider records and the health of a provider's capability (System 2 plan,
 *   V3), apart from any node: what a record may say, where the node's own key lives, and when a
 *   failing capability is skipped and probed again. Plus the one rule every direct provider package
 *   must keep: the call carries the target's key to the target's address, never a key from the
 *   process environment (each package reads its own variable when no key is passed).
 *
 *   Case 4 of plan 09 section 3 lives here: on a public node an owner has no provider on the node's
 *   own machine.
 * @usage pnpm test -- ai-providers
 * @version-history
 *   v1.0.1 — 2026-09-28 — An address ending in a long run of slashes is parsed in one pass (CodeQL
 *     js/polynomial-redos, alert 1673).
 *   v1.0.0 — 2026-09-28 — Initial (V3 of the System 2 plan).
 */
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import { parseAiProvider, nodeAiProviders, fixedBaseUrlOf, typeAllowed } from '../../src/services/ai/providers.js';
import {
  healthKey, recordFailure, recordSuccess, skipReason, clearHealth, setClock,
} from '../../src/services/ai/health.js';
import { classifyFailure } from '../../src/services/ai/route-run.js';
import { text } from '../../src/services/ai/gateway.js';
import { startFakeAiProvider, type FakeAiProvider } from '../helpers/fake-ai-provider.js';

const cfg = (over: Record<string, unknown> = {}): AimeatConfig => ({
  securityProfile: 'local', openrouterInstanceKey: '', aiProviders: '', aiBuiltinProviders: '', aiProviderEgress: '',
  aiProviderTypes: '', aiFixedBaseUrlOverrides: '', aiProviderAllowlist: [], modelDefaultImage: '', modelDefaultStt: '',
  ...over,
} as unknown as AimeatConfig);

const owner = (raw: Record<string, unknown>, config = cfg()) => parseAiProvider({ id: 'mine', title: 'Mine', ...raw }, 'owner', config, { allowEnv: false });

describe('an owner\'s provider record', () => {
  it('local means this machine: a remote address is refused, naming why', () => {
    const r = owner({ type: 'local', baseUrl: 'https://models.example.com/v1' });
    expect(r.provider).toBeNull();
    expect(r.problems.join(' ')).toMatch(/somewhere else/);
    expect(owner({ type: 'local', baseUrl: 'http://127.0.0.1:1234/v1' }).provider?.leaves).toBe(false);
  });

  it('on a public node an owner has no provider on the node\'s own machine, local or not (case 4)', () => {
    const pub = cfg({ securityProfile: 'public' });
    for (const type of ['local', 'openai-compatible']) {
      const r = owner({ type, baseUrl: 'http://127.0.0.1:1234/v1' }, pub);
      expect(r.provider, type).toBeNull();
      expect(r.problems.join(' ')).toMatch(/public node/);
    }
  });

  it('never names a variable of the node as its key, and never holds the node\'s key', () => {
    expect(owner({ type: 'openai-compatible', baseUrl: 'https://x.example/v1', auth: { type: 'env', env: 'AIMEAT_OPENROUTER_INSTANCE_KEY' } }).provider).toBeNull();
    expect(owner({ type: 'openrouter', auth: { type: 'node' } }).provider).toBeNull();
  });

  it('a fixed type keeps its official address and needs a key', () => {
    const moved = owner({ type: 'anthropic', baseUrl: 'https://proxy.example/v1' });
    expect(moved.problems.join(' ')).toMatch(/api\.anthropic\.com/);
    expect(owner({ type: 'anthropic', auth: { type: 'none' } }).problems.join(' ')).toMatch(/needs a key/);
    const ok = owner({ type: 'anthropic' });
    expect(ok.provider?.baseUrl).toBe('https://api.anthropic.com/v1');
    expect(ok.provider?.auth.type).toBe('key');
  });

  it('an address loses its trailing slashes, and a long run of slashes costs one pass (alert 1673)', () => {
    expect(owner({ type: 'anthropic', baseUrl: 'https://api.anthropic.com/v1///', auth: { type: 'key' } }).problems.join(' ')).not.toMatch(/baseUrl/);
    expect(owner({ type: 'openai-compatible', baseUrl: 'https://x.example/v1///' }).provider?.baseUrl).toBe('https://x.example/v1');
    const started = Date.now();
    const r = owner({ type: 'anthropic', baseUrl: `https://api.anthropic.com/v1${'/'.repeat(100_000)}x` });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(r.problems.join(' ')).toMatch(/baseUrl/);
  });

  it('a capability its type does not serve is refused, naming the types that do', () => {
    const r = owner({ type: 'anthropic', capabilities: { image: { enabled: true, model: 'x' } } });
    expect(r.problems.join(' ')).toMatch(/does not serve image.*openrouter/);
  });

  it('the node picks a provider by capability alone only with a model to use', () => {
    expect(owner({ type: 'anthropic', capabilities: { text: { enabled: true, pool: true } } }).problems.join(' ')).toMatch(/set model/);
  });

  it('a fixed address can be overridden for a stub only on a node that is not public', () => {
    const over = { aiFixedBaseUrlOverrides: JSON.stringify({ anthropic: 'http://127.0.0.1:9/v1' }) };
    expect(fixedBaseUrlOf(cfg(over), 'anthropic')).toBe('http://127.0.0.1:9/v1');
    expect(fixedBaseUrlOf(cfg({ ...over, securityProfile: 'public' }), 'anthropic')).toBe('https://api.anthropic.com/v1');
  });
});

describe('the node\'s own providers', () => {
  it('the node\'s key has one provider, at OpenRouter, and it is the only record with it', () => {
    const list = nodeAiProviders(cfg({ openrouterInstanceKey: 'sk-node' }));
    const nk = list.filter(p => p.auth.type === 'node');
    expect(nk).toHaveLength(1);
    expect(nk[0]).toMatchObject({ id: 'node-openrouter', type: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' });
    expect(nodeAiProviders(cfg())).toHaveLength(0);
  });

  it('J4: an image or a transcription is on the node\'s key only with a node default model for it', () => {
    const plain = nodeAiProviders(cfg({ openrouterInstanceKey: 'sk-node' }))[0];
    expect(plain.capabilities.image).toBeUndefined();
    expect(plain.capabilities.transcription).toBeUndefined();
    const withImage = nodeAiProviders(cfg({ openrouterInstanceKey: 'sk-node', modelDefaultImage: 'x/y' }))[0];
    expect(withImage.capabilities.image?.enabled).toBe(true);
  });

  it('an operator record may not take a key in the record, and AIMEAT_AI_PROVIDER_TYPES narrows the fixed types', () => {
    const list = nodeAiProviders(cfg({ aiProviders: JSON.stringify([
      { id: 'op-a', type: 'openai-compatible', baseUrl: 'https://a.example/v1', auth: { type: 'key' } },
      { id: 'op-b', type: 'openai-compatible', baseUrl: 'https://b.example/v1', auth: { type: 'env', env: 'OP_B_KEY' } },
    ]) }));
    expect(list.map(p => p.id)).toEqual(['op-b']);
    expect(typeAllowed(cfg({ aiProviderTypes: 'openrouter,anthropic' }), 'openai')).toBe(false);
    expect(typeAllowed(cfg({ aiProviderTypes: 'openrouter,anthropic' }), 'openai-compatible')).toBe(true);
    expect(nodeAiProviders(cfg({ openrouterInstanceKey: 'sk-node', aiProviderTypes: 'anthropic' }))).toHaveLength(0);
  });
});

describe('the health of one capability', () => {
  let now = 1_000_000;
  afterEach(() => setClock(null));
  const key = healthKey('owner@n', 'p', 'text');

  it('three failures in a row: failing, skipped five minutes, then one probe; a failed probe doubles the wait', () => {
    clearHealth('owner@n', 'p');
    setClock(() => now);
    recordSuccess(key);
    expect(recordFailure(key, 'server_error')).toBe('degraded');
    recordFailure(key, 'timeout');
    expect(skipReason(key)).toBeNull();
    expect(recordFailure(key, 'unavailable')).toBe('failing');
    expect(skipReason(key)).toMatch(/3 times/);
    now += 5 * 60_000;
    expect(skipReason(key)).toBeNull();
    recordFailure(key, 'server_error');
    now += 5 * 60_000;
    expect(skipReason(key)).not.toBeNull();
    now += 5 * 60_000;
    expect(skipReason(key)).toBeNull();
    expect(recordSuccess(key)).toBe('ok');
    expect(skipReason(key)).toBeNull();
  });

  it('a refused key: failing at once, until the owner tests or changes the key', () => {
    clearHealth('owner@n', 'p');
    setClock(() => now);
    expect(recordFailure(key, 'auth')).toBe('failing');
    now += 24 * 3_600_000;
    expect(skipReason(key)).toMatch(/refused its key/);
    clearHealth('owner@n', 'p');
    expect(skipReason(key)).toBeNull();
  });

  it('a bad request or a content refusal says nothing about the provider', () => {
    clearHealth('owner@n', 'p');
    for (let i = 0; i < 5; i++) { recordFailure(key, 'content'); recordFailure(key, 'bad_request'); }
    expect(skipReason(key)).toBeNull();
  });
});

describe('what a failure is', () => {
  it('names each class the rules move on from, and the ones they never do', () => {
    expect(classifyFailure({ status: 429 })).toBe('rate_limit');
    expect(classifyFailure({ status: 503 })).toBe('unavailable');
    expect(classifyFailure({ status: 500 })).toBe('server_error');
    expect(classifyFailure({ status: 401 })).toBe('auth');
    expect(classifyFailure({ status: 403, message: 'Provider 403: your input was flagged by moderation' })).toBe('content');
    expect(classifyFailure({ status: 400, message: 'bad parameter' })).toBe('bad_request');
    expect(classifyFailure(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))).toBe('timeout');
    const cancelled = new AbortController(); cancelled.abort();
    expect(classifyFailure({ status: 503 }, cancelled.signal)).toBe('cancelled');
  });
});

describe('a direct provider package carries the target\'s key to the target\'s address, never the environment\'s', () => {
  let stub: FakeAiProvider;
  const saved: Record<string, string | undefined> = {};
  const VARS = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'XAI_API_KEY', 'MISTRAL_API_KEY', 'AIMEAT_ALLOW_PRIVATE_EGRESS'];
  beforeAll(async () => {
    for (const v of VARS) saved[v] = process.env[v];
    for (const v of VARS) process.env[v] = v.endsWith('_URL') ? 'http://127.0.0.1:9/env-address' : 'sk-from-the-environment';
    process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = 'true';
    stub = await startFakeAiProvider(0);
  });
  afterAll(async () => {
    await stub.close();
    for (const v of VARS) { if (saved[v] === undefined) delete process.env[v]; else process.env[v] = saved[v]; }
  });

  for (const type of ['openai', 'anthropic', 'xai', 'mistral'] as const) {
    it(type, async () => {
      const before = stub.requests.length;
      // The stub answers what it can; the request it recorded is the evidence either way.
      await text({ target: { type, baseUrl: `${stub.baseUrl}/${type}`, key: `sk-target-${type}` }, model: 'm', prompt: 'x', retries: 0 }).catch(() => undefined);
      const req = stub.requests[before];
      expect(req, 'the call reached the target address').toBeDefined();
      expect(req.pathname.startsWith(`/v1/${type}/`)).toBe(true);
      const sent = JSON.stringify(req.headers);
      expect(sent).toContain(`sk-target-${type}`);
      expect(sent).not.toContain('sk-from-the-environment');
    });
  }

  it('a direct type is never built without a key', async () => {
    await expect(text({ target: { type: 'anthropic', baseUrl: `${stub.baseUrl}/anthropic`, key: undefined }, model: 'm', prompt: 'x' }))
      .rejects.toMatchObject({ status: 400 });
  });
});
