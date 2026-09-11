/**
 * @file indexnow.test.ts
 * @description The instant-update notice: one batch per host under that host's own key, the
 *   explicit run that ignores the auto switch, the log that keeps five, the stamp on each app, and
 *   the plan that says what "everything" is.
 *
 *   THE HOLE THIS FILE IS THE MEMORY OF. The first version declared the apex as the batch's host
 *   and put an app host's address in the same list. IndexNow proves ownership with a key file on
 *   the host the addresses belong to, so the app's own address never counted, and nothing here said
 *   so: the endpoint answers 202 and validates later. The test "groups by host" fails on that code.
 *
 * @version-history
 *   v1.0.0 — 2026-09-11 — Initial.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchCalls: Array<{ url: string; body: unknown }> = [];
let answer: (body: { host: string }) => { status: number; ok: boolean } = () => ({ status: 202, ok: false });

vi.mock('../../src/utils/url-validator.js', () => ({
  safeFetch: vi.fn(async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { host: string };
    fetchCalls.push({ url, body });
    const a = answer(body);
    return { ok: a.ok, status: a.status, text: async () => '' } as unknown as Response;
  }),
}));
vi.mock('../../src/utils/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { submitToIndexNow, announceApp, appSubmitUrls } from '../../src/services/indexnow.js';
import { planAnnouncement, announceEverything } from '../../src/services/indexnow-site.js';
import { readIndexNowRuns, readIndexNowLastRun, INDEXNOW_RUNS_KEPT } from '../../src/services/indexnow-log.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AppSummaryRecord } from '../../src/storage/types/apps.js';

const cfg = (over: Partial<AimeatConfig> = {}): AimeatConfig => ({
  baseUrl: 'https://node.example',
  appHost: 'apps.node.example',
  indexNowKey: 'k3y',
  seoIndexnowAuto: true,
  seoIndexing: 'on',
  appsSeoMode: 'owner',
  ...over,
} as AimeatConfig);

const app = (over: Partial<AppSummaryRecord> = {}): AppSummaryRecord => ({
  ownerGaii: 'alice@node.example',
  ownerName: 'alice',
  filename: 'notes.html',
  manifest: { name: 'Notes', seo: { index: true } },
  ...over,
} as AppSummaryRecord);

/** Enough of storage for these functions: one memory record, the app list, the sites, the stamp. */
function fakeStorage(opts: { apps?: AppSummaryRecord[]; sites?: Array<{ enabled: boolean; kind: string; target: string; subdomain: string }> } = {}) {
  const memory = new Map<string, { value: unknown }>();
  const stamps: Array<{ ownerGaii: string; filename: string; seo: unknown }> = [];
  const storage = {
    getMemory: async (_owner: string, key: string) => memory.get(key) ?? null,
    setMemory: async (rec: { key: string; value: unknown }) => { memory.set(rec.key, { value: rec.value }); },
    listApps: async () => ({ apps: opts.apps ?? [] }),
    listSubdomainSites: async () => opts.sites ?? [],
    updateAppMeta: async (ownerGaii: string, filename: string, meta: { seo?: unknown }) => { stamps.push({ ownerGaii, filename, seo: meta.seo }); return true; },
  } as unknown as Storage;
  return { storage, memory, stamps };
}

beforeEach(() => {
  fetchCalls.length = 0;
  answer = () => ({ status: 202, ok: false });
});

describe('submitToIndexNow: one batch per host, each under its own key file', () => {
  it('groups the addresses by host and names that host and its key location in each batch', async () => {
    const { storage } = fakeStorage();
    const run = await submitToIndexNow(cfg(), storage, [
      'https://node.example/',
      'https://node.example/help',
      'https://turbo.apps.node.example/',
      'https://node.example/v1/apps/alice/turbo.html',
    ]);
    expect(run?.ok).toBe(true);
    expect(run?.urlCount).toBe(4);
    expect(run?.hosts).toBe(2);
    expect(fetchCalls).toHaveLength(2);
    const byHost = Object.fromEntries(fetchCalls.map((c) => [(c.body as { host: string }).host, c.body]));
    expect(byHost['node.example']).toEqual({
      host: 'node.example', key: 'k3y', keyLocation: 'https://node.example/k3y.txt',
      urlList: ['https://node.example/', 'https://node.example/help', 'https://node.example/v1/apps/alice/turbo.html'],
    });
    expect(byHost['turbo.apps.node.example']).toEqual({
      host: 'turbo.apps.node.example', key: 'k3y', keyLocation: 'https://turbo.apps.node.example/k3y.txt',
      urlList: ['https://turbo.apps.node.example/'],
    });
  });

  it('records a refused host by name, with the refusal\'s status, and the run is not ok', async () => {
    answer = (b) => b.host === 'turbo.apps.node.example' ? { status: 422, ok: false } : { status: 202, ok: false };
    const { storage } = fakeStorage();
    const run = await submitToIndexNow(cfg(), storage, ['https://node.example/', 'https://turbo.apps.node.example/']);
    expect(run?.ok).toBe(false);
    expect(run?.failed).toEqual(['turbo.apps.node.example']);
    expect(run?.status).toBe(422);
    expect(run?.hosts).toBe(2);
  });

  it('is silent without a key, with discovery off, and on an empty list', async () => {
    const { storage } = fakeStorage();
    expect(await submitToIndexNow(cfg({ indexNowKey: null }), storage, ['https://node.example/'])).toBeNull();
    expect(await submitToIndexNow(cfg({ seoIndexing: 'off' }), storage, ['https://node.example/'])).toBeNull();
    expect(await submitToIndexNow(cfg(), storage, [])).toBeNull();
    expect(fetchCalls).toHaveLength(0);
  });

  it('respects the auto switch for an automatic notice and ignores it for an explicit one', async () => {
    const { storage } = fakeStorage();
    expect(await submitToIndexNow(cfg({ seoIndexnowAuto: false }), storage, ['https://node.example/'])).toBeNull();
    expect(fetchCalls).toHaveLength(0);
    const run = await submitToIndexNow(cfg({ seoIndexnowAuto: false }), storage, ['https://node.example/'], { explicit: true, scope: 'pages', by: 'alice' });
    expect(run?.ok).toBe(true);
    expect(run?.scope).toBe('pages');
    expect(run?.by).toBe('alice');
    expect(fetchCalls).toHaveLength(1);
  });

  it('drops an address that is not one instead of sending a batch that would be refused', async () => {
    const { storage } = fakeStorage();
    const run = await submitToIndexNow(cfg(), storage, ['not a url', 'https://node.example/']);
    expect(run?.urlCount).toBe(1);
    expect(fetchCalls).toHaveLength(1);
  });
});

describe('the log keeps the newest five, and still reads a record written flat', () => {
  it('newest first, capped', async () => {
    const { storage } = fakeStorage();
    for (let i = 0; i < INDEXNOW_RUNS_KEPT + 2; i++) {
      await submitToIndexNow(cfg(), storage, [`https://node.example/p${i}`]);
    }
    const runs = await readIndexNowRuns(storage);
    expect(runs).toHaveLength(INDEXNOW_RUNS_KEPT);
    expect(runs[0].at >= runs[runs.length - 1].at).toBe(true);
    const last = await readIndexNowLastRun(storage);
    expect(last?.at).toBe(runs[0].at);
  });

  it('a v1.0.0 record (one flat run) reads as one run with defaults for the fields it lacks', async () => {
    const { storage, memory } = fakeStorage();
    memory.set('site/indexnow-last-run', { value: { at: '2026-09-08T16:51:02.352Z', urlCount: 2, ok: true, status: 202 } });
    const runs = await readIndexNowRuns(storage);
    expect(runs).toEqual([{ at: '2026-09-08T16:51:02.352Z', urlCount: 2, hosts: 1, ok: true, status: 202, failed: [] }]);
  });

  it('a string value is parsed, and a corrupt one reads as no runs', async () => {
    const { storage, memory } = fakeStorage();
    memory.set('site/indexnow-last-run', { value: JSON.stringify({ runs: [{ at: '2026-09-10T00:00:00.000Z', urlCount: 3, hosts: 1, ok: true, status: 200, failed: [] }] }) });
    expect((await readIndexNowRuns(storage))[0]?.urlCount).toBe(3);
    memory.set('site/indexnow-last-run', { value: '{not json' });
    expect(await readIndexNowRuns(storage)).toEqual([]);
  });
});

describe('announceApp stamps the app with when it was told', () => {
  it('both addresses go out, and seo.announcedAt lands on an accepted run', async () => {
    const { storage, stamps } = fakeStorage();
    const run = await announceApp(cfg(), storage, { ownerGaii: 'alice@node.example', ownerName: 'alice', filename: 'turbo.html' }, 'turbo');
    expect(run?.ok).toBe(true);
    expect(fetchCalls.map((c) => (c.body as { host: string }).host).sort()).toEqual(['node.example', 'turbo.apps.node.example']);
    expect(stamps).toEqual([{ ownerGaii: 'alice@node.example', filename: 'turbo.html', seo: { announcedAt: run?.at } }]);
  });

  it('no stamp when every host refused', async () => {
    answer = () => ({ status: 403, ok: false });
    const { storage, stamps } = fakeStorage();
    const run = await announceApp(cfg(), storage, { ownerGaii: 'alice@node.example', ownerName: 'alice', filename: 'turbo.html' });
    expect(run?.ok).toBe(false);
    expect(stamps).toEqual([]);
  });

  it('appSubmitUrls: the apex path always, the app host first when there is one', () => {
    expect(appSubmitUrls(cfg(), { ownerName: 'alice', filename: 'a b.html' })).toEqual(['https://node.example/v1/apps/alice/a%20b.html']);
    expect(appSubmitUrls(cfg(), { ownerName: 'alice', filename: 'turbo.html' }, 'turbo')).toEqual(['https://turbo.apps.node.example/', 'https://node.example/v1/apps/alice/turbo.html']);
  });
});

describe('planAnnouncement and announceEverything: what "everything" is', () => {
  const apps = [
    app({ filename: 'turbo.html' }),
    app({ filename: 'secret.html', manifest: { name: 'Secret', seo: { index: false } } }),
    app({ filename: 'gated.html', accessCode: 'x', manifest: { name: 'Gated', seo: { index: true } } }),
    app({ filename: 'nosub.html' }),
  ];
  const sites = [{ enabled: true, kind: 'app', target: 'alice/turbo.html', subdomain: 'turbo' }];

  it('"pages" is the page registry alone, on the apex', async () => {
    const { storage } = fakeStorage({ apps, sites });
    const plan = await planAnnouncement(cfg(), storage, 'pages');
    expect(plan.urls.length).toBeGreaterThan(0);
    expect(plan.urls.every((u) => u.startsWith('https://node.example/'))).toBe(true);
    expect(plan.hosts).toEqual([{ host: 'https://node.example', url_count: plan.urls.length }]);
    expect(plan.apps).toEqual([]);
  });

  it('"all" adds every findable app, its own host when it has one, and leaves the rest out', async () => {
    const { storage } = fakeStorage({ apps, sites });
    const plan = await planAnnouncement(cfg(), storage, 'all');
    expect(plan.apps.map((a) => a.filename)).toEqual(['turbo.html', 'nosub.html']);
    expect(plan.urls).toContain('https://turbo.apps.node.example/');
    expect(plan.urls).toContain('https://node.example/v1/apps/alice/turbo.html');
    expect(plan.urls).toContain('https://node.example/v1/apps/alice/nosub.html');
    expect(plan.urls.some((u) => u.includes('secret') || u.includes('gated'))).toBe(false);
    expect(plan.hosts.map((h) => h.host).sort()).toEqual(['https://node.example', 'https://turbo.apps.node.example']);
  });

  it('with discovery off nothing is findable, and the send says why', async () => {
    const { storage } = fakeStorage({ apps, sites });
    const plan = await planAnnouncement(cfg({ seoIndexing: 'off' }), storage, 'all');
    expect(plan.apps).toEqual([]);
    const out = await announceEverything(cfg({ seoIndexing: 'off' }), storage, { scope: 'all' });
    expect(out.sent).toBe(false);
    expect(!out.sent && out.reason).toBe('indexing_off');
    const noKey = await announceEverything(cfg({ indexNowKey: null }), storage, { scope: 'all' });
    expect(!noKey.sent && noKey.reason).toBe('no_key');
    expect(fetchCalls).toHaveLength(0);
  });

  it('sends the plan, one batch per host, ignoring the auto switch, and stamps every app', async () => {
    const { storage, stamps } = fakeStorage({ apps, sites });
    const out = await announceEverything(cfg({ seoIndexnowAuto: false }), storage, { scope: 'all', by: 'operator' });
    expect(out.sent).toBe(true);
    if (!out.sent) return;
    expect(out.run.hosts).toBe(2);
    expect(out.run.scope).toBe('all');
    expect(out.run.by).toBe('operator');
    expect(out.run.urlCount).toBe(out.plan.urls.length);
    expect(stamps.map((s) => s.filename).sort()).toEqual(['nosub.html', 'turbo.html']);
    expect(stamps.every((s) => (s.seo as { announcedAt: string }).announcedAt === out.run.at)).toBe(true);
  });
});
