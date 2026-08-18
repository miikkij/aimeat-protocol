/**
 * @file scripts/carousel/slides.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The slide markup and styling, in one place. make.mjs prints it to PDF and
 *   preview.mjs shoots it to PNG; sharing the module is what makes the preview evidence about
 *   the PDF rather than a lookalike. (The first version copied the CSS as text and the
 *   template placeholders never got substituted, so the preview lied about the page size.)
 * @structure  SIZE, css(), slideHtml(), buildHtml()
 * @version-history
 *   v1.0.0 — 2026-07-26 — extracted from make.mjs so the preview renders the same thing
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** LinkedIn shows a document page as a square card in the feed. */
export const SIZE = 1080;

export function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    ));
}

export function css() {
    return `
  @page { size: ${SIZE}px ${SIZE}px; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: "Inter", "Segoe UI", system-ui, sans-serif; color: #14161A; background: #fff; }
  .page {
    width: ${SIZE}px; height: ${SIZE}px; padding: 64px 64px 56px; background: #FBFAF8;
    display: flex; flex-direction: column; position: relative; page-break-after: always; overflow: hidden;
  }
  .page:last-child { page-break-after: auto; }
  .kicker { font-size: 22px; letter-spacing: .14em; text-transform: uppercase; color: #E8564A; font-weight: 700; }
  h2 { font-size: 44px; line-height: 1.15; margin: 14px 0 0; font-weight: 700; letter-spacing: -.015em; }
  .head { flex: 0 0 auto; }
  .shot {
    flex: 1 1 auto; margin-top: 36px; display: flex; align-items: center; justify-content: center; min-height: 0;
  }
  .shot img {
    max-width: 100%; max-height: 100%; object-fit: contain;
    border-radius: 14px; box-shadow: 0 24px 60px rgba(20,22,26,.16); background: #fff;
  }
  /* a tall frame reads better cropped at the top than shrunk to a stamp */
  .shot.top { align-items: flex-start; overflow: hidden; }
  .shot.top img { max-height: none; width: auto; height: auto; object-position: top center; }
  .num { position: absolute; right: 64px; bottom: 40px; font-size: 20px; color: #8A8F98; }
  .cover, .end { justify-content: center; background: #14161A; color: #FBFAF8; }
  .cover .mark, .end .mark {
    font-size: 24px; letter-spacing: .34em; color: #E8564A; font-weight: 800; margin-bottom: 34px;
  }
  .cover h1, .end h1 { font-size: 72px; line-height: 1.07; margin: 0 0 34px; letter-spacing: -.02em; }
  .end h1 { font-size: 58px; }
  .cover p, .end p { font-size: 29px; line-height: 1.44; margin: 0 0 18px; color: #C9CDD4; max-width: 880px; }
  .links { margin-top: 36px; font-size: 29px; color: #E8564A; line-height: 1.6; }
  .cover .num, .end .num { color: #6B7079; }
`;
}

export function slideHtml(s, i, total, imgDir) {
    if (s.kind === 'cover' || s.kind === 'end') {
        return `<section class="page ${s.kind}">
      <div class="mark">ORIGAMI</div>
      <h1>${esc(s.title)}</h1>
      ${s.lines.map((l) => `<p>${esc(l)}</p>`).join('')}
      ${s.links ? `<div class="links">${s.links.map((l) => `<div>${esc(l)}</div>`).join('')}</div>` : ''}
      <div class="num">${i + 1} / ${total}</div>
    </section>`;
    }
    const p = join(imgDir, s.image);
    if (!existsSync(p)) throw new Error('missing image: ' + p);
    /* The page is written into imgDir and opened as a file, so the image is a plain relative
       src. A document built with setContent lives at about:blank and Chromium refuses to load
       file:// from there: the first run produced ten slides with the pictures silently missing. */
    return `<section class="page">
    <div class="head">
      <div class="kicker">${esc(s.kicker)}</div>
      <h2>${esc(s.title)}</h2>
    </div>
    <div class="shot ${s.fit || 'contain'}"><img src="${esc(s.image)}" alt=""></div>
    <div class="num">${i + 1} / ${total}</div>
  </section>`;
}

export function buildHtml(spec, imgDir, only) {
    const list = only == null ? spec.slides : [spec.slides[only]];
    const body = list
        .map((s, k) => slideHtml(s, only == null ? k : only, spec.slides.length, imgDir))
        .join('\n');
    return `<!doctype html><html><head><meta charset="utf-8"><style>${css()}</style></head><body>${body}</body></html>`;
}

/** Write the page beside the images and hand back a file:// url to open. */
export function writePage(spec, imgDir, only, name) {
    const p = join(imgDir, '_' + (name || spec.name) + '.html');
    writeFileSync(p, buildHtml(spec, imgDir, only));
    return pathToFileURL(p).href;
}
