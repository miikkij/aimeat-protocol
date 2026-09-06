/**
 * @file test/unit/living-hooks-lib.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pure half of `living-hooks`, tested as the bytes the sandbox runs.
 *
 *   The helpers live in a STRING, because a QuickJS script has no imports and the only way to share
 *   code between two actions is to ship the same source into both. So this file evaluates that
 *   string with `new Function` and exercises what it defines — the same move `/v1/ext-hash` makes
 *   to prove the hash it publishes is the hash the sandbox runs. There is no second copy of the
 *   allowlist matcher or the path reader to drift away from the one that ships.
 *
 *   FIRST FAIL: against the tree before living-hooks existed, this file cannot even import
 *   `LIVING_HOOKS_LIB_JS` — the module is not there. Every assertion below is new behaviour.
 * @version-history
 *   v1.0.0 — 2026-09-06 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { LIVING_HOOKS_LIB_JS } from '../../src/data/builtin-extensions/living-hooks-lib.js';
import { LIVING_HOOKS_GATE_JS } from '../../src/data/builtin-extensions/living-hooks-gate.js';
import { compareVersions, mergeOwnerConfig } from '../../src/services/builtin-extension-seeder.js';

/** The shipped source, evaluated once, exactly as the sandbox receives it. */
const lib = new Function(`
  ${LIVING_HOOKS_LIB_JS}
  ${LIVING_HOOKS_GATE_JS}
  return {
    livingHost, livingHostAllowed, livingHosts, livingPath, livingHeaderAllowed,
    livingBytes, livingSecrets, livingResolveSecret, livingShape, livingPrune,
    livingCount, livingStateKey, livingHeaders, livingRefuse,
  };
`)() as Record<string, (...args: any[]) => any>;

describe('livingHost — which host will actually be called', () => {
  it('reads the host out of an ordinary URL', () => {
    expect(lib.livingHost('https://api.example.com/v1/prices')).toBe('api.example.com');
    expect(lib.livingHost('http://EXAMPLE.com:8080/x')).toBe('example.com');
    expect(lib.livingHost('https://127.0.0.1:40665/hook')).toBe('127.0.0.1');
  });

  it('strips userinfo at the LAST @, so a host cannot be smuggled in front of the real one', () => {
    // The whole point: safeFetch will contact evil.example, so the allowlist must judge that one.
    expect(lib.livingHost('https://api.example.com@evil.example/x')).toBe('evil.example');
    expect(lib.livingHost('https://user:pw@api.example.com/x')).toBe('api.example.com');
  });

  it('keeps an IPv6 host in its brackets', () => {
    expect(lib.livingHost('http://[::1]:8080/x')).toBe('[::1]');
  });

  it('answers null for anything that is not an absolute http(s) URL', () => {
    for (const bad of ['', '   ', 'example.com/x', '/relative', 'ftp://example.com/x',
      'javascript:alert(1)', 'https://', null, undefined, 42]) {
      expect(lib.livingHost(bad)).toBeNull();
    }
  });
});

describe('livingHostAllowed — the allowlist matcher', () => {
  it('admits nothing when the list is empty, which is the default', () => {
    expect(lib.livingHostAllowed('api.example.com', [])).toBe(false);
    expect(lib.livingHostAllowed('api.example.com', null)).toBe(false);
    expect(lib.livingHostAllowed('api.example.com', undefined)).toBe(false);
  });

  it('matches an exact host, case-insensitively, and nothing else', () => {
    expect(lib.livingHostAllowed('api.example.com', ['api.example.com'])).toBe(true);
    expect(lib.livingHostAllowed('API.Example.COM', ['api.example.com'])).toBe(true);
    expect(lib.livingHostAllowed('api.example.com', [' api.example.com '])).toBe(true);
    expect(lib.livingHostAllowed('other.example.com', ['api.example.com'])).toBe(false);
    expect(lib.livingHostAllowed('example.com', ['api.example.com'])).toBe(false);
  });

  it('a leading dot admits the host itself and everything under it', () => {
    expect(lib.livingHostAllowed('example.com', ['.example.com'])).toBe(true);
    expect(lib.livingHostAllowed('api.example.com', ['.example.com'])).toBe(true);
    expect(lib.livingHostAllowed('a.b.example.com', ['.example.com'])).toBe(true);
  });

  it('refuses a host that merely ENDS in the allowed text', () => {
    // notexample.com must not pass ".example.com": the dot is the boundary, not decoration.
    expect(lib.livingHostAllowed('notexample.com', ['.example.com'])).toBe(false);
    expect(lib.livingHostAllowed('evilexample.com', ['.example.com'])).toBe(false);
    expect(lib.livingHostAllowed('example.com.evil.net', ['.example.com'])).toBe(false);
  });

  it('skips empty and non-string entries instead of matching on them', () => {
    expect(lib.livingHostAllowed('api.example.com', ['', '  ', null, undefined, 7])).toBe(false);
    expect(lib.livingHostAllowed('api.example.com', ['', 'api.example.com'])).toBe(true);
  });

  it('a bare dot allows nothing', () => {
    expect(lib.livingHostAllowed('example.com', ['.'])).toBe(false);
  });
});

describe('livingHosts — the owner list and the node list, added together', () => {
  it('takes an array from either side', () => {
    expect(lib.livingHosts({ allow_hosts: ['node.example'] }, { allow_hosts: ['mine.example'] }))
      .toEqual(['mine.example', 'node.example']);
  });

  it('accepts a comma-separated string, which is what a text field gives', () => {
    expect(lib.livingHosts({ allow_hosts: 'a.example, b.example' }, null)).toEqual(['a.example', 'b.example']);
  });

  it('is empty when neither side says anything', () => {
    expect(lib.livingHosts({}, null)).toEqual([]);
    expect(lib.livingHosts(null, null)).toEqual([]);
    expect(lib.livingHosts({ allow_hosts: 42 }, { allow_hosts: {} })).toEqual([]);
  });
});

describe('livingPath — one value out of a JSON answer', () => {
  const doc = {
    prices: [{ price: 4.2, unit: 'c/kWh' }, { price: 5.5 }],
    a: { b: { c: 'deep' } },
    'total.eur': 12,
    zero: 0,
    nil: null,
  };

  it('walks dots and brackets the way a person writes them', () => {
    expect(lib.livingPath(doc, 'prices[0].price')).toEqual({ ok: true, value: 4.2 });
    expect(lib.livingPath(doc, 'a.b.c')).toEqual({ ok: true, value: 'deep' });
    expect(lib.livingPath(doc, 'prices[1]')).toEqual({ ok: true, value: { price: 5.5 } });
  });

  it('a quoted segment reaches a key with a dot in its name', () => {
    expect(lib.livingPath(doc, "['total.eur']")).toEqual({ ok: true, value: 12 });
    expect(lib.livingPath(doc, '["total.eur"]')).toEqual({ ok: true, value: 12 });
  });

  it('an empty path is the whole document', () => {
    expect(lib.livingPath(doc, '')).toEqual({ ok: true, value: doc });
    expect(lib.livingPath(doc, undefined)).toEqual({ ok: true, value: doc });
  });

  it('a falsy value that IS there comes back', () => {
    expect(lib.livingPath(doc, 'zero')).toEqual({ ok: true, value: 0 });
    expect(lib.livingPath(doc, 'nil')).toEqual({ ok: true, value: null });
  });

  it('names the step it stopped at instead of answering undefined', () => {
    expect(lib.livingPath(doc, 'prices[9].price')).toEqual({ ok: false, at: 'prices.9' });
    expect(lib.livingPath(doc, 'a.b.missing')).toEqual({ ok: false, at: 'a.b.missing' });
    expect(lib.livingPath(doc, 'a.b.c.d')).toEqual({ ok: false, at: 'a.b.c.d' });
    expect(lib.livingPath(doc, 'prices.price')).toEqual({ ok: false, at: 'prices.price' });
  });

  it('refuses a malformed path rather than guessing at it', () => {
    expect(lib.livingPath(doc, 'prices[0').ok).toBe(false);
    expect(lib.livingPath(doc, 'prices[x]').ok).toBe(false);
    expect(lib.livingPath(doc, "prices['unclosed]").ok).toBe(false);
    expect(lib.livingPath(doc, '..').ok).toBe(false);
  });

  it('does not walk the prototype chain', () => {
    expect(lib.livingPath(doc, 'constructor').ok).toBe(false);
    expect(lib.livingPath(doc, 'a.__proto__.b').ok).toBe(false);
    expect(lib.livingPath(doc, 'a.hasOwnProperty').ok).toBe(false);
  });
});

describe('livingHeaderAllowed — which header names may leave', () => {
  it('admits the fixed set, in any case', () => {
    for (const n of ['Authorization', 'content-type', 'ACCEPT', 'X-Api-Key', 'x-requested-with']) {
      expect(lib.livingHeaderAllowed(n)).toBe(true);
    }
  });

  it('admits any X-Living- name', () => {
    expect(lib.livingHeaderAllowed('X-Living-Document')).toBe(true);
    expect(lib.livingHeaderAllowed('x-living-trigger-id')).toBe(true);
  });

  it('refuses everything else, including the near misses', () => {
    for (const n of ['Host', 'Cookie', 'Origin', 'Referer', 'x-forwarded-for', 'X-Living',
      'x-livingx', '', '   ', 'x living', 'x-living-\n', null, undefined]) {
      expect(lib.livingHeaderAllowed(n)).toBe(false);
    }
  });
});

describe('livingBytes — UTF-8 bytes, not characters', () => {
  it('counts what the wire carries', () => {
    expect(lib.livingBytes('abc')).toBe(3);
    expect(lib.livingBytes('ä')).toBe(2);
    expect(lib.livingBytes('€')).toBe(3);
    expect(lib.livingBytes('😀')).toBe(4);
    expect(lib.livingBytes('')).toBe(0);
    expect(lib.livingBytes(null)).toBe(0);
  });
});

describe('livingSecrets and livingResolveSecret — the placeholder that keeps a key out of a document', () => {
  it('reads the secret map out of the one encrypted string', () => {
    expect(lib.livingSecrets('{"KEY":"abc"}')).toEqual({ KEY: 'abc' });
    expect(lib.livingSecrets({ KEY: 'abc' })).toEqual({ KEY: 'abc' });
  });

  it('answers an empty map for anything unreadable, so a placeholder refuses by name', () => {
    expect(lib.livingSecrets('not json')).toEqual({});
    expect(lib.livingSecrets('[1,2]')).toEqual({});
    expect(lib.livingSecrets('')).toEqual({});
    expect(lib.livingSecrets(null)).toEqual({});
  });

  it('substitutes a named secret into a header value', () => {
    expect(lib.livingResolveSecret('Bearer {{secret:TOKEN}}', { TOKEN: 's3cret' }))
      .toEqual({ ok: true, value: 'Bearer s3cret' });
    expect(lib.livingResolveSecret('{{secret:A}}-{{secret:B}}', { A: '1', B: '2' }))
      .toEqual({ ok: true, value: '1-2' });
  });

  it('leaves a value with no placeholder alone', () => {
    expect(lib.livingResolveSecret('application/json', {})).toEqual({ ok: true, value: 'application/json' });
  });

  it('refuses by NAME when the secret is not set, and never half-builds the credential', () => {
    const out = lib.livingResolveSecret('Bearer {{secret:MISSING}}', { OTHER: 'x' });
    expect(out.ok).toBe(false);
    expect(out.missing).toBe('MISSING');
    expect(out.value).toBeUndefined();
  });

  it('treats an empty stored secret as not set', () => {
    expect(lib.livingResolveSecret('{{secret:E}}', { E: '' }).ok).toBe(false);
  });
});

describe('livingShape — what a read answers with', () => {
  it('raw takes a numeric body as a number', () => {
    expect(lib.livingShape('18.42', true, '')).toEqual({ ok: true, value: 18.42 });
    expect(lib.livingShape('  7 \n', true, '')).toEqual({ ok: true, value: 7 });
    expect(lib.livingShape('-3e2', true, '')).toEqual({ ok: true, value: -300 });
  });

  it('raw takes anything else as the trimmed text', () => {
    expect(lib.livingShape('  charging \n', true, '')).toEqual({ ok: true, value: 'charging' });
    expect(lib.livingShape('', true, '')).toEqual({ ok: true, value: '' });
  });

  it('without raw the body is JSON and the path picks one value out', () => {
    expect(lib.livingShape('{"prices":[{"price":4.2}]}', false, 'prices[0].price'))
      .toEqual({ ok: true, value: 4.2 });
    expect(lib.livingShape('{"a":1}', false, '')).toEqual({ ok: true, value: { a: 1 } });
  });

  it('a body that is not JSON is UPSTREAM_FAILED, not BAD_PATH', () => {
    const out = lib.livingShape('<html>nope</html>', false, 'a.b');
    expect(out.ok).toBe(false);
    expect(out.code).toBe('UPSTREAM_FAILED');
    expect(out.message).toContain('not JSON');
  });

  it('a path with nowhere to go is BAD_PATH and says where it stopped', () => {
    const out = lib.livingShape('{"a":{"b":1}}', false, 'a.c');
    expect(out.ok).toBe(false);
    expect(out.code).toBe('BAD_PATH');
    expect(out.message).toContain('a.c');
  });
});

describe('livingCount — the per-minute pacer', () => {
  it('counts up to the ceiling and then refuses', () => {
    const state: any = { w: 0, sends: 0, reads: 0 };
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) expect(lib.livingCount(state, 'sends', 3, now)).toBe(true);
    expect(lib.livingCount(state, 'sends', 3, now)).toBe(false);
    expect(state.sends).toBe(3);
  });

  it('opens a fresh window once the minute has turned', () => {
    const state: any = { w: 0, sends: 0, reads: 0 };
    expect(lib.livingCount(state, 'sends', 1, 1_000_000)).toBe(true);
    expect(lib.livingCount(state, 'sends', 1, 1_030_000)).toBe(false);
    expect(lib.livingCount(state, 'sends', 1, 1_060_001)).toBe(true);
  });

  it('sends and reads are paced apart', () => {
    const state: any = { w: 0, sends: 0, reads: 0 };
    expect(lib.livingCount(state, 'sends', 1, 5)).toBe(true);
    expect(lib.livingCount(state, 'reads', 1, 5)).toBe(true);
    expect(lib.livingCount(state, 'sends', 1, 5)).toBe(false);
  });
});

describe('livingPrune — the read cache stays small', () => {
  it('drops everything older than ten seconds', () => {
    const now = 100_000;
    const cache = { a: { at: now - 1000 }, b: { at: now - 20_000 }, c: { at: now } };
    expect(Object.keys(lib.livingPrune(cache, now)).sort()).toEqual(['a', 'c']);
  });

  it('keeps at most 24 entries, newest first', () => {
    const now = 100_000;
    const cache: Record<string, { at: number }> = {};
    for (let i = 0; i < 40; i++) cache['k' + i] = { at: now - i };
    const out = lib.livingPrune(cache, now);
    expect(Object.keys(out).length).toBe(24);
    expect(out.k0).toBeDefined();
    expect(out.k39).toBeUndefined();
  });

  it('survives junk entries without throwing', () => {
    expect(lib.livingPrune({ a: null, b: 'x', c: { at: 'nope' } }, 5)).toEqual({});
  });
});

describe('livingStateKey — one record per owner, and a safe key name', () => {
  it('is a stable address per account', () => {
    expect(lib.livingStateKey('alice')).toBe('state.alice');
    expect(lib.livingStateKey('Alice')).toBe('state.alice');
  });

  it('cannot forge a namespace separator out of an account name', () => {
    expect(lib.livingStateKey('a.b')).toBe('state.a-b');
    expect(lib.livingStateKey('a:b/c')).toBe('state.a-b-c');
    expect(lib.livingStateKey('')).toBe('state.unknown');
  });
});

describe('livingHeaders — building the outbound header set', () => {
  it('carries the defaults through when the caller sent none', () => {
    expect(lib.livingHeaders(null, {}, { 'Content-Type': 'application/json' }))
      .toEqual({ ok: true, headers: { 'Content-Type': 'application/json' } });
  });

  it('refuses a header nobody allowed, naming it', () => {
    const out = lib.livingHeaders({ Cookie: 'a=b' }, {}, {});
    expect(out.refusal.error.code).toBe('HEADER_REFUSED');
    expect(out.refusal.error.message).toContain('Cookie');
  });

  it('refuses a placeholder whose secret is not set, naming the secret and not its value', () => {
    const out = lib.livingHeaders({ Authorization: 'Bearer {{secret:NOPE}}' }, { OTHER: 'zzTOPSECRETzz' }, {});
    expect(out.refusal.error.code).toBe('SECRET_UNKNOWN');
    expect(out.refusal.error.message).toContain('NOPE');
    expect(out.refusal.error.message).not.toContain('zzTOPSECRETzz');
    expect(out.headers).toBeUndefined();
  });

  it('resolves a secret into the value that goes out', () => {
    const out = lib.livingHeaders({ Authorization: 'Bearer {{secret:T}}' }, { T: 'tok' }, {});
    expect(out.headers.Authorization).toBe('Bearer tok');
  });

  it('refuses a non-string value and an over-long one', () => {
    expect(lib.livingHeaders({ Accept: 5 }, {}, {}).refusal.error.code).toBe('INVALID_INPUT');
    expect(lib.livingHeaders({ Accept: 'x'.repeat(5000) }, {}, {}).refusal.error.code).toBe('INVALID_INPUT');
  });

  it('refuses more than sixteen names', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 20; i++) many['x-living-' + i] = 'v';
    expect(lib.livingHeaders(many, {}, {}).refusal.error.code).toBe('INVALID_INPUT');
  });
});

describe('compareVersions — what makes a shipped builtin newer than a stored one', () => {
  it('orders dotted numbers', () => {
    expect(compareVersions('1.1.0', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareVersions('2.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
  });

  it('treats a segment that is not a number as zero rather than throwing', () => {
    expect(compareVersions('1.x.0', '1.0.0')).toBe(0);
    expect(compareVersions('', '0')).toBe(0);
  });
});

describe('mergeOwnerConfig — an update swaps the code and keeps the settings', () => {
  it('keeps every value the owner set', () => {
    const merged = mergeOwnerConfig(
      { allow_hosts: [], secrets: '' },
      { allow_hosts: ['api.example.com'], secrets: { encrypted: 'iv:tag:ct' } },
    );
    expect(merged.allow_hosts).toEqual(['api.example.com']);
    expect(merged.secrets).toEqual({ encrypted: 'iv:tag:ct' });
  });

  it('takes the __-prefixed keys from the NEW manifest, because they describe the new code', () => {
    const merged = mergeOwnerConfig(
      { __secretKeys: ['secrets', 'token'], __schedules: [{ id: 'new' }] },
      { __secretKeys: ['secrets'], __schedules: [{ id: 'old' }] },
    );
    expect(merged.__secretKeys).toEqual(['secrets', 'token']);
    expect(merged.__schedules).toEqual([{ id: 'new' }]);
  });

  it('a field the new manifest introduces arrives at its default', () => {
    const merged = mergeOwnerConfig({ allow_hosts: [], retries: 3 }, { allow_hosts: ['a.example'] });
    expect(merged.retries).toBe(3);
    expect(merged.allow_hosts).toEqual(['a.example']);
  });

  it('a key the new manifest dropped is still carried, rather than silently discarded', () => {
    // A builtin that stops declaring a field has not earned the right to delete what somebody typed
    // into it; an operator removes it deliberately, on a road where they can see what they are doing.
    const merged = mergeOwnerConfig({ allow_hosts: [] }, { allow_hosts: [], legacy: 'kept' });
    expect(merged.legacy).toBe('kept');
  });
});
