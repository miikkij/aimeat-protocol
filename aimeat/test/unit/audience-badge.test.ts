/**
 * @file test/unit/audience-badge.test.ts
 * @description The AudienceBadge's words (plan doc-mvcn6c7e4e5q, V6.4): every stored audience a kind
 *   keeps reads into one level (public/js/audience.js), each level has its words in en, fi and es, and
 *   `pnpm check:audience-badge` (scripts/check-audience-badge.ts) passes the tree as it stands and
 *   refuses a view that stopped drawing the badge, a comment that only names it, and a view that moved.
 * @usage cd aimeat && pnpm exec vitest run test/unit/audience-badge.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V6.4).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUDIENCE_LEVELS, audienceOf, appAudienceOf, shareAudienceOf, exposureAudienceOf, audienceKeys,
} from '../../public/js/audience.js';
import { AUDIENCE_VIEWS, audienceBadgeFindings } from '../../scripts/check-audience-badge.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readReal = (file: string): string | null => (existsSync(join(root, file)) ? readFileSync(join(root, file), 'utf8') : null);

describe('audienceOf: every stored value a kind keeps', () => {
  it.each([
    ['public', 'public'], ['system', 'public'],
    ['members', 'signed-in'], ['signed-in', 'signed-in'], ['community', 'signed-in'], ['account', 'signed-in'],
    ['link', 'link'], ['open', 'link'], ['unlisted', 'link'],
    ['code', 'code'], ['password', 'code'],
    ['private', 'private'], ['owner', 'private'], ['shared', 'private'], ['group', 'private'], ['workspace', 'private'],
  ])('%s → %s', (value, level) => {
    expect(audienceOf(value).level).toBe(level);
  });

  it('organism:<id> keeps the id; a bare prefix is not one', () => {
    expect(audienceOf('organism:abc-123')).toEqual({ level: 'organism', organismId: 'abc-123' });
    expect(audienceOf('organism:').level).toBe('private');
  });

  it('nothing, or a value it does not know, is never read wider than private', () => {
    for (const v of [undefined, null, '', 'everyone', 42, {}]) expect(audienceOf(v).level).toBe('private');
  });

  it('a code and a password are one level, said apart', () => {
    expect(audienceOf('code').secret).toBe('code');
    expect(audienceOf('password').secret).toBe('password');
  });
});

describe('appAudienceOf: the code first, then open_to, then the listing', () => {
  it('an access code wins over everything else', () => {
    expect(appAudienceOf({ protected: true, open_to: 'anyone', listing: 'listed' }).level).toBe('code');
    expect(appAudienceOf({ access_code: 'x', listing: 'listed' }).level).toBe('code');
  });
  it('open_to signed-in or an organism decides before the listing', () => {
    expect(appAudienceOf({ open_to: 'signed-in', listing: 'listed' }).level).toBe('signed-in');
    expect(appAudienceOf({ open_to: 'organism:o1', listing: 'listed' })).toEqual({ level: 'organism', organismId: 'o1' });
  });
  it('open to anyone: listed is public, community and unlisted open with the link', () => {
    expect(appAudienceOf({ open_to: 'anyone', listing: 'listed' }).level).toBe('public');
    expect(appAudienceOf({ open_to: 'anyone', listing: 'community' }).level).toBe('link');
    expect(appAudienceOf({ listing: 'unlisted' }).level).toBe('link');
    expect(appAudienceOf({ parked: true }).level).toBe('link');
    expect(appAudienceOf({}).level).toBe('public');
  });
});

describe('shareAudienceOf and exposureAudienceOf', () => {
  it('a workspace share: open, password, account, organism', () => {
    expect(shareAudienceOf('open', 'o1').level).toBe('link');
    expect(shareAudienceOf(undefined, 'o1').level).toBe('link');
    expect(shareAudienceOf('password', 'o1')).toEqual({ level: 'code', secret: 'password' });
    expect(shareAudienceOf('account', 'o1').level).toBe('signed-in');
    expect(shareAudienceOf('organism', 'o1')).toEqual({ level: 'organism', organismId: 'o1' });
  });
  it('an exposure report item, with its organism', () => {
    expect(exposureAudienceOf({ level: 'organism', organism_id: 'o2' })).toEqual({ level: 'organism', organismId: 'o2' });
    for (const lv of ['public', 'link', 'signed-in']) expect(exposureAudienceOf({ level: lv }).level).toBe(lv);
    expect(exposureAudienceOf({ level: 'organism' }).level).toBe('private');
    expect(exposureAudienceOf(null).level).toBe('private');
  });
});

describe('audienceKeys: the words of every level exist in every language', () => {
  const locales = ['en', 'fi', 'es'].map((tag) => [tag, JSON.parse(readFileSync(join(root, 'locales', `${tag}.json`), 'utf8'))] as const);
  const lookup = (o: Record<string, unknown>, key: string): unknown => (key in o ? o[key] : key.split('.').reduce<unknown>((x, k) => (x as Record<string, unknown> | undefined)?.[k], o));
  const every = [
    ...AUDIENCE_LEVELS.map((level) => ({ level })),
    { level: 'code', secret: 'password' },
  ];

  it('an organism with a name says the name; without one it says so in other words', () => {
    expect(audienceKeys({ level: 'organism' }, true).word).toBe('audience.organism');
    expect(audienceKeys({ level: 'organism' }, false).word).toBe('audience.organismUnnamed');
    expect(audienceKeys({ level: 'code', secret: 'password' }).word).toBe('audience.password');
    expect(audienceKeys({ level: 'signed-in' }).word).toBe('audience.signedIn');
    expect(audienceKeys({ level: 'nonsense' }).word).toBe('audience.private');
  });

  it.each(locales)('%s carries the badge word and its sentence for every level', (_tag, file) => {
    for (const a of every) {
      for (const named of [true, false]) {
        const { word, who } = audienceKeys(a, named);
        expect(typeof lookup(file, word), word).toBe('string');
        expect(typeof lookup(file, who), who).toBe('string');
      }
    }
    expect(String(lookup(file, 'audience.organism'))).toContain('{name}');
  });
});

describe('check:audience-badge', () => {
  it('passes the tree as it stands', () => {
    expect(audienceBadgeFindings(AUDIENCE_VIEWS, readReal)).toEqual([]);
  });

  it('refuses a view whose badge is gone, even when a comment still names it', () => {
    const view = AUDIENCE_VIEWS[0]!.file;
    const found = audienceBadgeFindings(AUDIENCE_VIEWS, (f) => (f === view
      ? "// import { AudienceBadge } from '/components/AudienceBadge.js';\n/* <${AudienceBadge} value=${v} /> */\nexport function V() {}"
      : readReal(f)));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(view);
  });

  it('refuses a view that imports the badge and draws the stored word instead', () => {
    const view = AUDIENCE_VIEWS[3]!.file;
    const found = audienceBadgeFindings(AUDIENCE_VIEWS, (f) => (f === view
      ? "import { AudienceBadge } from '/components/AudienceBadge.js';\nexport const x = (v) => html`<${Mark}>${v}<//>`;"
      : readReal(f)));
    expect(found).toHaveLength(1);
  });

  it('names a listed view that is no longer there', () => {
    const found = audienceBadgeFindings([{ file: 'public/views/profile/gone.js', shows: 'nothing' }], readReal);
    expect(found[0]).toContain('not found');
  });
});
