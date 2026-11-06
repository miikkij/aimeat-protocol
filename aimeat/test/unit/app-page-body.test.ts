/**
 * @file test/unit/app-page-body.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The app's name and description in the document as sent (TARGET-089 V1): a visible
 *   `<h1>` and paragraph at the start of the body, escaped, never positioned or hidden, and in the
 *   same place for the document shapes the published corpus holds, including one with no `</head>`.
 * @version-history
 *   v1.0.0 — 2026-11-06 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { applyServeMarks } from '../../src/services/app-serve-marks.js';
import { appPageBodySnippet } from '../../src/utils/app-page-body.js';

const BODY = { name: 'Noste', description: 'Laskee nostovoiman ja näyttää kuorman.', lang: 'fi' };
const serve = (html: string, appBody = BODY) => applyServeMarks(html, { isDocument: true, appBody }).toString('utf-8');

describe('appPageBodySnippet', () => {
  it('writes the name as the h1 and the description as a paragraph, both escaped', () => {
    const out = appPageBodySnippet({ name: 'A & <b>', description: '"x" </div>', lang: 'fi' });
    expect(out).toContain('<h1>A &amp; &lt;b&gt;</h1>');
    expect(out).toContain('<p>&quot;x&quot; &lt;/div&gt;</p>');
    expect(out).toContain('<div id="aimeat-app-body" lang="fi">');
    expect(out.split('</div>').length).toBe(2);
  });

  it('hides nothing: no hidden, no positioning, no zero size, no transparency', () => {
    const out = appPageBodySnippet(BODY);
    expect(out).not.toMatch(/display:\s*none|visibility:\s*hidden|position:|opacity:\s*0|font-size:\s*0|height:\s*0|\bhidden\b|clip/i);
  });

  it('leaves out a paragraph when there is no description, and a lang that is not a language tag', () => {
    const out = appPageBodySnippet({ name: 'X', description: '  ', lang: 'fi" onload="x' });
    expect(out).not.toContain('<p>');
    expect(out).toContain('<div id="aimeat-app-body">');
  });
});

describe('applyServeMarks with appBody', () => {
  it('opens the body with the block', () => {
    const out = serve('<!DOCTYPE html><html><head><title>t</title></head>\n<!-- c -->\n<body class="x"><canvas></canvas></body></html>');
    expect(out).toMatch(/<body class="x"><div id="aimeat-app-body" lang="fi">.*<h1>Noste<\/h1><p>Laskee nostovoiman ja näyttää kuorman\.<\/p>.*<\/div><canvas>/s);
  });

  it('is written at the end of the body when the body does not directly follow the head', () => {
    const doc = '<html><head><script>const t = "<body>";</script></head><div>first</div><body><p>x</p></body></html>';
    const out = serve(doc);
    expect(out.indexOf('<div id="aimeat-app-body"')).toBeGreaterThan(out.indexOf('<p>x</p>'));
    expect(out).toContain('const t = "<body>";</script>');
  });

  it('is written at the end of a document that has neither </head> nor <body>', () => {
    const out = serve('<!-- app --><meta charset="utf-8"><div id="root"></div><script>1</script>');
    expect(out.endsWith('</div>')).toBe(true);
    expect(out.startsWith('<!-- app --><meta charset="utf-8"><div id="root"></div>')).toBe(true);
  });

  it('is written once, however often a copy is served', () => {
    const once = serve('<html><head></head><body></body></html>');
    expect(serve(once).split('id="aimeat-app-body"').length).toBe(2);
  });

  it('leaves the bytes as they were when the caller asks for no body', () => {
    const doc = '<html><head></head><body><p>x</p></body></html>';
    expect(applyServeMarks(doc, { isDocument: true }).toString('utf-8')).toBe(doc);
  });
});
