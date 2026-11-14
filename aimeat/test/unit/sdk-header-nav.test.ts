/**
 * @file sdk-header-nav.test.ts
 * @description The links of the served header (src/static/sdk-libs/header/nav.js) held against the
 *   shell's bar (public/spa.html Header), and the node's prelude for it (headerPrelude).
 *
 *   Why the comparison: the two bars are one bar to the person using them, and they are written in
 *   two places. On 2026-11-14 the served one was found a month behind on aimeat.io's front page: a
 *   signed-in person had no Home, Messages, Agents or Chat, and Apps opened /app-catalog.html, the
 *   catalogue the shell had left. Nothing failed when the shell gained those links. Now a link
 *   added to the shell's bar, removed from it or sent elsewhere fails here until nav.js follows.
 * @usage cd aimeat && pnpm exec vitest run test/unit/sdk-header-nav.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial. The signed-in comparison fails on the library as it was (three
 *     links against the shell's seven, and /app-catalog.html against /v1/appcat).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PUBLIC_LINKS, SIGNED_IN_LINKS, headerLinks, linkShown, brandPath } from '../../src/static/sdk-libs/header/nav.js';
import { headerPrelude } from '../../src/routes/libs/sdk-serve.js';
import { PUBLIC_NAV_LINK_IDS } from '../../src/services/site.js';

const here = dirname(fileURLToPath(import.meta.url));
const spa = readFileSync(join(here, '..', '..', 'public', 'spa.html'), 'utf8');

/** The shell's Header component, from its declaration to the end of its markup. */
function shellHeader(): string {
  const from = spa.indexOf('const PUBLIC_NAV_LINKS = [');
  const to = spa.indexOf('<span class="header-auth-slot" id="headerAuth">', from);
  expect(from, 'spa.html declares PUBLIC_NAV_LINKS').toBeGreaterThan(-1);
  expect(to, 'spa.html draws the header auth slot after its links').toBeGreaterThan(from);
  return spa.slice(from, to);
}

const user = { roles: ['user'] };
const operator = { roles: ['user', 'operator'] };
const ids = (links: Array<{ id: string }>) => links.map(l => l.id);
const seenBy = (site: unknown, nav: unknown, session: unknown) =>
  ids(headerLinks(site, nav).filter((l: { show: string }) => linkShown(l, session as never)));

describe('the served header carries the shell\'s links', () => {
  it('signed in: the same addresses in the same order as spa.html', () => {
    const header = shellHeader();
    // From the menu's own comment, past the compact bar's home icon that stands before the menu.
    const menu = header.indexOf('Where a signed-in person actually goes');
    expect(menu, 'the shell\'s menu names its signed-in links').toBeGreaterThan(-1);
    const block = header.slice(header.indexOf('${session && html`', menu), header.indexOf('<div class="topnav-center">', menu));
    const inShell = [...block.matchAll(/<a href="([^"$]+)"/g)].map(m => m[1]);
    expect(inShell.length, 'the shell\'s signed-in links were found').toBeGreaterThan(4);
    expect(SIGNED_IN_LINKS.map((l: { path: string }) => l.path)).toEqual(inShell);
  });

  it('public: the same ids, addresses and session state as PUBLIC_NAV_LINKS', () => {
    const header = shellHeader();
    const decl = header.slice(0, header.indexOf('];'));
    const inShell = [...decl.matchAll(/\{ id: '(\w+)',\s+(path|siteKey): '([^']+)',[^}]*\}/g)]
      .map(m => ({ id: m[1], where: m[3], anon: /when: 'anon'/.test(m[0]) }));
    expect(inShell.map(l => l.id)).toEqual([...PUBLIC_NAV_LINK_IDS]);
    expect(PUBLIC_LINKS.map((l: { id: string; path?: string; site?: string; when?: string }) =>
      ({ id: l.id, where: l.path ?? l.site, anon: l.when === 'anon' }))).toEqual(inShell);
  });

  it('no link opens the old catalogue page', () => {
    const all = headerLinks({ learn: 'https://learn.example' }, null);
    expect(all.some((l: { href: string }) => /app-catalog/.test(l.href))).toBe(false);
    expect(all.find((l: { id: string }) => l.id === 'apps').href).toBe('/v1/appcat');
  });
});

describe('who sees which link', () => {
  it('without a session: the marketing links and Help, and Learn only when the node has one', () => {
    expect(seenBy({}, null, null)).toEqual(['howItWorks', 'business', 'help']);
    expect(seenBy({ learn: 'https://learn.example' }, null, null)).toEqual(['howItWorks', 'learn', 'business', 'help']);
  });

  it('with a session: Help, then Home, Messages, Agents, Chat, Apps and Settings', () => {
    expect(seenBy({ learn: 'https://learn.example' }, null, user))
      .toEqual(['help', 'home', 'messages', 'agents', 'chat', 'apps', 'profile']);
  });

  it('an operator also gets Admin', () => {
    expect(seenBy({}, null, operator)).toEqual(['help', 'home', 'messages', 'agents', 'chat', 'apps', 'profile', 'admin']);
  });

  it('the operator\'s order and hidden list arrange the public links', () => {
    const nav = { order: ['help', 'business', 'learn', 'howItWorks'], hidden: ['business'] };
    expect(seenBy({ learn: 'https://learn.example' }, nav, null)).toEqual(['help', 'learn', 'howItWorks']);
    // A stored order that does not name a declared link keeps the link, and an unknown id is dropped.
    expect(seenBy({}, { order: ['help', 'bogus'], hidden: [] }, null)).toEqual(['help', 'howItWorks', 'business']);
  });

  it('a customer\'s node: Help only of the public links, and no Admin for its operator', () => {
    const site = { customerNode: true, learn: 'https://learn.example' };
    expect(seenBy(site, null, null)).toEqual(['help']);
    expect(seenBy(site, null, operator)).toEqual(['help', 'home', 'messages', 'agents', 'chat', 'apps', 'profile']);
  });

  it('a signed-in-only node: no link without a session', () => {
    expect(seenBy({ signedInOnly: true }, null, null)).toEqual([]);
    expect(seenBy({ signedInOnly: true }, null, user)).toEqual(['help', 'home', 'messages', 'agents', 'chat', 'apps', 'profile']);
  });

  it('the wordmark goes home for a signed-in person and to the front page otherwise', () => {
    expect(brandPath(true)).toBe('/v1/home');
    expect(brandPath(false)).toBe('/v1/portal');
    expect(spa).toContain("const brandPath = session ? '/v1/home' : '/v1/portal';");
  });
});

describe('the node\'s prelude for the header', () => {
  const cfg = (over: Record<string, unknown>, access = 'open') =>
    ({ contentAccess: access, siteLinks: { learn: '', purchasePlan: '', ...over } }) as never;
  const read = (src: string) => JSON.parse(src.replace(/^window\.__AIMEAT_HEADER_CFG__=/, '').replace(/;\n$/, ''));

  it('says nothing on a node with none of the three facts', () => {
    expect(headerPrelude(cfg({}))).toBe('window.__AIMEAT_HEADER_CFG__={};\n');
  });

  it('carries the Learn address, a customer\'s node and a signed-in-only node', () => {
    expect(read(headerPrelude(cfg({ learn: ' https://learn.example ' })))).toEqual({ learn: 'https://learn.example' });
    expect(read(headerPrelude(cfg({ purchasePlan: 'solo' })))).toEqual({ customerNode: true });
    expect(read(headerPrelude(cfg({}, 'signed-in')))).toEqual({ signedInOnly: true });
  });

  it('is safe to write into a script: the address is JSON-encoded', () => {
    const src = headerPrelude(cfg({ learn: 'https://x.example/"};alert(1);//' }));
    expect(read(src).learn).toBe('https://x.example/"};alert(1);//');
  });
});
