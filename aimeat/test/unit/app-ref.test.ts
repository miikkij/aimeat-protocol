/**
 * @file test/unit/app-ref.test.ts
 * @description An app named without `.html` reaches the stored app: the resolver
 *   (services/app/app-ref.ts) and the REST path middleware (middleware/app-ref-path.ts).
 *
 *   The cases that matter are the ones that would hide one app behind another: an app whose
 *   filename has no extension must keep winning over a same-named `.html` app, a prefix naming
 *   another owner must not be dropped, and a static route of the `/v1/apps/<a>/<b>` shape must never
 *   be rewritten into an owner's app.
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-sovelluksen-nimi-ilman-html-p-tett-kaikkialla).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  appDisplayName, appFilenameCandidates, splitAppRef, resolveAppFilename, findAppFilename,
} from '../../src/services/app/app-ref.js';
import {
  appRefPathMiddleware, APP_OWNER_FILENAME_PATHS, RESERVED_APP_OWNER_SEGMENTS,
} from '../../src/middleware/app-ref-path.js';

/** A storage double: the apps each owner has, by account name. Counts the lookups. */
function storeOf(apps: Record<string, string[]>) {
  const calls: Array<{ owner: unknown; candidates: string[] }> = [];
  return {
    calls,
    async appFilenamesAmong(owner: { ownerGaii: string } | { ownerName: string }, candidates: string[]) {
      calls.push({ owner, candidates });
      const key = 'ownerGaii' in owner ? owner.ownerGaii.split('@')[0] : owner.ownerName;
      const have = new Set(apps[key] ?? []);
      return candidates.filter(c => have.has(c));
    },
  };
}

describe('appDisplayName', () => {
  it('drops .html and .htm and nothing else', () => {
    expect(appDisplayName('lifecycle-central.html')).toBe('lifecycle-central');
    expect(appDisplayName('old.HTM')).toBe('old');
    expect(appDisplayName('company-brief')).toBe('company-brief');
    expect(appDisplayName('data.json')).toBe('data.json');
    // The same as the regexes it replaced: nothing left is an empty name, which callers fall back from.
    expect(appDisplayName('.html')).toBe('');
  });
});

describe('appFilenameCandidates and splitAppRef', () => {
  it('tries the name as given first, then with .html and .htm', () => {
    expect(appFilenameCandidates('lifecycle-central')).toEqual(['lifecycle-central', 'lifecycle-central.html', 'lifecycle-central.htm']);
    expect(appFilenameCandidates('lifecycle-central.html')).toEqual(['lifecycle-central.html']);
    expect(appFilenameCandidates('  ')).toEqual([]);
  });
  it('splits owner/name at the first slash', () => {
    expect(splitAppRef('alice/notes')).toEqual({ owner: 'alice', name: 'notes' });
    expect(splitAppRef('notes')).toEqual({ name: 'notes' });
  });
});

describe('resolveAppFilename', () => {
  const store = storeOf({ alice: ['lifecycle-central.html', 'company-brief', 'twin', 'twin.html', 'old.htm'] });
  const alice = { ownerName: 'alice' };

  it('turns the bare name into the stored .html filename', async () => {
    expect(await resolveAppFilename(store, alice, 'lifecycle-central')).toBe('lifecycle-central.html');
    expect(await resolveAppFilename(store, alice, 'lifecycle-central.html')).toBe('lifecycle-central.html');
    expect(await resolveAppFilename(store, alice, 'old')).toBe('old.htm');
  });
  it('drops an owner prefix that names the same owner', async () => {
    expect(await resolveAppFilename(store, alice, 'alice/lifecycle-central')).toBe('lifecycle-central.html');
    expect(await resolveAppFilename(store, { ownerGaii: 'alice@node-x' }, 'alice/lifecycle-central')).toBe('lifecycle-central.html');
  });
  it('keeps an app whose filename has no extension ahead of a same-named .html app', async () => {
    expect(await resolveAppFilename(store, alice, 'twin')).toBe('twin');
    expect(await resolveAppFilename(store, alice, 'company-brief')).toBe('company-brief');
  });
  it('returns a name nothing matches as given, so the caller can say what was sent', async () => {
    expect(await resolveAppFilename(store, alice, 'nothing-here')).toBe('nothing-here');
    const f = await findAppFilename(store, alice, 'nothing-here');
    expect(f).toEqual({ filename: null, name: 'nothing-here', foreign: false });
  });
  it('never resolves a name prefixed with another owner into this owner\'s app', async () => {
    expect(await resolveAppFilename(store, alice, 'bob/lifecycle-central')).toBe('bob/lifecycle-central');
    expect((await findAppFilename(store, alice, 'bob/lifecycle-central')).foreign).toBe(true);
  });
  it('asks only for this owner\'s apps', async () => {
    const s = storeOf({ bob: ['lifecycle-central.html'] });
    expect(await resolveAppFilename(s, alice, 'lifecycle-central')).toBe('lifecycle-central');
    expect(s.calls[0].owner).toEqual(alice);
  });
});

/** Run the middleware on one URL and return the URL the routers would see. */
async function through(store: ReturnType<typeof storeOf>, url: string): Promise<string> {
  const req = { url, get path() { const q = this.url.indexOf('?'); return q >= 0 ? this.url.slice(0, q) : this.url; } } as unknown as import('express').Request;
  await new Promise<void>((resolve) => { void appRefPathMiddleware(store)(req, {} as import('express').Response, () => resolve()); });
  return req.url;
}

describe('appRefPathMiddleware', () => {
  const store = storeOf({ alice: ['lifecycle-central.html', 'twin', 'twin.html', 'catalogue.html'], ui: ['catalogue.html'], me: ['x.html'] });

  it('rewrites the filename segment and keeps the rest of the path and the query', async () => {
    expect(await through(store, '/v1/apps/alice/lifecycle-central')).toBe('/v1/apps/alice/lifecycle-central.html');
    expect(await through(store, '/v1/apps/alice/lifecycle-central/webmcp/tools/x?a=1&b=2'))
      .toBe('/v1/apps/alice/lifecycle-central.html/webmcp/tools/x?a=1&b=2');
    expect(await through(store, '/v1/datamap/apps/alice/lifecycle-central')).toBe('/v1/datamap/apps/alice/lifecycle-central.html');
    expect(await through(store, '/v1/admin/apps/alice/lifecycle-central/hide')).toBe('/v1/admin/apps/alice/lifecycle-central.html/hide');
  });
  it('leaves an exact match, an .html name and an unknown name as sent', async () => {
    expect(await through(store, '/v1/apps/alice/twin')).toBe('/v1/apps/alice/twin');
    expect(await through(store, '/v1/apps/alice/lifecycle-central.html')).toBe('/v1/apps/alice/lifecycle-central.html');
    expect(await through(store, '/v1/apps/alice/nothing')).toBe('/v1/apps/alice/nothing');
    expect(await through(store, '/v1/apps/bob/lifecycle-central')).toBe('/v1/apps/bob/lifecycle-central');
  });
  it('never rewrites a static route that shares the /v1/apps/<a>/<b> shape', async () => {
    expect(await through(store, '/v1/apps/ui/catalogue')).toBe('/v1/apps/ui/catalogue');
    expect(await through(store, '/v1/apps/me/x/legal')).toBe('/v1/apps/me/x/legal');
  });
  it('passes a segment that is not valid percent-encoding through untouched, and decodes a valid one', async () => {
    const s = storeOf({ alice: ['a b.html'] });
    expect(await through(s, '/v1/apps/alice/%E0%A4%A')).toBe('/v1/apps/alice/%E0%A4%A');
    expect(await through(s, '/v1/apps/alice/%ZZ')).toBe('/v1/apps/alice/%ZZ');
    expect(await through(s, '/v1/apps/alice/a%20b')).toBe('/v1/apps/alice/a%20b.html');
  });
  it('does not look anything up for a path outside the app routes', async () => {
    const s = storeOf({ alice: ['a.html'] });
    expect(await through(s, '/v1/memory/alice/a')).toBe('/v1/memory/alice/a');
    expect(await through(s, '/v1/apps/alice')).toBe('/v1/apps/alice');
    expect(s.calls).toHaveLength(0);
  });
  it('lets the request through unchanged when the lookup fails', async () => {
    const broken = { calls: [], async appFilenamesAmong(): Promise<string[]> { throw new Error('db down'); } };
    expect(await through(broken as unknown as ReturnType<typeof storeOf>, '/v1/apps/alice/lifecycle-central')).toBe('/v1/apps/alice/lifecycle-central');
  });
});

/** Every route path string declared under src/routes and src/server-bootstrap. */
function declaredRoutePaths(): string[] {
  const roots = ['src/routes', 'src/server-bootstrap'];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts')) {
        const text = readFileSync(p, 'utf8');
        for (const m of text.matchAll(/router\.(?:get|post|put|patch|delete|all|use)\(\s*['"`]([^'"`]+)['"`]/g)) out.push(m[1]);
      }
    }
  };
  for (const r of roots) walk(r);
  return out;
}

describe('the middleware\'s lists match the declared routes', () => {
  const paths = declaredRoutePaths();

  it('every :owner/:filename route sits under a listed prefix', () => {
    const missing = paths.filter(p => p.includes(':owner/:filename'))
      .map(p => p.slice(0, p.indexOf(':owner/:filename')))
      .filter(prefix => prefix !== '/' && !APP_OWNER_FILENAME_PATHS.includes(prefix));
    expect([...new Set(missing)]).toEqual([]);
  });
  it('every static /v1/apps/<a>/<b> route has its first segment reserved', () => {
    const statics = paths.filter(p => /^\/v1\/apps\/[^/:]+\/[^/]+/.test(p)).map(p => p.split('/')[3]);
    const unreserved = [...new Set(statics)].filter(s => !RESERVED_APP_OWNER_SEGMENTS.has(s));
    expect(unreserved).toEqual([]);
  });
});
