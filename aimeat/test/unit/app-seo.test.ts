import { describe, it, expect } from 'vitest';
import {
  appSeoIndexable, appSeoState, appSeoMeta, appDeclaredLocales,
} from '../../src/services/app-seo.js';
import type { AimeatConfig } from '../../src/config.js';
import type { AppSummaryRecord } from '../../src/storage/types/apps.js';

/**
 * THE HOLE THIS FILE IS THE MEMORY OF.
 *
 * Publishing an app was also, silently, a decision to have it indexed. Every published app that
 * was not access-coded and not priced went into the node's sitemap index and served
 * `User-agent: * / Allow: /` on its own origin, and its owner had exactly two states to choose
 * between: parked (gone from every surface) or fully public and indexed. There was nothing in
 * between, and no per-app brake for an operator whose domain was being used to farm keywords.
 *
 * The decision is now one function, because four surfaces ask it — the sitemap index, the app
 * origin's robots.txt, the X-Robots-Tag on the served document, and the head metadata — and four
 * copies of a rule is the exact shape that has already cost this project the same defect three
 * times inside one MCP tool.
 *
 * These tests are about the order of the reasons as much as the answers. Each reason has to
 * survive the ones after it: an owner switching their own toggle must not clear an operator's
 * block, and a gated app must not be reported as blocked when it was never eligible.
 */

const cfg = (over: Partial<AimeatConfig> = {}): AimeatConfig => ({
  seoIndexing: 'on',
  appsSeoMode: 'owner',
  baseUrl: 'https://node.example',
  ...over,
} as unknown as AimeatConfig);

const app = (over: Record<string, unknown> = {}): AppSummaryRecord => ({
  ownerGaii: 'alice@node-1',
  ownerName: 'alice',
  filename: 'notes.html',
  versionNumber: 1,
  mimeType: 'text/html',
  size: 10,
  createdAt: '2026-08-01T00:00:00.000Z',
  manifest: { name: 'Notes', description: 'A place for notes.', tags: ['notes', 'writing'] },
  ...over,
} as unknown as AppSummaryRecord);

/** The common case: an owner who has switched search visibility on. */
const visible = (manifestOver: Record<string, unknown> = {}, over: Record<string, unknown> = {}) =>
  app({ manifest: { ...app().manifest, seo: { index: true }, ...manifestOver }, ...over });

describe('appSeoState', () => {
  it('is off for a freshly published app, because nobody asked for it', () => {
    expect(appSeoState(app(), cfg())).toBe('off');
    expect(appSeoIndexable(app(), cfg())).toBe(false);
  });

  it('is on once the owner switches it on', () => {
    expect(appSeoState(visible(), cfg())).toBe('on');
    expect(appSeoIndexable(visible(), cfg())).toBe(true);
  });

  it('reports a gated app as gated, not as off', () => {
    // An operator reading a list needs to know WHICH reason applies: "off" invites them to ask the
    // owner to switch it on, and no switch would help here.
    expect(appSeoState(app({ accessCode: 'hunter2' }), cfg())).toBe('gated');
    expect(appSeoState(app({ manifest: { ...app().manifest, priceMorsels: 5 } }), cfg())).toBe('gated');
    // …and it stays gated even with the owner's switch on, because the switch was never the issue.
    expect(appSeoState(visible({}, { accessCode: 'hunter2' }), cfg())).toBe('gated');
  });

  it('reports a parked or operator-hidden app as hidden', () => {
    expect(appSeoState(visible({}, { parked: true }), cfg())).toBe('hidden');
    expect(appSeoState(visible({}, { operatorHidden: true }), cfg())).toBe('hidden');
  });

  it('lets the operator block one app without the owner being able to undo it', () => {
    // The owner's switch is ON here. The block still wins, and it has to: an owner who could clear
    // it by toggling their own control would have no block at all.
    const blocked = visible({}, { operatorSeoBlocked: true });
    expect(appSeoState(blocked, cfg())).toBe('blocked');
    expect(appSeoIndexable(blocked, cfg())).toBe(false);
  });

  it('holds an app at pending in review mode until an operator approves it', () => {
    const requested = visible({ seo: { index: true, requestedAt: '2026-08-02T00:00:00Z' } });
    expect(appSeoState(requested, cfg({ appsSeoMode: 'review' }))).toBe('pending');
    expect(appSeoIndexable(requested, cfg({ appsSeoMode: 'review' }))).toBe(false);

    const approved = visible({ seo: { index: true, approvedBy: 'operator', approvedAt: '2026-08-03T00:00:00Z' } });
    expect(appSeoState(approved, cfg({ appsSeoMode: 'review' }))).toBe('on');
    expect(appSeoIndexable(approved, cfg({ appsSeoMode: 'review' }))).toBe(true);
  });

  it('ignores a stale approval when the operator is not the one deciding', () => {
    // In owner mode the owner's switch is the whole decision, so an approval left over from a
    // period of review mode neither adds nor removes anything.
    const approved = visible({ seo: { index: true, approvedBy: 'operator' } });
    expect(appSeoState(approved, cfg({ appsSeoMode: 'owner' }))).toBe('on');
    const notSwitchedOn = app({ manifest: { ...app().manifest, seo: { approvedBy: 'operator' } } });
    expect(appSeoState(notSwitchedOn, cfg({ appsSeoMode: 'owner' }))).toBe('off');
  });

  it('refuses everything while the node-wide switch is off', () => {
    // An operator who turned discovery off did not mean "except for the apps".
    expect(appSeoIndexable(visible(), cfg({ seoIndexing: 'off' }))).toBe(false);
  });
});

describe('appSeoMeta', () => {
  it('derives from what the app already declares', () => {
    const m = appSeoMeta(visible());
    expect(m.title).toBe('Notes');
    expect(m.description).toBe('A place for notes.');
    expect(m.keywords).toEqual(['notes', 'writing']);
  });

  it('prefers the owner\'s overrides where they wrote one', () => {
    const m = appSeoMeta(visible({
      seo: { index: true, title: 'Notes for teams', description: 'Shared notes.', keywords: ['teams'] },
    }));
    expect(m.title).toBe('Notes for teams');
    expect(m.description).toBe('Shared notes.');
    expect(m.keywords).toEqual(['teams']);
  });

  it('falls back to a sentence naming the owner when the app describes nothing', () => {
    const bare = app({ manifest: { seo: { index: true } } });
    const m = appSeoMeta(bare);
    expect(m.title).toBe('notes');
    expect(m.description).toContain('alice');
  });

  it('takes the language from what the app declares, never from a guess', () => {
    // The bug this replaces: the literal 'en' was stamped on every app whose author omitted the
    // attribute, on a corpus that is substantially Finnish.
    expect(appSeoMeta(visible(), { documentLocales: ['fi', 'en'] }).lang).toBe('fi');
    expect(appSeoMeta(visible({ seo: { index: true, lang: 'sv' } }), { documentLocales: ['fi'] }).lang).toBe('sv');
    // Nothing declared: empty, so the caller leaves the document's own lang alone rather than
    // asserting something it does not know.
    expect(appSeoMeta(visible()).lang).toBe('');
  });

  it('uses the app\'s own screenshot as the social image unless the owner named another', () => {
    expect(appSeoMeta(visible(), { screenshotUrl: 'https://node.example/shot.png' }).image)
      .toBe('https://node.example/shot.png');
    expect(appSeoMeta(visible({ seo: { index: true, image: 'https://cdn.example/a.png' } }),
      { screenshotUrl: 'https://node.example/shot.png' }).image).toBe('https://cdn.example/a.png');
    expect(appSeoMeta(visible()).image).toBe('');
  });
});

describe('appDeclaredLocales', () => {
  it('reads the locales an app declares for itself', () => {
    const doc = '<!doctype html><html><head><meta name="aimeat-locales" content="fi en"></head>';
    expect(appDeclaredLocales(doc)).toEqual(['fi', 'en']);
    expect(appDeclaredLocales(Buffer.from(doc))).toEqual(['fi', 'en']);
  });

  it('returns nothing when the app declares nothing, rather than guessing', () => {
    expect(appDeclaredLocales('<!doctype html><html><head></head>')).toEqual([]);
  });

  it('does not scan a megabyte of app to find a tag that lives in the head', () => {
    const late = `${'<div></div>'.repeat(2000)}<meta name="aimeat-locales" content="fi">`;
    expect(appDeclaredLocales(late)).toEqual([]);
  });
});
