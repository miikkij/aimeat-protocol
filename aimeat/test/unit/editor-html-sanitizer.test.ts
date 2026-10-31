/**
 * @file test/unit/editor-html-sanitizer.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Toast UI editor sanitizes HTML with public/js/editor-html-sanitizer.js, not with
 *   the DOMPurify 2.3.3 bundled in Toast UI 3.2.2. In a real browser: raw HTML another member wrote
 *   reaches the Markdown preview with no foreign content (svg, math), no style or script, no event
 *   handler and no javascript: link, and an ordinary document (headings, emphasis, links, a stored
 *   image, a pasted data: image, a table, a task list) previews and converts to WYSIWYG and back to
 *   the same Markdown as before (secaudit2026oct31w2 round 10,
 *   toastui:dompurify-2.3.3-member-markdown-wysiwyg).
 *
 *   The browser half starts Chrome through playwright-core (the pinned headless build, else the
 *   installed Google Chrome) and is skipped, with a line saying so, on a machine that has neither.
 * @usage cd aimeat && pnpm exec vitest run test/unit/editor-html-sanitizer.test.ts
 * @version-history
 *   2026-10-31 — Initial (secaudit2026oct31w2 round 10).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';

const PUBLIC = resolve(__dirname, '../../public');
const ORIGIN = 'http://editor-harness.test';

describe('the editors use the node sanitizer', () => {
  for (const file of ['views/profile/organisms/document.js', 'components/MessageComposer.js']) {
    it(`${file} passes customHTMLSanitizer: sanitizeEditorHtml`, () => {
      const src = readFileSync(join(PUBLIC, file), 'utf8');
      expect(src).toMatch(/import \{ sanitizeEditorHtml \} from '\/js\/editor-html-sanitizer\.js'/);
      expect(src).toMatch(/customHTMLSanitizer: sanitizeEditorHtml/);
    });
  }
  it('spa.html maps the module in its importmap', () => {
    expect(readFileSync(join(PUBLIC, 'spa.html'), 'utf8')).toContain('"/js/editor-html-sanitizer.js": "/js/editor-html-sanitizer.js"');
  });
});

async function startBrowser(): Promise<Browser | null> {
  for (const opts of [{ headless: true }, { headless: true, channel: 'chrome' }]) {
    try { return await chromium.launch(opts); } catch { /* try the next */ }
  }
  return null;
}

const browser = await startBrowser();
if (!browser) console.log('editor-html-sanitizer: no Chrome on this machine, the browser cases are skipped');

/** Open the Markdown-mode editor on `markdown` with the node sanitizer, read the preview and the round trip. */
async function preview(page: Page, markdown: string) {
  return page.evaluate(async (md) => {
    const w = window as unknown as { toastui: { Editor: new (o: object) => { changeMode(m: string): void; getMarkdown(): string; destroy(): void } }; __san: (h: string) => string; __pwn: number };
    w.__pwn = 0;
    const el = document.getElementById('ed')!;
    el.innerHTML = '';
    const ed = new w.toastui.Editor({ el, height: '300px', initialEditType: 'markdown', previewStyle: 'tab', initialValue: md, usageStatistics: false, customHTMLSanitizer: w.__san });
    await new Promise((r) => setTimeout(r, 250));
    const prev = el.querySelector('.toastui-editor-md-preview .toastui-editor-contents')!;
    const out = {
      html: prev.innerHTML,
      foreign: prev.querySelectorAll('svg, math, style, script, iframe, object, embed, template').length,
      handlers: Array.from(prev.querySelectorAll('*')).some((n) => Array.from(n.attributes).some((a) => a.name.startsWith('on'))),
      jsLinks: Array.from(prev.querySelectorAll('[href]')).some((n) => /^\s*javascript:/i.test(n.getAttribute('href') ?? '')),
      markers: document.querySelectorAll('[id^="pwn"]').length,
      pwn: w.__pwn,
      roundTrip: '',
    };
    ed.changeMode('wysiwyg');
    await new Promise((r) => setTimeout(r, 150));
    ed.changeMode('markdown');
    out.roundTrip = ed.getMarkdown();
    ed.destroy();
    return out;
  }, markdown);
}

describe.skipIf(!browser)('in a real browser, with Toast UI 3.2.2', () => {
  let page: Page;
  beforeAll(async () => {
    page = await browser!.newPage();
    await page.route(`${ORIGIN}/**`, (route) => {
      const p = new URL(route.request().url()).pathname;
      if (p === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head></head><body><div id="ed"></div></body></html>' });
      if (!/^\/(lib\/toastui|js)\/[\w.@-]+$/.test(p)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ contentType: p.endsWith('.css') ? 'text/css' : 'text/javascript', body: readFileSync(join(PUBLIC, p)) });
    });
    await page.goto(`${ORIGIN}/`);
    await page.addScriptTag({ url: `${ORIGIN}/lib/toastui/toastui-editor-all.min.js` });
    // A string, so the test runner does not rewrite the browser's import().
    await page.evaluate("(async () => { window.__san = (await import('/js/editor-html-sanitizer.js')).sanitizeEditorHtml; })()");
  }, 60_000);
  afterAll(async () => { await browser?.close(); }, 30_000);

  const ATTACKS = [
    '<math><mtext><table><mglyph><style><img src=x id=pwn1 onerror=window.__pwn=1></style></mglyph></table></mtext></math>',
    '<svg><p><style><img src=x id=pwn2 onerror=window.__pwn=2></style></p></svg>',
    '<form><math><mtext></form><form><mglyph><style></math><img src=x id=pwn3 onerror=window.__pwn=3>',
    '<noscript><p title="</noscript><img src=x id=pwn4 onerror=window.__pwn=4>"></noscript>',
    '<a href=" jav&#x09;ascript:window.__pwn=5" id=x5>link</a><img src="javascript:1"><iframe srcdoc="<b>x</b>"></iframe>',
    '<!-- --><template><img src=x id=pwn6></template><div onclick="window.__pwn=6">d</div>',
  ];
  for (const [i, a] of ATTACKS.entries()) {
    it(`raw HTML from another member is inert in the preview (${i + 1})`, async () => {
      const r = await preview(page, a);
      expect(r.foreign).toBe(0);
      expect(r.handlers).toBe(false);
      expect(r.jsLinks).toBe(false);
      expect(r.markers).toBe(0);
      expect(r.pwn).toBe(0);
    });
  }

  it('an ordinary document previews and round-trips as before', async () => {
    const md = [
      '# Title', '', 'Some **bold**, *italic* and ~~gone~~ text with a [link](https://example.com).', '',
      '![stored](/v1/storage/u/doc/a.png)', '', '![pasted](data:image/png;base64,iVBORw0KGgo=)', '',
      '| a | b |', '| --- | --- |', '| 1 | 2 |', '', '* [ ] todo', '* [x] done', '', '> quote', '', '```js', 'const x = 1;', '```',
    ].join('\n');
    const r = await preview(page, md);
    expect(r.html).toContain('<h1');
    expect(r.html).toContain('href="https://example.com"');
    expect(r.html).toContain('src="/v1/storage/u/doc/a.png"');
    expect(r.html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(r.html).toContain('<table');
    expect(r.html).toMatch(/data-nodeid=/);
    expect(r.html).toMatch(/class="task-list-item[^"]*checked/);
    expect(r.roundTrip).toContain('# Title');
    expect(r.roundTrip).toContain('[link](https://example.com)');
    expect(r.roundTrip).toContain('![stored](/v1/storage/u/doc/a.png)');
    expect(r.roundTrip).toContain('* [x] done');
  });
});
