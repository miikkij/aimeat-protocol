/**
 * @file test/unit/decide-providers.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pure half of the decision providers (services/decide/providers.ts): what a
 *   provider record may say, what it cannot carry, and when a provider on this machine is reachable.
 * @version-history
 *   v1.3.0 — 2026-09-24 — The built-in laya and von send AIMEAT_DECIDE_LAYA_KEY and _VON_KEY as a
 *     bearer when set and nothing when unset; jeff's and an operator's variable stay required; with
 *     laya or von as the default the model stays available without a TypeSafe key.
 *   v1.2.0 — 2026-09-23 — The operator's egress list: exact origins only, the node's providers only,
 *     and a listed container address may be local.
 *   v1.1.0 — 2026-09-23 — A refusal names the provider as the page does, says a length in
 *     characters, and carries the fields a page writes it from in its own language.
 *   v1.0.0 — 2026-09-23 — Initial.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import {
  parseProvider, providerViolations, assertProviderReachable, providerAllowOrigins, providerEgressOrigins,
  envKeyOf, takesNoOwnerKey, providerView, BUILTIN_PROVIDERS, type DecisionProvider,
} from '../../src/services/decide/providers.js';
import { callSystemOne, type SystemOneFetch, type SystemOneRequest } from '../../src/services/decide/systemone-client.js';
import { decideAvailableFor } from '../../src/services/decide/settings.js';
import type { Storage } from '../../src/storage/interface.js';

const local = (over: Record<string, unknown> = {}) => ({
  id: 'mine', kind: 'local', url: 'http://127.0.0.1:8801/v1/systemone', model: 'multilingual', auth: { type: 'none' },
  limits: { context_tokens: 1024, max_choice_options: 3 }, ...over,
});

describe('parseProvider', () => {
  it('reads a local provider: no price, nothing leaves, and it says so', () => {
    const p = parseProvider(local(), 'owner', { allowEnv: false });
    expect(p.problems).toEqual([]);
    expect(p.provider).toMatchObject({ kind: 'local', pricePerMtok: 0, leaves: false, source: 'owner' });
    expect(p.provider?.dataStatement).toContain('does not leave');
  });

  it('refuses what an owner may not say: an env variable, a priced local model, a hosted model over http', () => {
    const env = parseProvider(local({ auth: { type: 'env', env: 'AIMEAT_TYPESAFE_INSTANCE_KEY' } }), 'owner', { allowEnv: false });
    expect(env.provider).toBeNull();
    const priced = parseProvider(local({ price_per_mtok: 1 }), 'owner', { allowEnv: false });
    expect(priced.provider).toBeNull();
    const http = parseProvider(local({ kind: 'hosted' }), 'owner', { allowEnv: false });
    expect(http.problems.join(' ')).toContain('https');
    const creds = parseProvider(local({ url: 'http://user:pw@127.0.0.1:8801/v1/systemone' }), 'owner', { allowEnv: false });
    expect(creds.provider).toBeNull();
  });

  // `kind` is not a description, it is the switch: `leaves: false` skips an app's data-map row, tells
  // the person nothing left the machine, and leaves the call out of the budget and the ledger.
  // Declared and unchecked, `local` with a remote address made all four untrue at once.
  it('refuses a "local" provider that is not on this machine', () => {
    const away = parseProvider(local({ url: 'http://collector.example.com/v1/systemone' }), 'owner', { allowEnv: false });
    expect(away.provider).toBeNull();
    expect(away.problems.join(' ')).toContain('on this machine');
    const alsoAway = parseProvider(local({ url: 'https://collector.example.com/v1/systemone' }), 'node', { allowEnv: true });
    expect(alsoAway.provider).toBeNull();
    for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
      const near = parseProvider(local({ url: `http://${host}:8801/v1/systemone` }), 'owner', { allowEnv: false });
      expect(near.provider, host).not.toBeNull();
      expect(near.provider?.leaves).toBe(false);
    }
  });

  it('lets the operator name a variable, and names only known adapters', () => {
    expect(parseProvider(local({ auth: { type: 'env', env: 'MY_KEY' } }), 'node', { allowEnv: true }).provider?.auth).toEqual({ type: 'env', env: 'MY_KEY' });
    expect(parseProvider(local({ adapter: 'laya' }), 'owner', { allowEnv: false }).provider?.adapter).toBe('laya');
    expect(parseProvider(local({ adapter: 'mystery' }), 'owner', { allowEnv: false }).provider).toBeNull();
  });
});

describe('providerViolations', () => {
  const p = parseProvider(local(), 'owner', { allowEnv: false }).provider as DecisionProvider;

  it('names the provider and its own number', () => {
    const v = providerViolations(p, 'x', { team: { type: 'choice', instructions: 'Which?', criteria: { a: null, b: null, c: null, d: null } } });
    expect(v).toHaveLength(1);
    // The page writes the refusal in its own language from these fields, with the name it shows.
    expect(v[0]).toMatchObject({ code: 'PROVIDER_CANNOT_CARRY', question: 'team', what: 'options', limit: 3, count: 4, provider: 'mine', providerTitle: 'mine' });
    expect(v[0].message).toContain('"mine" carries 3 options');
    expect(v[0].message).toContain('has 4');
  });

  it('refuses a state longer than the provider reads, in characters as the page says it, and passes one that fits', () => {
    const long = providerViolations(p, 'x'.repeat(8000), { q: { type: 'noul', instructions: 'Yes?' } })[0];
    expect(long?.message).toContain('reads about 4096 characters');
    expect(long).toMatchObject({ what: 'length', limit: 4096 });
    expect(providerViolations(p, 'short', { q: { type: 'noul', instructions: 'Yes?' } })).toEqual([]);
  });
});

describe('assertProviderReachable', () => {
  const saved = { egress: process.env.AIMEAT_ALLOW_PRIVATE_EGRESS, dev: process.env.AIMEAT_DEV_MODE };
  afterEach(() => {
    if (saved.egress === undefined) delete process.env.AIMEAT_ALLOW_PRIVATE_EGRESS; else process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = saved.egress;
    if (saved.dev === undefined) delete process.env.AIMEAT_DEV_MODE; else process.env.AIMEAT_DEV_MODE = saved.dev;
  });

  const laya = { ...BUILTIN_PROVIDERS.laya, source: 'builtin' } as DecisionProvider;
  const cfg = (egress: string) => ({ decideProviderEgress: egress }) as AimeatConfig;

  // Changed 2026-09-23 on purpose: the node's own provider is now told the narrow fix (its origin in
  // AIMEAT_DECIDE_PROVIDER_EGRESS), not the wide one that opens loopback to every fetch.
  it('refuses a provider on this machine by name, naming the address to list', () => {
    process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = 'false';
    delete process.env.AIMEAT_DEV_MODE;
    expect(() => assertProviderReachable(laya, cfg(''))).toThrow(/adding http:\/\/127\.0\.0\.1:8801 to AIMEAT_DECIDE_PROVIDER_EGRESS/);
    process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = 'true';
    expect(() => assertProviderReachable(laya)).not.toThrow();
  });

  it('reaches the node\'s own provider at a listed origin with private egress off', () => {
    process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = 'false';
    delete process.env.AIMEAT_DEV_MODE;
    expect(() => assertProviderReachable(laya, cfg('http://127.0.0.1:8801'))).not.toThrow();
    expect(providerAllowOrigins(laya, cfg('http://127.0.0.1:8801'))).toEqual(['http://127.0.0.1:8801']);
    // Another port of the same machine is not the same origin.
    expect(() => assertProviderReachable(laya, cfg('http://127.0.0.1:8802'))).toThrow(/PROVIDER_EGRESS|on this machine/);
  });

  it('never lets an owner\'s provider use the list, whatever it names', () => {
    process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = 'false';
    delete process.env.AIMEAT_DEV_MODE;
    const mine = parseProvider(local(), 'owner', { allowEnv: false, egress: ['http://127.0.0.1:8801'] }).provider as DecisionProvider;
    expect(providerAllowOrigins(mine, cfg('http://127.0.0.1:8801'))).toEqual([]);
    expect(() => assertProviderReachable(mine, cfg('http://127.0.0.1:8801'))).toThrow(/operator runs/);
  });
});

describe('the operator\'s egress list', () => {
  it('keeps exact origins and drops what could widen it: a path, credentials, link-local, not a URL', () => {
    const list = providerEgressOrigins({
      decideProviderEgress: ' http://127.0.0.1:8801 , http://laya:8000/, http://laya:8000/v1, http://u:p@127.0.0.1:8802, http://169.254.169.254, nonsense, https://[::1]:8803',
    } as AimeatConfig);
    expect(list).toEqual(['http://127.0.0.1:8801', 'http://laya:8000', 'https://[::1]:8803']);
  });

  it('lets an operator record name a listed container address as local, and nobody else', () => {
    const inDocker = local({ url: 'http://laya:8000/v1/systemone' });
    const op = parseProvider(inDocker, 'node', { allowEnv: true, egress: ['http://laya:8000'] });
    expect(op.provider).toMatchObject({ kind: 'local', leaves: false });
    expect(parseProvider(inDocker, 'node', { allowEnv: true }).provider).toBeNull();
    expect(parseProvider(inDocker, 'owner', { allowEnv: false, egress: ['http://laya:8000'] }).provider).toBeNull();
  });
});

// Each model is started with a key of its own (tools/systemone), and the node sends that key from a
// variable. For laya and von the variable is optional: a model started without a key, as before, is
// still asked without one, so a node updated beside an old install keeps working.
describe('the built-in local providers send the key the operator set, and none when it is unset', () => {
  const request: SystemOneRequest = { model: 'm', state: 'Pay today.', questions: { urgent: { type: 'noul', instructions: 'Urgent?' } } };
  const answer = { model: 'm', answers: { urgent: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 10, output_tokens: 1 } };
  /** The Authorization header each call carried, or null. */
  async function sentAuth(p: DecisionProvider): Promise<string | null> {
    let seen: string | null = null;
    const fetchImpl: SystemOneFetch = (_url, init) => {
      seen = new Headers(init.headers).get('authorization');
      return Promise.resolve(new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } }));
    };
    await callSystemOne({ url: p.url, key: envKeyOf(p), request, fetchImpl, ...(p.adapter ? { adapter: p.adapter } : {}) });
    return seen;
  }
  const saved = { laya: process.env.AIMEAT_DECIDE_LAYA_KEY, von: process.env.AIMEAT_DECIDE_VON_KEY, jeff: process.env.AIMEAT_DECIDE_JEFF_KEY };
  afterEach(() => {
    for (const [id, v] of Object.entries(saved)) {
      const name = `AIMEAT_DECIDE_${id.toUpperCase()}_KEY`;
      if (v === undefined) delete process.env[name]; else process.env[name] = v;
    }
  });

  for (const id of ['laya', 'von'] as const) {
    it(`${id}: set, the call carries Authorization: Bearer <key>; unset, it carries none`, async () => {
      const p = { ...BUILTIN_PROVIDERS[id], source: 'builtin' } as DecisionProvider;
      process.env[`AIMEAT_DECIDE_${id.toUpperCase()}_KEY`] = `  ${id}-key-0123456789  `;
      expect(await sentAuth(p)).toBe(`Bearer ${id}-key-0123456789`);
      delete process.env[`AIMEAT_DECIDE_${id.toUpperCase()}_KEY`];
      expect(await sentAuth(p)).toBeNull();
    });
  }

  it('jeff and an operator\'s variable stay required: unset, the call is refused before anything is sent', async () => {
    const jeff = { ...BUILTIN_PROVIDERS.jeff, source: 'builtin' } as DecisionProvider;
    delete process.env.AIMEAT_DECIDE_JEFF_KEY;
    expect(() => envKeyOf(jeff)).toThrow(/AIMEAT_DECIDE_JEFF_KEY/);
    const op = parseProvider(local({ auth: { type: 'env', env: 'MY_MODEL_KEY' } }), 'node', { allowEnv: true }).provider as DecisionProvider;
    expect(() => envKeyOf(op, {})).toThrow(/MY_MODEL_KEY/);
    process.env.AIMEAT_DECIDE_JEFF_KEY = 'jeff-key';
    expect(await sentAuth(jeff)).toBe('Bearer jeff-key');
  });

  // laya and von need no key of the OWNER's, set or not, so an owner whose provider is one of them
  // can use the decision model on a node that has no TypeSafe key at all, as before.
  it('the model stays available with laya or von as the default and no TypeSafe key anywhere', async () => {
    const storage = { getMemory: async () => null } as unknown as Storage;
    for (const id of ['laya', 'von']) {
      const config = {
        decideEnabled: true, decideInstanceKey: '', decideBuiltinProviders: 'laya,von,jeff', decideDefaultProvider: id,
        decideProviders: '', decideProviderId: 'typesafe', decideProviderKind: 'hosted', decideProviderEgress: '',
        decideBaseUrl: 'https://api.typesafe.ai/v1/systemone', decideModel: 'jev-1', decideMaxRequestTokens: 32000,
        decideMaxChoiceOptions: 240, decidePricePerMtok: 0.042,
      } as AimeatConfig;
      expect(await decideAvailableFor(storage, config, 'alice@node'), id).toEqual({ available: true, reason: null });
    }
    // The settings view reads the same answer from the provider as a door shows it.
    const view = (id: 'laya' | 'von' | 'jeff') => providerView({ ...BUILTIN_PROVIDERS[id], source: 'builtin' } as DecisionProvider).auth as { type?: unknown; optional?: unknown };
    expect([takesNoOwnerKey(view('laya')), takesNoOwnerKey(view('von')), takesNoOwnerKey(view('jeff'))]).toEqual([true, true, false]);
  });
});
