/**
 * @file test/unit/app-serve-marks-strip.test.ts
 * @description What a publish takes back out of a served copy (src/services/app-serve-marks-strip.ts).
 *
 *   THE DECISION THESE HOLD (2026-09-13). An app published with HTML that carries the node's own
 *   serve marks is stored without them, the response names what came out, and the publish is not
 *   refused. The node skips a mark that is already in a document, so a baked-in badge ignored the
 *   owner switching it off, a baked-in AI-disclosure block described a version that no longer
 *   existed, and a baked-in `#aimeat-app-ref` made a copy published by one owner read as another
 *   owner's app.
 *
 *   The spine of the file is a round trip through the REAL serve pass: serve a document, strip it,
 *   and the author's bytes come back exactly. A mark added to applyServeMarks without a rule in the
 *   strip turns that red, which is what keeps the two from drifting apart. The other half is
 *   silence: an app's own element that only looks like a mark is never touched.
 * @usage pnpm exec vitest run test/unit/app-serve-marks-strip.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial. Every case here was run against a strip that removed nothing and
 *     failed on its assertion before the implementation existed (the silence cases passed, as a
 *     strip that removes nothing is trivially silent; they guard the implementation, not the stub).
 */
import { describe, it, expect } from 'vitest';
import { applyServeMarks, type ServeMarksSpec } from '../../src/services/app-serve-marks.js';
import {
  stripServedMarks, servedMarksResponse, type ServedMarkKind,
} from '../../src/services/app-serve-marks-strip.js';
import { agentDiscoverySnippet, type AppDiscoverySpec } from '../../src/utils/app-agent-discovery.js';
import { SERVE_MARK_CASES, FIXTURE_CONFIG, provFixture } from './serve-marks-fixtures.js';

const strip = (s: string | Buffer) => stripServedMarks(typeof s === 'string' ? Buffer.from(s, 'utf-8') : s);
const kinds = (s: string | Buffer): ServedMarkKind[] => strip(s).removed.map((r) => r.mark).sort();

const DISCOVERY: AppDiscoverySpec = {
  owner: 'alice', filename: 'demo.html', appName: 'Demo', description: 'A demo app',
  baseUrl: 'https://aimeat.io', toolNames: ['search', 'summarise'], webmcp: true,
};

/** Every document shape the golden corpus already holds, each a trap that cost something. */
const DOCS = [...new Set(SERVE_MARK_CASES.map((c) => c.html))];

/**
 * Every mark the pass can write at once, head metadata aside (see the head-metadata section below).
 * No reviewer here: a declared reviewer lifts the visible content label, so the two never meet.
 */
const FULL: ServeMarksSpec = {
  isDocument: true,
  badge: true,
  provenance: provFixture('labelled'),
  visibleLabel: { config: FIXTURE_CONFIG, locale: 'fi' },
  discovery: DISCOVERY,
};

const SPECS: Array<[string, ServeMarksSpec, ServedMarkKind[]]> = [
  ['every mark', FULL,
    ['agent-discovery', 'ai-disclosure', 'ai-label', 'app-ref', 'badge', 'chrome-reserve']],
  ['every mark with a named reviewer, which lifts the visible label', { ...FULL, reviewedBy: 'Maija Meikäläinen' },
    ['agent-discovery', 'ai-disclosure', 'app-ref', 'badge', 'chrome-reserve', 'reviewed-by']],
  ['badge only', { isDocument: true, badge: true }, ['badge', 'chrome-reserve']],
  ['a quiet record, no label owed', { isDocument: true, provenance: provFixture('quiet'), visibleLabel: { config: FIXTURE_CONFIG, locale: 'en' } },
    ['ai-disclosure', 'chrome-reserve']],
  ['machine marks without the visible label', { isDocument: true, provenance: provFixture('labelled') }, ['ai-disclosure']],
  ['discovery without the WebMCP bridge', { isDocument: true, discovery: { ...DISCOVERY, webmcp: false } }, ['agent-discovery', 'app-ref']],
  ['the reviewer alone', { isDocument: true, reviewedBy: 'Jane "J" <Reviewer>' }, ['reviewed-by']],
];

describe('stripServedMarks: a served copy comes back as the author\'s bytes', () => {
  for (const doc of DOCS) {
    for (const [label, spec, expected] of SPECS) {
      it(`${label} on ${JSON.stringify(doc.slice(0, 40))}…`, () => {
        const served = applyServeMarks(doc, spec);
        expect(served.toString('utf-8')).not.toBe(doc);
        const out = strip(served);
        expect(out.data.toString('utf-8')).toBe(doc);
        expect(out.removed.map((r) => r.mark).sort()).toEqual(expected);
        expect(out.removed.reduce((n, r) => n + r.bytes, 0)).toBe(served.length - Buffer.byteLength(doc));
      });
    }
  }

  it('serving the stripped copy again gives exactly what the first serve gave: one of each mark', () => {
    for (const doc of DOCS) {
      const once = applyServeMarks(doc, FULL);
      const again = applyServeMarks(strip(once).data, FULL);
      expect(again.toString('utf-8')).toBe(once.toString('utf-8'));
      for (const id of ['aimeat-app-badge', 'aimeat-app-ref', 'aimeat-agent-discovery', 'aimeat-ai-provenance', 'aimeat-ai-label']) {
        expect(again.toString('utf-8').split(`id="${id}"`).length).toBe(2);
      }
    }
  });

  it('is idempotent, and a document with no marks comes back as the same Buffer', () => {
    const served = applyServeMarks(DOCS[0] as string, FULL);
    const once = strip(served);
    const twice = strip(once.data);
    expect(twice.removed).toEqual([]);
    expect(twice.data).toBe(once.data);
  });

  it('leaves every byte outside the marks alone, including bytes that are not valid UTF-8', () => {
    // A Latin-1 é and a lone 0xFF: a decode to UTF-8 and back would turn both into U+FFFD.
    const before = Buffer.from('<!doctype html><html><head><title>caf', 'latin1');
    const odd = Buffer.from([0xe9, 0xff]);
    const after = Buffer.from('</title></head><body><p>x</p></body></html>', 'latin1');
    const author = Buffer.concat([before, odd, after]);
    const marks = applyServeMarks('<html><head></head><body></body></html>', { badge: true }).toString('latin1');
    const body = marks.slice(marks.indexOf('<style id="aimeat-chrome-reserve">'), marks.indexOf('</body>'));
    const served = Buffer.concat([before, odd, Buffer.from('</title></head><body><p>x</p>' + body + '</body></html>', 'latin1')]);
    const out = strip(served);
    expect(out.removed.map((r) => r.mark).sort()).toEqual(['badge', 'chrome-reserve']);
    expect(Buffer.compare(out.data, author)).toBe(0);
  });
});

/**
 * A copy served before 2026-09-13 carries the identity block at the END of the body, inside the
 * discovery markup, with HTML-escaped JSON. Copies from before 2026-07-16 carry the first badge, an
 * `<a>` with inline styles, and copies from before 2026-08-02 the two-value reserve declaration.
 * All of them are still being republished, so all of them strip.
 */
describe('stripServedMarks: copies served by earlier versions of the pass', () => {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const DOC = '<!DOCTYPE html><html lang="fi"><head><meta charset="utf-8"><title>Demo</title></head><body><h1>Hei</h1></body></html>';

  /** agentDiscoverySnippet as it was until 2026-09-13 (git 3cc14fae6^): the ref block between the noscript and the bridge. */
  function legacyDiscovery(spec: AppDiscoverySpec): string {
    const now = agentDiscoverySnippet(spec);
    const at = now.indexOf('</noscript>') + '</noscript>'.length;
    const tools = (spec.toolNames ?? []).filter(Boolean);
    return now.slice(0, at)
      + '<script type="application/json" id="aimeat-app-ref">'
      + esc(JSON.stringify({ owner: spec.owner, app_id: spec.filename, app: `${spec.owner}/${spec.filename}`, tools }))
      + '</script>'
      + now.slice(at);
  }

  /** The first badge (2026-06-24 to 2026-07-16, git a77175d02): one `<a>`, raw UTF-8 glyphs. */
  const V1_BADGE = '<a id="aimeat-app-badge" href="https://aimeat.io/" target="_blank" rel="noopener noreferrer" '
    + 'aria-label="aimeat.io — publish your own app" style="position:fixed!important;right:12px!important;">'
    + '<span style="color:#E8564A!important">⚡</span><span>aimeat.io</span>'
    + '<span style="opacity:.7!important;font-weight:500!important">· Publish your own app — free</span></a>';

  /** The reserve declaration of 2026-08-02 (git 5c44e651c), before it became one value. */
  const V1_RESERVE = '<style id="aimeat-chrome-reserve">:root{--aimeat-chrome-bottom:56px}'
    + '@media (max-width:640px){:root{--aimeat-chrome-bottom:96px}}</style>';

  const bodyEnd = (html: string, snippet: string) => html.replace('</body>', `${snippet}</body>`);

  it('the identity block at the end of the body, with HTML-escaped JSON, strips with the discovery block around it', () => {
    const served = bodyEnd(DOC, legacyDiscovery(DISCOVERY));
    expect(served).toContain('&quot;owner&quot;');
    const out = strip(served);
    expect(out.data.toString('utf-8')).toBe(DOC);
    expect(out.removed.map((r) => r.mark).sort()).toEqual(['agent-discovery', 'app-ref']);
  });

  it('the first badge, an <a> carrying raw UTF-8, and the two-value reserve strip', () => {
    const served = bodyEnd(DOC, V1_RESERVE + V1_BADGE);
    const out = strip(served);
    expect(out.data.toString('utf-8')).toBe(DOC);
    expect(out.removed.map((r) => r.mark).sort()).toEqual(['badge', 'chrome-reserve']);
  });

  it('a copy republished before the strip existed and then served again carries two generations, and both strip', () => {
    // Stored with the legacy body marks baked in; the current pass then adds only what was missing.
    const stored = bodyEnd(DOC, V1_BADGE + legacyDiscovery(DISCOVERY));
    const servedAgain = applyServeMarks(stored, FULL).toString('utf-8');
    const out = strip(servedAgain);
    expect(out.data.toString('utf-8')).toBe(DOC);
  });
});

/**
 * The silence half. Each of these is an app's OWN markup that shares a name, a shape or the exact
 * text of a mark, and the strip must leave every byte of it where it was.
 */
describe('stripServedMarks: an app\'s own markup that only resembles a mark is left alone', () => {
  const LOOKALIKES: Array<[string, string]> = [
    ['the badge markup inside the app\'s JavaScript',
      '<script>const tpl = \'<div id="aimeat-app-badge"><b>x</b></div>\';</script>'],
    ['the reserve declaration inside a comment',
      '<!-- <style id="aimeat-chrome-reserve">:root{--aimeat-chrome-bottom:56px}</style> -->'],
    ['the identity block inside a template string',
      '<script>var t = `<script type="application/json" id="aimeat-app-ref">{}<\\/script>`;</script>'],
    ['a class that shares the badge\'s name', '<div class="aimeat-app-badge">mine</div>'],
    ['a longer id that starts with the badge\'s', '<div id="aimeat-app-badge-open">mine</div>'],
    ['the author\'s own ai-disclosure meta, away from any node block', '<meta name="ai-disclosure" content="none">'],
    ['the author\'s own author meta', '<meta name="author" content="Jane">'],
    ['the mcp-server link on its own', '<link rel="mcp-server" href="/.well-known/mcp.json">'],
    ['a noscript with no id', '<noscript><pre>Enable JavaScript</pre></noscript>'],
    ['a JSON script with a different id', '<script type="application/json" id="app-config">{"a":1}</script>'],
    ['the author\'s own JSON-LD', '<script type="application/ld+json">{"@type":"Thing"}</script>'],
    ['a near-miss label id', '<div id="aimeat-ai-labels" role="group">mine</div>'],
    ['a badge opening tag that never closes', '<div id="aimeat-app-badge"><p>unfinished'],
    ['the app\'s own link carrying the first badge\'s id', '<a id="aimeat-app-badge" href="/about">about</a>'],
    ['getElementById on a mark', '<script>document.getElementById("aimeat-app-badge"); document.querySelector(\'meta[name="aimeat-reviewed-by"]\')</script>'],
  ];

  for (const [label, snippet] of LOOKALIKES) {
    it(label, () => {
      const doc = `<!DOCTYPE html><html lang="en"><head><title>t</title>${snippet}</head><body>${snippet}<p>x</p></body></html>`;
      const input = Buffer.from(doc, 'utf-8');
      const out = strip(input);
      expect(out.removed).toEqual([]);
      expect(out.data.toString('utf-8')).toBe(doc);
    });
  }

  it('keeps the author\'s own ai-disclosure attribute when no node block vouches for it', () => {
    const doc = '<!DOCTYPE html><html lang="en" ai-disclosure="ai-generated"><head></head><body></body></html>';
    expect(kinds(doc)).toEqual([]);
  });

  it('keeps the author\'s ai-disclosure attribute even beside a node block, when the values differ', () => {
    // markDocumentElement leaves an attribute the author already wrote, so the node's meta says
    // one thing and the author's attribute another; only the node's block goes.
    const doc = '<!DOCTYPE html><html lang="en" ai-disclosure="none"><head></head><body><p>x</p></body></html>';
    const served = applyServeMarks(doc, { isDocument: true, provenance: provFixture('labelled') });
    const out = strip(served);
    expect(out.data.toString('utf-8')).toBe(doc);
    expect(out.removed.map((r) => r.mark)).toEqual(['ai-disclosure']);
  });

  it('strips the served marks around the app\'s own lookalikes and keeps every one of them', () => {
    // Each lookalike sits where it is most likely to be mistaken: the author's own author meta
    // directly before the node's reviewer pair, the author's ai-disclosure meta and mcp-server link
    // in the head, a class sharing the badge's name and an id-less noscript beside the node's.
    const doc = '<!DOCTYPE html><html lang="en"><head><title>t</title>'
      + '<meta name="ai-disclosure" content="autonomous"><link rel="mcp-server" href="/.well-known/mcp.json">'
      + '<meta name="author" content="Jane"></head><body>'
      + '<div class="aimeat-app-badge">mine</div><noscript><pre>Enable JavaScript</pre></noscript></body></html>';
    const served = applyServeMarks(doc, { ...FULL, reviewedBy: 'Maija' }).toString('utf-8');
    expect(served).toContain('<meta name="author" content="Jane"><meta name="author" content="Maija">');
    const out = strip(served);
    expect(out.data.toString('utf-8')).toBe(doc);
    expect(out.removed.map((r) => r.mark).sort())
      .toEqual(['agent-discovery', 'ai-disclosure', 'app-ref', 'badge', 'chrome-reserve', 'reviewed-by']);
  });
});

/**
 * The head metadata has NO marker of its own today: every tag it adds is one an author may write
 * (description, og:*, canonical, manifest, theme-color, the SoftwareApplication JSON-LD), so the
 * strip cannot tell the node's from the author's and leaves them. This case pins that, and it is
 * the one to change when the head-metadata pass gains the sentinel proposed with this work.
 */
describe('stripServedMarks: the head metadata the app-origin serve adds', () => {
  const headCases = SERVE_MARK_CASES.filter((c) => c.headMeta);

  it('takes out every mark that has a marker and leaves the head metadata, which has none', () => {
    for (const c of headCases) {
      const served = applyServeMarks(c.html, {
        badge: c.badge, provenance: c.prov ? provFixture(c.prov) : undefined,
        visibleLabel: c.visible ? { config: FIXTURE_CONFIG, locale: 'en' } : undefined,
        discovery: c.discovery, headMeta: c.headMeta,
      }).toString('utf-8');
      const out = strip(served).data.toString('utf-8');
      for (const id of ['aimeat-app-badge', 'aimeat-app-ref', 'aimeat-agent-discovery', 'aimeat-ai-provenance', 'aimeat-ai-label', 'aimeat-chrome-reserve']) {
        expect(out, `${c.name}: ${id}`).not.toContain(`id="${id}"`);
      }
    }
  });

  it('with nothing but the badge and the head metadata, what is left is exactly the head metadata', () => {
    const c = headCases.find((x) => x.name === 'full-doc/head-meta-indexable');
    expect(c).toBeTruthy();
    const served = applyServeMarks(c!.html, { badge: true, headMeta: c!.headMeta });
    expect(strip(served).data.toString('utf-8')).toBe(applyServeMarks(c!.html, { headMeta: c!.headMeta }).toString('utf-8'));
  });
});

describe('servedMarksResponse: what every door renders', () => {
  it('renders nothing when nothing was removed, or when the result carries no removal at all', () => {
    expect(servedMarksResponse({ servedMarksRemoved: [] })).toEqual({});
    expect(servedMarksResponse({ filename: 'x.html' })).toEqual({});
  });

  it('names each removal and says, in words, what happened', () => {
    const removed = strip(applyServeMarks('<html><head></head><body></body></html>', FULL)).removed;
    const out = servedMarksResponse({ servedMarksRemoved: removed });
    expect(out.served_marks_removed).toEqual(removed);
    const note = out.served_marks_note ?? '';
    expect(note).toContain('attribution badge');
    expect(note).toContain('#aimeat-app-ref');
    expect(note).toContain('AI-disclosure');
    expect(note).toContain('download_url');
    expect(note).not.toMatch(/—/);
  });
});
