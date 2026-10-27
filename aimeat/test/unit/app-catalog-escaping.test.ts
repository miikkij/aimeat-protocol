/**
 * @file app-catalog-escaping.test.ts
 * @description Guards the app-catalog's HTML escaping (src/static/app-catalog/js/util.js). The
 *   catalog builds its markup by string concatenation and renders every published app card from a
 *   manifest its owner controls, so escapeHtml is the boundary between one owner's data and another
 *   owner's page. /app-catalog.html is served on the apex under a script-src that allows inline
 *   script, which is what turns an attribute break-out there into a session-stealing XSS rather
 *   than a cosmetic glitch (audit H-25).
 * @structure
 *   - escapeHtml: escapes all five HTML-significant characters, and leaves text legible
 *   - filterAttr: the H-25 regression test — a quote in a name or a tag stays inside the attribute
 *   - jsArg: unchanged, because the on* handler path depends on JS-level escaping
 * @usage pnpm exec vitest run test/unit/app-catalog-escaping.test.ts
 * @version-history
 *   v1.1.0 — 2026-10-27 — The version list's View button takes the address through jsArg; no on*
 *     handler argument is escaped with escapeHtml (secaudit2026oct26).
 *   v1.0.0 — 2026-08-11 — Created with the H-25 fix (stored XSS through the app catalogue).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { escapeHtml, filterAttr, jsArg } from '../../src/static/app-catalog/js/util.js';

/**
 * A published app name that closes the data-filter attribute and starts an event handler. This is
 * the exact shape the audit found: the publish route type-checks `name` and `tags` without
 * constraining their content, so this reaches the community grid verbatim.
 */
const BREAKOUT = 'x" onmouseover="alert(document.cookie)';

/**
 * Every attribute the catalog emits is double-quoted, so the pass-criterion for "cannot break out"
 * is exact rather than impressionistic: the returned fragment must contain exactly the quotes that
 * delimit its two attributes and not one more. A value holding zero " characters cannot end its
 * attribute early whatever else it contains.
 */
function quoteCount(s: string): number {
  return (s.match(/"/g) || []).length;
}

describe('escapeHtml', () => {
  it('escapes all five HTML-significant characters', () => {
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#39;');
  });

  it('escapes the ampersand first, so an entity is not double-encoded into visible text', () => {
    // Order matters: escaping < before & would turn a literal < into &amp;lt; and the user would
    // read "&lt;" on the card instead of "<".
    expect(escapeHtml('a < b & c')).toBe('a &lt; b &amp; c');
  });

  it('leaves ordinary text untouched, including non-ASCII', () => {
    expect(escapeHtml('Nuotta – säveltäjän työkalu 🎵')).toBe('Nuotta – säveltäjän työkalu 🎵');
  });

  it('renders null and undefined as empty rather than as the words', () => {
    // Callers pass optional manifest fields straight in. The DOM-based implementation this
    // replaced coerced both to '', and enough call sites rely on that to keep it.
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(0)).toBe('0');
  });
});

describe('filterAttr (audit H-25)', () => {
  it('keeps a quote in another owner’s app name inside the attribute', () => {
    const out = filterAttr(BREAKOUT, ['tools']);
    expect(quoteCount(out)).toBe(4);
    expect(out).not.toContain('onmouseover="');
  });

  it('keeps a quote in a tag inside the attribute', () => {
    // Tags travel the same path: publish filters the array by type, never by content.
    const out = filterAttr('Harmless name', [BREAKOUT]);
    expect(quoteCount(out)).toBe(4);
    expect(out).not.toContain('onmouseover="');
  });

  it('escapes an apostrophe too, so a single-quoted attribute added later is safe by default', () => {
    expect(filterAttr("Fatalii's", [])).toContain('&#39;');
  });

  it('still emits a searchable lowercase value for an ordinary name', () => {
    // applyServerFilter() reads these with getAttribute(), which returns the decoded original, so
    // the escaping must not disturb what the search sees for the normal case.
    const out = filterAttr('Budget Planner', ['Tools', 'Money']);
    expect(out).toBe(' data-filter="budget planner tools money" data-tags="tools,money"');
  });
});

describe('the version list View button (secaudit2026oct26)', () => {
  // The app's own address goes into viewPublished('<url>', ...) inside an onclick. encodeURIComponent
  // leaves the apostrophe as is, so a filename holding one ended the JS string when the address was
  // escaped with escapeHtml.
  it('no on* handler argument in the catalogue is escaped with escapeHtml', () => {
    const dir = fileURLToPath(new URL('../../src/static/app-catalog/js/', import.meta.url));
    const hits = readdirSync(dir).filter(f => f.endsWith('.js'))
      .flatMap(f => readFileSync(dir + f, 'utf8').split('\n').map((line, i) => ({ f, i: i + 1, line })))
      .filter(({ line }) => /\\'' \+ escapeHtml\(/.test(line));
    expect(hits.map(h => `${h.f}:${h.i}`)).toEqual([]);
  });

  it('an address with an apostrophe round-trips through jsArg, the HTML decode and the JS parse', () => {
    const viewU = 'https://node.example/v1/apps/alice/' + encodeURIComponent("pkg-alice-x-a'b.html") + '?version=2&mode=inline';
    const attr = "window.__seen.push('" + jsArg(viewU) + "')";
    const decoded = attr.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    const seen: string[] = [];
    new Function('window', decoded)({ __seen: seen });
    expect(seen).toEqual([viewU]);
  });
});

describe('jsArg', () => {
  it('escapes the apostrophe at the JS level, which escapeHtml cannot do for an on* handler', () => {
    // An attribute value is HTML-decoded before the JS engine parses it, so &#39; would arrive as
    // a bare apostrophe and end the argument string. jsArg emits a backslash escape that survives
    // the decode. This is why the two functions stayed separate after the H-25 fix.
    expect(jsArg("Fatalii's")).toBe("Fatalii\\'s");
    expect(jsArg('say "hi"')).toBe('say &quot;hi&quot;');
  });
});
