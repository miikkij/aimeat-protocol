/**
 * @file test/library-packs-doc-truth.test.ts
 * @description Doc-proof guard for library packs: (1) every vendored pack's served asset
 *   actually exists under public/ (the "invented script URLs 404" class of failure, now
 *   caught at CI time instead of in a published app), (2) fonts.css only references font
 *   files that ship with it, and (3) the realtime pack's ai_doc constructor claims are
 *   EXECUTED against the real /lib/realtime.js source in a VM — the ai_doc previously
 *   documented a constructor form that did not exist (pitfall
 *   realtime/aimeatrealtime-constructor-is-baseurl-token); this test keeps every
 *   documented form true forever.
 * @usage pnpm test (vitest) — also wired into CI as the "Unit tests" step.
 * @version-history
 *   v1.0.0 — 2026-07-19 — initial: vendored asset existence + fonts.css refs + realtime
 *     constructor doc-proof (positional + { session } object form)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { VENDORED_PACKS } from '../../src/data/library-packs/vendored.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── 1. Every vendored pack asset the docs point at must exist on disk ──
describe('vendored pack assets exist (invented-URL guard)', () => {
  for (const pack of VENDORED_PACKS) {
    const files = new Set<string>();
    if (pack.url && pack.url.startsWith('/lib/')) files.add(pack.url);
    for (const inc of pack.include ?? []) {
      const m = inc.match(/\{\{BASE_URL\}\}(\/lib\/[^"' ]+)/);
      if (m) files.add(m[1]);
    }
    for (const f of files) {
      it(`${pack.id}: ${f} is served from public${f}`, () => {
        expect(existsSync(join(root, 'public', f)), `missing public${f}`).toBe(true);
      });
    }
  }
});

// ── 2. fonts.css must only reference font files that ship with it ──
describe('fonts pack internal references', () => {
  it('every url(...) in fonts.css resolves to a shipped file', () => {
    const css = readFileSync(join(root, 'public/lib/fonts.css'), 'utf8');
    const urls = [...css.matchAll(/url\((\/lib\/[^)]+)\)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(existsSync(join(root, 'public', u)), `missing public${u}`).toBe(true);
    }
  });
});

// ── 3. The realtime ai_doc's constructor claims, EXECUTED against the real lib ──
describe('realtime ai_doc doc-proof (constructor forms actually work)', () => {
  const src = readFileSync(join(root, 'public/lib/realtime.js'), 'utf8');
  const sandbox: Record<string, unknown> = { console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const AR = sandbox.AimeatRealtime as new (a: unknown, b?: unknown) => { baseUrl: string; token: unknown };

  it('the lib defines AimeatRealtime and SharedClock (apiSurface claim)', () => {
    expect(typeof AR).toBe('function');
    expect(typeof sandbox.SharedClock).toBe('function');
  });

  it('positional (baseUrl, token) — the canonical form existing apps use — is unchanged', () => {
    const rt = new AR('https://node.example.com/', 'jwt-123');
    expect(rt.baseUrl).toBe('https://node.example.com');
    expect(rt.token).toBe('jwt-123');
  });

  it('object form { session } (documented sugar) resolves session.jwt', () => {
    const rt = new AR({ session: { jwt: 'jwt-abc' }, baseUrl: 'https://n.example' });
    expect(rt.baseUrl).toBe('https://n.example');
    expect(rt.token).toBe('jwt-abc');
  });

  it('object form { baseUrl, token } works too', () => {
    const rt = new AR({ baseUrl: 'https://n2.example/', token: 'tok-9' });
    expect(rt.baseUrl).toBe('https://n2.example');
    expect(rt.token).toBe('tok-9');
  });

  it('the ai_doc names the canonical positional form and the event list', () => {
    const pack = VENDORED_PACKS.find((p) => p.id === 'realtime');
    expect(pack).toBeDefined();
    expect(pack!.aiDoc).toContain('new AimeatRealtime(nodeBaseUrl, session.jwt)');
    expect(pack!.aiDoc).toContain("'joined'");
    expect(pack!.aiDoc).toContain('BEFORE rt.connect');
  });
});
