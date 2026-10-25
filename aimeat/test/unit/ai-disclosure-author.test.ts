/**
 * @file test/unit/ai-disclosure-author.test.ts
 * @description The node does not speak over an app's own AI-disclosure declaration
 *   (src/services/ai-disclosure-author.ts, through the real serve pass in app-serve-marks.ts).
 *
 *   Under the W3C AI Content Disclosure report (Final Community Group Report, 2026-10-09) the first
 *   `<meta name="ai-disclosure">` in the head is the page default and a valid value on `<html>`
 *   overrides it. So: an app with no declaration of its own gets exactly one meta and the `<html>`
 *   attribute, with a final value; an app with its own meta gets neither, its meta stays first and
 *   untouched, and the publish strip still takes back only the node's marks.
 * @usage pnpm exec vitest run test/unit/ai-disclosure-author.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial. aimeat.io served an app's own `ai-autonomous` meta followed by the
 *     node's draft-vocabulary `autonomous` meta.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyServeMarks } from '../../src/services/app-serve-marks.js';
import { stripServedMarks } from '../../src/services/app-serve-marks-strip.js';
import { authorDisclosure, traceAuthorDisclosure } from '../../src/services/ai-disclosure-author.js';
import { logger } from '../../src/utils/logger.js';
import { provFixture } from './serve-marks-fixtures.js';

const DISCLOSURE_META = /<meta\s+name="ai-disclosure"\s+content="([^"]*)"\s*\/?>/gi;
const metas = (html: string): string[] => [...html.matchAll(DISCLOSURE_META)].map((m) => m[1]);
const htmlTag = (html: string): string => /<html[^>]*>/i.exec(html)?.[0] ?? '';
const serve = (doc: string): string =>
  applyServeMarks(doc, { isDocument: true, provenance: provFixture('labelled') }).toString('utf-8');

/** The shape seen on laimeatsanomat.apps.aimeat.io on 2026-10-25: the app's own meta, self-closed. */
const OWN_META_DOC = '<!DOCTYPE html><html lang="fi"><head><meta charset="utf-8">'
  + '<meta name="ai-disclosure" content="ai-autonomous" /><title>t</title></head><body><p>x</p></body></html>';

const BARE_DOC = '<!DOCTYPE html><html lang="fi"><head><meta charset="utf-8"><title>t</title></head>'
  + '<body><p>x</p></body></html>';

describe('authorDisclosure reads what the author declared', () => {
  it('finds the first meta in the head, whatever the attribute order, quoting and case', () => {
    expect(authorDisclosure(OWN_META_DOC).meta).toBe('ai-autonomous');
    expect(authorDisclosure("<html><head><META content='Human-Only' NAME=ai-disclosure></head></html>").meta)
      .toBe('Human-Only');
    expect(authorDisclosure('<head><meta name="ai-disclosure" content="ai-assisted">'
      + '<meta name="ai-disclosure" content="ai-autonomous"></head>').meta).toBe('ai-assisted');
  });

  it('reads no declaration from a script, a comment or the body', () => {
    expect(authorDisclosure('<html><head><script>const t = \'<meta name="ai-disclosure" content="human-only">\';</script>'
      + '</head><body></body></html>').meta).toBeNull();
    expect(authorDisclosure('<html><head><!-- <meta name="ai-disclosure" content="human-only"> --></head></html>').meta)
      .toBeNull();
    expect(authorDisclosure('<html><head></head><body><meta name="ai-disclosure" content="human-only"></body></html>').meta)
      .toBeNull();
    expect(authorDisclosure(BARE_DOC)).toEqual({ meta: null, documentElement: null });
  });

  it('reads the attribute on <html>', () => {
    expect(authorDisclosure('<!DOCTYPE html><html lang="en" ai-disclosure="human-only"><head></head></html>').documentElement)
      .toBe('human-only');
  });
});

describe('the serve pass and the author\'s declaration', () => {
  it('an app with no declaration gets exactly one meta and the <html> attribute, with a final value', () => {
    const served = serve(BARE_DOC);
    expect(metas(served)).toEqual(['ai-autonomous']);
    expect(htmlTag(served)).toBe('<html lang="fi" ai-disclosure="ai-autonomous">');
    expect(served).toContain('<link rel="ai-provenance" href="https://aimeat.io/v1/provenance/prov_fixture_1">');
  });

  it('an app with its own meta gets no second meta and no <html> attribute; the record still travels', () => {
    const served = serve(OWN_META_DOC);
    expect(metas(served)).toEqual(['ai-autonomous']);
    expect(served.startsWith(OWN_META_DOC.slice(0, OWN_META_DOC.indexOf('<title>')))).toBe(true);
    expect(htmlTag(served)).toBe('<html lang="fi">');
    expect(served).toContain('<link rel="ai-provenance" href="https://aimeat.io/v1/provenance/prov_fixture_1">');
    expect(served).toContain('<script type="application/ld+json"');
  });

  it('the author\'s own words are served even when the record says otherwise', () => {
    const doc = OWN_META_DOC.replace('ai-autonomous', 'human-only');
    const served = serve(doc);
    expect(metas(served)).toEqual(['human-only']);
    expect(htmlTag(served)).toBe('<html lang="fi">');
  });

  it('the publish strip takes back only the node\'s marks, from either document', () => {
    for (const doc of [BARE_DOC, OWN_META_DOC]) {
      const out = stripServedMarks(Buffer.from(serve(doc), 'utf-8'));
      expect(out.data.toString('utf-8')).toBe(doc);
      expect(out.removed.map((r) => r.mark)).toEqual(['ai-disclosure']);
    }
  });
});

describe('a disagreement is traced once', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('logs once per app and value, and not at all when the values agree apart from case', () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => logger);
    const url = 'https://aimeat.io/v1/provenance/trace_case_1';
    traceAuthorDisclosure(url, 'ai-autonomous', { meta: 'AI-Autonomous', documentElement: null });
    expect(info).not.toHaveBeenCalled();
    traceAuthorDisclosure(url, 'ai-autonomous', { meta: 'human-only', documentElement: null });
    traceAuthorDisclosure(url, 'ai-autonomous', { meta: 'human-only', documentElement: null });
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][1]).toMatchObject({ where: 'meta', author: 'human-only', author_valid: true });
    traceAuthorDisclosure(url, 'ai-autonomous', { meta: null, documentElement: 'autonomous' });
    expect(info).toHaveBeenCalledTimes(2);
    expect(info.mock.calls[1][1]).toMatchObject({ where: 'html', author: 'autonomous', author_valid: false });
  });
});
