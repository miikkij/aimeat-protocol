/**
 * @file test/unit/design-book-grown-genre.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A genre that grew out of an app: the shape of its body, and the four things its
 *   standing is read from, against a store that holds exactly what each case needs.
 * @version-history
 *   v1.0.0 — 2026-09-20 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { validateGrownGenreBody, isGrownGenreBody, grownGenreStanding, grownGenrePublishing, type GrownGenreBody } from '../../src/services/design-book/grown-genre.js';
import { validatePartInput } from '../../src/services/design-book/validate.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const config = { nodeId: 'node-t' } as AimeatConfig;
const OWNER = 'alice@node-t';
const BODY: GrownGenreBody = { app: { owner: 'alice', filename: 'ledger.html' }, judgement: { reach: 'general', why: 'Any app that keeps rows of entries against dates can start from it.' } };
const page = (register: string, light = '') => `<!DOCTYPE html><html><head><meta name="aimeat-register" content="${register}">${light}</head><body>v</body></html>`;

/** A store with one app (its versions by number) and the owner's notes saying which one was kept. */
function store(opts: { versions?: Record<number, string>; live?: number; kept?: number | null; flags?: Record<string, unknown> }): Storage {
  const versions = opts.versions ?? {};
  const live = opts.live ?? Math.max(0, ...Object.keys(versions).map(Number));
  const app = (n: number) => (versions[n] === undefined ? null : { ownerGaii: OWNER, ownerName: 'alice', filename: 'ledger.html', versionNumber: n, data: Buffer.from(versions[n]), ...opts.flags });
  return {
    getApp: async (_o: string, _f: string, v?: number) => app(v ?? live),
    getMemory: async () => (opts.kept === undefined ? null : {
      value: { spec: 'aimeat.buildnotes/v1', app: 'alice/ledger.html', kept_version: opts.kept, kept_at: null,
        versions: Object.keys(versions).map(n => ({ version: Number(n), at: '', level: 'fine', register: null, took: [], passed: [], made: [] })) },
    }),
  } as unknown as Storage;
}

describe('a genre that grew out of an app', () => {
  it('has a body that names an app and carries its builder\'s judgement', () => {
    expect(isGrownGenreBody(BODY)).toBe(true);
    expect(isGrownGenreBody({ template: 'genre-almanac' })).toBe(false);
    expect(validateGrownGenreBody(BODY as unknown as Record<string, unknown>)).toEqual(BODY);
    expect(() => validateGrownGenreBody({ app: { owner: 'alice', filename: '../x.html' }, judgement: BODY.judgement })).toThrow(/has the body/);
    expect(() => validateGrownGenreBody({ app: { owner: 'alice', filename: 'ledger.txt' }, judgement: BODY.judgement })).toThrow(/has the body/);
    expect(() => validateGrownGenreBody({ app: BODY.app })).toThrow(/judgement is YOURS/);
    expect(() => validateGrownGenreBody({ app: BODY.app, judgement: { reach: 'useful', why: BODY.judgement.why } })).toThrow(/"general".*"special"/);
    expect(() => validateGrownGenreBody({ app: BODY.app, judgement: { reach: 'general', why: 'yes' } })).toThrow(/judgement\.why/);
    // Through the part validator, and a shipped template's name still works as before.
    expect(validatePartInput({ id: 'genre-ledgerline', kind: 'genre', title: 'Ledgerline', summary: 'A ruled ledger page.', body: BODY }).body).toEqual(BODY);
    expect(() => validatePartInput({ id: 'genre-x1', kind: 'genre', title: 'T', summary: 'S', body: { template: 'no-such' } })).toThrow(/naming your own published page/);
  });

  it('stands on four things, and names the first one that is missing', async () => {
    const good = { versions: { 1: page('custom:ledgerline', '<meta name="aimeat-light" content="follows">') }, kept: 1, flags: { forkable: true } };
    const ok = await grownGenreStanding(store(good), config, OWNER, BODY);
    expect(ok.page).toMatchObject({ version: 1, register: 'custom:ledgerline', light: 'follows' });

    const why = async (o: Parameters<typeof store>[0]) => (await grownGenreStanding(store(o), config, OWNER, BODY)).why;
    expect(await why({})).toMatch(/no published app/);
    expect(await why({ ...good, flags: { forkable: true, parked: true } })).toMatch(/nobody else can open it/);
    expect(await why({ ...good, flags: { forkable: true, accessCode: 'x' } })).toMatch(/nobody else can open it/);
    expect(await why({ ...good, flags: { forkable: true, operatorHidden: true } })).toMatch(/nobody else can open it/);
    expect(await why({ ...good, kept: null })).toMatch(/has not said/);
    expect(await why({ ...good, flags: {} })).toMatch(/not open for forking[\s\S]*do not decide it for them/);
    expect(await why({ ...good, versions: { 1: page('genre-almanac') } })).toMatch(/fork of an existing genre is that genre/);
    expect(await why({ ...good, versions: { 1: page('') } })).toMatch(/says its register is nothing/);
  });

  it('is the version its owner kept, whatever was published after it', async () => {
    const s = store({ versions: { 2: page('custom:ledgerline').replace('>v<', '>kept<'), 3: page('custom:ledgerline').replace('>v<', '>later<') }, live: 3, kept: 2, flags: { forkable: true } });
    const out = await grownGenreStanding(s, config, OWNER, BODY);
    expect(out.page?.version).toBe(2);
    expect(out.page?.html).toContain('kept');
  });

  it('is offered by the owner of the app and by nobody else', async () => {
    const s = store({ versions: { 1: page('custom:ledgerline') }, kept: 1, flags: { forkable: true } });
    await expect(grownGenrePublishing(s, config, 'mallory@node-t', BODY)).rejects.toThrow(/owner of the app it grew out of/);
    expect((await grownGenrePublishing(s, config, OWNER, BODY)).earned).toBe(true);
    const special = { ...BODY, judgement: { reach: 'special' as const, why: BODY.judgement.why } };
    expect(await grownGenrePublishing(s, config, OWNER, special)).toMatchObject({ earned: false, why: expect.stringMatching(/special to one app/) });
  });
});
