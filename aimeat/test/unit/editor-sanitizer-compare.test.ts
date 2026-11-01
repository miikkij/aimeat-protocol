/**
 * @file test/unit/editor-sanitizer-compare.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two candidates for the Toast UI editors' `customHTMLSanitizer`, compared on equal
 *   terms in a real browser (secaudit2026oct31w2 round 10b): the hand-written sanitizer of round 10
 *   (now the test fixture test/fixtures/editor-sanitizer/editor-html-sanitizer-walker.js) and
 *   DOMPurify 3.4.17 (public/lib/dompurify@3.4.17/) with the same allow lists, as the editors load it
 *   through public/js/editor-html-sanitizer.js. Each input goes through the sanitizer as the editor
 *   uses it and into Toast UI 3.2.2's Markdown preview. On 2026-11-01 both counted zero on every
 *   vector and kept the same preview and round trip, so the editors switched to DOMPurify.
 *   1. Security: the round-10 inputs plus published mutation-XSS and namespace-confusion vectors.
 *      Counted per sanitizer: a payload that ran, an event handler kept, a javascript:, vbscript: or
 *      data:text URL kept, svg or math foreign content kept, and any other element outside the allow
 *      list. The DOMPurify 3.4.17 tarball ships no test suite (only dist/, src/ and the licences), so
 *      the extra vectors are written from the published write-ups named beside each one.
 *   2. Fidelity: the round-10 ordinary document and a second one with inline HTML keep their preview
 *      and round-trip through WYSIWYG to the same Markdown.
 *   3. Speed: the median of 20 runs over the HTML Toast UI hands the sanitizer for a 200 kB and a
 *      2 MB realistic document.
 *   The table of the three is printed (and written to the file EDITOR_COMPARE_OUT names). The
 *   assertions hold both to zero on every security count and DOMPurify to the walker's preview and
 *   round trip; speed is reported, not asserted.
 *
 *   The browser half starts Chrome through playwright-core (the pinned headless build, else the
 *   installed Google Chrome) and is skipped, with a line saying so, on a machine that has neither.
 * @usage cd aimeat && EDITOR_COMPARE_OUT=<file> pnpm exec vitest run test/unit/editor-sanitizer-compare.test.ts
 * @version-history
 *   2026-11-01 — Initial (secaudit2026oct31w2 round 10b).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';

const PUBLIC = resolve(__dirname, '../../public');
const FIXTURES = resolve(__dirname, '../fixtures');
const ORIGIN = 'http://editor-compare.test';

async function startBrowser(): Promise<Browser | null> {
  for (const opts of [{ headless: true }, { headless: true, channel: 'chrome' }]) {
    try { return await chromium.launch(opts); } catch { /* try the next */ }
  }
  return null;
}

const browser = await startBrowser();
if (!browser) console.log('editor-sanitizer-compare: no Chrome on this machine, the browser cases are skipped');

/** The round-10 inputs (test/unit/editor-html-sanitizer.test.ts), then the published vectors. */
const VECTORS: Array<[string, string]> = [
  ['r10-1 math mtext table mglyph style', '<math><mtext><table><mglyph><style><img src=x id=pwn1 onerror=window.__pwn=1></style></mglyph></table></mtext></math>'],
  ['r10-2 svg p style', '<svg><p><style><img src=x id=pwn2 onerror=window.__pwn=2></style></p></svg>'],
  ['r10-3 form math mtext mglyph', '<form><math><mtext></form><form><mglyph><style></math><img src=x id=pwn3 onerror=window.__pwn=3>'],
  ['r10-4 noscript title', '<noscript><p title="</noscript><img src=x id=pwn4 onerror=window.__pwn=4>"></noscript>'],
  ['r10-5 tab in javascript: link, js img, iframe srcdoc', '<a href=" jav&#x09;ascript:window.__pwn=5" id=x5>link</a><img src="javascript:1"><iframe srcdoc="<b>x</b>"></iframe>'],
  ['r10-6 comment, template, onclick', '<!-- --><template><img src=x id=pwn6></template><div onclick="window.__pwn=6">d</div>'],
  // DOMPurify 2.0.0 bypass (Masato Kinugawa / Michal Bentkowski, 2019): svg, </p> and style namespace switch.
  ['svg </p> style namespace switch', '<svg></p><style><a id="</style><img src=x onerror=window.__pwn=7>">'],
  // DOMPurify 2.0.17 bypass (Bentkowski, "Mutation XSS via namespace confusion", Securitum 2020).
  ['math mtext table mglyph style comment', '<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;/mglyph&gt;&lt;img&Tab;src=x&Tab;onerror=window.__pwn=8&gt;">'],
  // DOMPurify 2.2.2 bypass (Bentkowski, 2020): mglyph and svg mtext textarea.
  ['math mi mglyph svg mtext textarea', '<math><mi><mglyph><svg><mtext><textarea><path id="</textarea><img onerror=window.__pwn=9 src=x>">'],
  // DOMPurify 2.2.3 bypass (Securitum, 2020): heading nesting moves mglyph out of mtext.
  ['math mtext h1 a h6 mglyph svg style', '<math><mtext><h1><a><h6></a></h6><mglyph><svg><mtext><style><a title="</style><img src=x onerror=window.__pwn=10>"></style></h1>'],
  ['svg annotation-xml foreignobject style comment', '<svg><annotation-xml><foreignobject><style><!--</style><p id="--><img src=x onerror=window.__pwn=11>">'],
  ['math annotation-xml text/html style', '<math><annotation-xml encoding="text/html"><style><img src=x onerror=window.__pwn=12></style></annotation-xml></math>'],
  // Raw-text and RCDATA element confusion (PortSwigger and Sonar mXSS cheat sheets).
  ['xmp title', '<xmp><p title="</xmp><img src=x onerror=window.__pwn=13>">'],
  ['iframe title', '<iframe><p title="</iframe><img src=x onerror=window.__pwn=14>">'],
  ['noembed title', '<noembed><p title="</noembed><img src=x onerror=window.__pwn=15>">'],
  ['textarea title', '<textarea><p title="</textarea><img src=x onerror=window.__pwn=16>">'],
  ['title title', '<title><p title="</title><img src=x onerror=window.__pwn=17>">'],
  ['noframes title', '<noframes><p title="</noframes><img src=x onerror=window.__pwn=18>">'],
  // Customizable select parsing (Chrome 2025; DOMPurify 3.2.x and 3.4.x selectedcontent fixes).
  ['select template style comment', '<select><template><style><!--</style><a rel="--></template></select><img src=x onerror=window.__pwn=19>">'],
  ['select selectedcontent', '<select><button><selectedcontent></selectedcontent></button><option><img src=x onerror=window.__pwn=20>x</option></select>'],
  ['comment breakout', '<!--<img src="--><img src=x onerror=window.__pwn=21//">'],
  // DOMPurify 3.1.3 SAFE_FOR_XML fix (CVE-2024-45801 family): processing instruction and CDATA.
  ['processing instruction', '<?xml-stylesheet > <img src=x onerror=window.__pwn=22> ?>'],
  ['svg CDATA', '<svg><![CDATA[><img src=x onerror=window.__pwn=23>]]></svg>'],
  ['svg a xlink:href javascript', '<svg><a xlink:href="javascript:window.__pwn=24"><text x="20" y="20">x</text></a></svg>'],
  ['math href javascript', '<math href="javascript:window.__pwn=25"><mi>x</mi></math>'],
  ['button formaction', '<form id="f26"></form><button form="f26" formaction="javascript:window.__pwn=26">x</button>'],
  ['encoded javascript: links', '<a href="javas&#99;ript:window.__pwn=27">a</a><a href="&#x6A;avascript:window.__pwn=27">b</a><a href="javascript&colon;window.__pwn=27">c</a><a href="JaVaScRiPt:window.__pwn=27">d</a><a href="&#1;javascript:window.__pwn=27">e</a>'],
  ['data:text/html link', '<a href="data:text/html,&lt;script&gt;window.__pwn=28&lt;/script&gt;">x</a>'],
  ['details ontoggle', '<details open ontoggle="window.__pwn=29"><summary>s</summary>x</details>'],
  ['unclosed img', '<img src=x onerror=window.__pwn=30//'],
  ['markdown javascript links', '[x](javascript:window.__pwn=31) ![y](javascript:window.__pwn=31) <javascript:window.__pwn=31>'],
  ['html block around markdown', '<div title="\nx">\n\n<img src=x onerror=window.__pwn=32>\n\n</div>'],
  ['table caption svg style', '<table><caption><svg><style><img src=x onerror=window.__pwn=33></style></svg></caption></table>'],
  ['declarative shadow root', '<div><template shadowrootmode="open"><img src=x onerror=window.__pwn=34></template></div>'],
  ['style import, base, meta refresh', '<style>@import "/x.css";</style><base href="javascript:/"><meta http-equiv="refresh" content="0;url=javascript:window.__pwn=35"><p>x</p>'],
  ['object and embed', '<object data="javascript:window.__pwn=36"></object><embed src="javascript:window.__pwn=36">'],
  ['img onload on a data image', '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" onload="window.__pwn=37">'],
  ['form math mglyph svg mtext style', '<form><math><mtext></form><form><mglyph><svg><mtext><style><path id="</style><img onerror=window.__pwn=38 src=x>">'],
  ['noscript style', '<noscript><style></noscript><img src=x onerror=window.__pwn=39>'],
  ['svg foreignObject img', '<svg><foreignObject><img src=x onerror=window.__pwn=40></foreignObject></svg>'],
  ['svg animate href', '<svg><a><animate attributeName="href" values="javascript:window.__pwn=41"/><text x="20" y="20">x</text></a></svg>'],
  ['math maction xlink', '<math><maction actiontype="statusline" xlink:href="javascript:window.__pwn=42">x</maction></math>'],
  ['img srcset onerror', '<img srcset="x 1x" onerror="window.__pwn=43">'],
  ['vbscript link', '<a href="vbscript:msgbox(1)">x</a>'],
];

/** The ordinary documents: the round-10 one and one with the inline HTML people write. */
const ORDINARY = [
  ['# Title', '', 'Some **bold**, *italic* and ~~gone~~ text with a [link](https://example.com).', '',
    '![stored](/v1/storage/u/doc/a.png)', '', '![pasted](data:image/png;base64,iVBORw0KGgo=)', '',
    '| a | b |', '| --- | --- |', '| 1 | 2 |', '', '* [ ] todo', '* [x] done', '', '> quote', '', '```js', 'const x = 1;', '```'].join('\n'),
  ['## Notes', '', 'Press <kbd>Ctrl</kbd>+<kbd>S</kbd>. H<sub>2</sub>O and x<sup>2</sup>, <mark>marked</mark>.', '',
    '<details><summary>More</summary>', '', 'Hidden *text*.', '', '</details>', '',
    '1. one', '2. two', '   * nested', '', '<span class="note" title="t">a span</span> and <a href="mailto:a@b.c">mail</a>', '',
    '---', '', '<p align="center"><img src="https://example.com/i.png" alt="i" width="40"></p>'].join('\n'),
];

/** A realistic document of about `bytes` bytes: headings, prose, lists, tables, code, quotes, inline HTML. */
function realisticDoc(bytes: number): string {
  const out: string[] = [];
  let size = 0;
  for (let i = 0; size < bytes; i++) {
    const before = out.length;
    out.push(`## Section ${i}`, '',
      `The team met on day ${i} to review **progress** on the *roadmap*. See [the spec](https://example.com/spec/${i}) and \`config.yaml\` for details; the open question is whether the importer keeps the original timestamps.`, '',
      `- item ${i}.1 with a [link](/v1/docs#${i})`, `- item ${i}.2 with ~~old~~ new text`, `- [ ] task ${i}`, `- [x] done ${i}`, '',
      '| Name | Owner | Status | Due |', '| --- | --- | --- | --- |',
      `| Import ${i} | alice | open | 2026-11-0${i % 9 + 1} |`, `| Export ${i} | bob | done | 2026-12-0${i % 9 + 1} |`, '',
      '```ts', `export const v${i} = compute(${i}, { retries: 3 });`, '```', '',
      `> Quote ${i}: keep the answer short.`, '',
      `Press <kbd>Ctrl</kbd>+<kbd>K</kbd>, see <span class="note">note ${i}</span> and ![img ${i}](/v1/storage/u/doc/${i}.png).`, '');
    for (let j = before; j < out.length; j++) size += out[j]!.length + 1;
  }
  return out.join('\n');
}

/** Toast UI numbers its preview nodes with a counter that runs on across editors; equal previews differ only there. */
const withoutNodeIds = (html: string) => html.replace(/ data-nodeid="\d+"/g, '');

type Sanitizer = 'own' | 'dompurify';
const SANITIZER_FN: Record<Sanitizer, string> = { own: '__own', dompurify: '__purify' };

/** Open the Markdown-mode editor on `markdown` with one sanitizer, read the preview, the counts and the round trip. */
async function preview(page: Page, markdown: string, fn: string) {
  return page.evaluate(async ({ md, fn }) => {
    type Ed = { changeMode(m: string): void; getMarkdown(): string; destroy(): void };
    const w = window as unknown as Record<string, unknown> & { toastui: { Editor: new (o: object) => Ed }; __pwn: number };
    w.__pwn = 0;
    const el = document.getElementById('ed')!;
    el.innerHTML = '';
    const ed = new w.toastui.Editor({ el, height: '300px', initialEditType: 'markdown', previewStyle: 'tab', initialValue: md, usageStatistics: false, customHTMLSanitizer: w[fn] as (h: string) => string });
    await new Promise((r) => setTimeout(r, 300));
    const prev = el.querySelector('.toastui-editor-md-preview .toastui-editor-contents')!;
    const KEEP = new Set(['a','abbr','b','bdi','bdo','blockquote','br','caption','center','cite','code','col','colgroup','dd','del','details','dfn','div','dl','dt','em','figcaption','figure','h1','h2','h3','h4','h5','h6','hr','i','img','ins','kbd','li','mark','ol','p','pre','q','rp','rt','ruby','s','samp','small','span','strike','strong','sub','summary','sup','table','tbody','td','tfoot','th','thead','time','tr','u','ul','var','wbr']);
    const all = Array.from(prev.querySelectorAll('*'));
    const bad = (v: string) => /^(javascript|vbscript|data:text)/i.test(v.replace(/[\x00-\x20\x7f-\xa0]/g, ''));
    const out = {
      html: prev.innerHTML,
      foreign: prev.querySelectorAll('svg, math').length,
      handlers: all.filter((n) => Array.from(n.attributes).some((a) => a.name.toLowerCase().startsWith('on'))).length,
      badUrls: all.filter((n) => Array.from(n.attributes).some((a) => /^(href|src|xlink:href|action|formaction|data|srcdoc)$/i.test(a.name) && bad(a.value))).length,
      notAllowed: all.filter((n) => !KEEP.has(n.localName) && n.namespaceURI === 'http://www.w3.org/1999/xhtml').map((n) => n.localName),
      pwn: w.__pwn,
      roundTrip: '',
    };
    // Toast UI 3.2.2's own Markdown-to-WYSIWYG converter throws on some malformed inline HTML
    // (htmlInline reads a null match) whichever sanitizer runs; that is recorded, not counted.
    try {
      ed.changeMode('wysiwyg');
      await new Promise((r) => setTimeout(r, 150));
      ed.changeMode('markdown');
      out.roundTrip = ed.getMarkdown();
    } catch (e) {
      out.roundTrip = `TOAST UI ERROR: ${(e as Error).message}`;
    }
    try { ed.destroy(); } catch { /* the editor may be half converted */ }
    return out;
  }, { md: markdown, fn });
}

/** The HTML strings Toast UI hands its sanitizer while it previews `markdown` (recorded through the own sanitizer). */
async function sanitizerInputs(page: Page, markdown: string): Promise<number> {
  return page.evaluate(async (md) => {
    type Ed = { destroy(): void };
    const w = window as unknown as { toastui: { Editor: new (o: object) => Ed }; __own: (h: string) => string; __inputs: string[] };
    w.__inputs = [];
    const el = document.getElementById('ed')!;
    el.innerHTML = '';
    const ed = new w.toastui.Editor({ el, height: '300px', initialEditType: 'markdown', previewStyle: 'tab', initialValue: md, usageStatistics: false,
      customHTMLSanitizer: (h: string) => { w.__inputs.push(h); return w.__own(h); } });
    await new Promise((r) => setTimeout(r, 300));
    ed.destroy();
    return w.__inputs.reduce((n, s) => n + s.length, 0);
  }, markdown);
}

/** Median milliseconds of 20 runs of one sanitizer over the recorded inputs (two warm-up runs first). */
async function medianMs(page: Page, fn: string): Promise<number> {
  return page.evaluate((fn) => {
    const w = window as unknown as Record<string, unknown> & { __inputs: string[] };
    const san = w[fn] as (h: string) => string;
    const times: number[] = [];
    for (let i = 0; i < 22; i++) {
      const t0 = performance.now();
      for (const s of w.__inputs) san(s);
      if (i >= 2) times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return (times[9]! + times[10]!) / 2;
  }, fn);
}

describe.skipIf(!browser)('own sanitizer and DOMPurify 3.4.17, in a real browser with Toast UI 3.2.2', () => {
  let page: Page;
  const table: Record<Sanitizer, { ran: number; handlers: number; badUrls: number; foreign: number; notAllowed: number; failed: string[] }> = {
    own: { ran: 0, handlers: 0, badUrls: 0, foreign: 0, notAllowed: 0, failed: [] },
    dompurify: { ran: 0, handlers: 0, badUrls: 0, foreign: 0, notAllowed: 0, failed: [] },
  };
  const fidelity: string[] = [];
  const speed: string[] = [];

  beforeAll(async () => {
    page = await browser!.newPage();
    await page.route(`${ORIGIN}/**`, (route) => {
      const p = new URL(route.request().url()).pathname;
      if (p === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head></head><body><div id="ed"></div></body></html>' });
      if (p === '/fixtures/editor-html-sanitizer-walker.js') {
        return route.fulfill({ contentType: 'text/javascript', body: readFileSync(join(FIXTURES, 'editor-sanitizer/editor-html-sanitizer-walker.js')) });
      }
      if (!/^\/(lib\/toastui|lib\/dompurify@3\.4\.17|js)\/[\w.@-]+$/.test(p)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ contentType: p.endsWith('.css') ? 'text/css' : 'text/javascript', body: readFileSync(join(PUBLIC, p)) });
    });
    await page.goto(`${ORIGIN}/`);
    await page.addScriptTag({ url: `${ORIGIN}/lib/toastui/toastui-editor-all.min.js` });
    // Strings, so the test runner does not rewrite the browser's import().
    await page.evaluate("(async () => { window.__own = (await import('/fixtures/editor-html-sanitizer-walker.js')).sanitizeEditorHtml; })()");
    await page.evaluate("(async () => { window.__purify = (await import('/js/editor-html-sanitizer.js')).sanitizeEditorHtml; window.__purifyVersion = window.DOMPurify && window.DOMPurify.version; })()");
  }, 60_000);

  afterAll(async () => {
    const rows = (['own', 'dompurify'] as Sanitizer[]).map((s) => {
      const t = table[s];
      return `| ${s} | ${t.ran} | ${t.handlers} | ${t.badUrls} | ${t.foreign} | ${t.notAllowed} | ${t.failed.join('; ') || '-'} |`;
    });
    const report = [
      `editor-sanitizer-compare: ${VECTORS.length} vectors`,
      '| sanitizer | ran | handler kept | bad URL kept | svg/math kept | other element outside allow list | vectors with any count |',
      '| --- | --- | --- | --- | --- | --- | --- |', ...rows, '', ...fidelity, '', ...speed,
    ].join('\n');
    console.log(report);
    // The runner hides the console of a passing file; EDITOR_COMPARE_OUT names a file to keep the table in.
    if (process.env.EDITOR_COMPARE_OUT) writeFileSync(process.env.EDITOR_COMPARE_OUT, report + '\n');
    await browser?.close();
  }, 30_000);

  it('loads DOMPurify 3.4.17 from the vendored file', async () => {
    expect(await page.evaluate('window.__purifyVersion')).toBe('3.4.17');
  });

  for (const s of ['own', 'dompurify'] as Sanitizer[]) {
    it(`security: ${s} over every vector`, async () => {
      const toastErrors: string[] = [];
      for (const [name, md] of VECTORS) {
        const r = await preview(page, md, SANITIZER_FN[s]);
        const t = table[s];
        const hit = (r.pwn ? 1 : 0) + r.handlers + r.badUrls + r.foreign + r.notAllowed.length;
        t.ran += r.pwn ? 1 : 0; t.handlers += r.handlers; t.badUrls += r.badUrls; t.foreign += r.foreign; t.notAllowed += r.notAllowed.length;
        if (hit) t.failed.push(`${name} (${[r.pwn ? 'ran' : '', r.handlers ? 'handler' : '', r.badUrls ? 'url' : '', r.foreign ? 'foreign' : '', r.notAllowed.join(',')].filter(Boolean).join(' ')})`);
        if (r.roundTrip.startsWith('TOAST UI ERROR')) toastErrors.push(name);
      }
      if (toastErrors.length) fidelity.push(`Toast UI's WYSIWYG converter threw with ${s} on: ${toastErrors.join('; ')}`);
      // Both were zero on 2026-11-01. The editors use DOMPurify; the walker is held to its round-10 result.
      expect(table[s].failed).toEqual([]);
    }, 120_000);
  }

  it('fidelity: both sanitizers keep the ordinary documents\' preview and round trip', async () => {
    for (const [i, md] of ORDINARY.entries()) {
      const own = await preview(page, md, '__own');
      const pur = await preview(page, md, '__purify');
      const sameHtml = withoutNodeIds(own.html) === withoutNodeIds(pur.html);
      fidelity.push(`ordinary document ${i + 1}: preview HTML ${sameHtml ? 'identical' : 'DIFFERS'} (Toast UI node numbers aside), round trip ${own.roundTrip === pur.roundTrip ? 'identical' : 'DIFFERS'}`);
      if (!sameHtml) fidelity.push(`  own:       ${own.html.slice(0, 2000)}`, `  dompurify: ${pur.html.slice(0, 2000)}`);
      if (own.roundTrip !== pur.roundTrip) fidelity.push(`  own md:       ${JSON.stringify(own.roundTrip)}`, `  dompurify md: ${JSON.stringify(pur.roundTrip)}`);
      expect(withoutNodeIds(pur.html)).toBe(withoutNodeIds(own.html));
      expect(pur.roundTrip).toBe(own.roundTrip);
      expect(pur.roundTrip.startsWith('TOAST UI ERROR')).toBe(false);
    }
  }, 60_000);

  it('blob: and data:image sources stay on images, and a _blank link gets noopener', async () => {
    const out = await page.evaluate(() => (window as unknown as { __purify: (h: string) => string }).__purify(
      '<img src="blob:http://editor-compare.test/1234" alt="b"><img src="data:image/png;base64,iVBORw0KGgo="><img src="data:text/html,x"><a href="blob:http://x/1">l</a><a href="https://e.com" target="_blank">t</a><a href="https://e.com" target="_top">u</a>'));
    expect(out).toContain('src="blob:http://editor-compare.test/1234"');
    expect(out).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(out).not.toContain('data:text/html');
    expect(out).not.toContain('href="blob:');
    expect(out).toContain('target="_blank" rel="noopener noreferrer"');
    expect(out).not.toContain('_top');
  });

  // The 200 kB document goes through the real editor and its sanitizer input is recorded. The 2 MB
  // input is that recorded HTML ten times over: the full editor takes minutes to lay out 2 MB, and the
  // sanitizer's work is the same per byte of the same kind of HTML.
  it('speed: median of 20 runs on a 200 kB and a 2 MB realistic document', async () => {
    const html = await sanitizerInputs(page, realisticDoc(200_000));
    for (const [label, copies] of [['200 kB', 1], ['2 MB', 10]] as const) {
      await page.evaluate((n) => {
        const w = window as unknown as { __inputs: string[]; __base?: string[] };
        w.__base ??= w.__inputs;
        w.__inputs = [w.__base.join('').repeat(n)];
      }, copies);
      const own = await medianMs(page, '__own');
      const pur = await medianMs(page, '__purify');
      speed.push(`speed ${label} Markdown (${Math.round((html * copies) / 1000)} kB HTML to the sanitizer): own ${own.toFixed(1)} ms, DOMPurify ${pur.toFixed(1)} ms (median of 20)`);
    }
  }, 600_000);
});
