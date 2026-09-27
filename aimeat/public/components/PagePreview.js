/**
 * @file public/components/PagePreview.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A web page shown as it will look, inside the raised box: a sandboxed frame (scripts
 *   run, nothing else is allowed) 34rem high, 24rem on a phone; while the page's text loads, the
 *   loading line. A page passes the document and its title; it never writes a class. Its look is
 *   css/components/page-preview.css; the frame around it is the Box (raised, flush).
 *
 *   `email` (added by page group G6, admin): an email as it will reach its reader, where nothing in
 *   it runs (sandbox with no permission at all: the operator's templates are HTML a person wrote):
 *   600px wide, the width an email is designed at, 420px high, on the white ground a mail reader
 *   gives it, centred in the box (main's admin Email page, .adm-em-stage iframe).
 *
 *   `live` (SitePreview folded in, admin group G2): a live page of this site by its address, as a
 *   visitor gets it, beside the thing that arranges it: the title as a row label and three ways
 *   over it (wide, phone, fold it away), the page in a sandboxed frame, a grey note under it and
 *   the link that opens the page on its own. When the page draws its parts as the children of one
 *   element (`marks.root`) and their count matches `marks.count`, each part gets its number in an
 *   ink square, the same number the list beside it uses; a count that does not match draws no
 *   number at all, because a wrong number is worse than none. `empty` shows a line in the frame's
 *   place and nothing else (a page behind a sign-in). The look is main's Portal preview
 *   (.adm-pt-pv*, .adm-pt-frame).
 *   - src: the frame's address; `refresh` changes it so the frame loads the page again.
 *   - href + openLabel: the link that opens the page; wideLabel, phoneLabel, foldLabel, unfoldLabel:
 *     the three ways' words.
 *   - note: the line under the frame; markedNote is added to it while the numbers are drawn.
 *   - marks: { root, count } (the element whose children are the parts, how many parts are shown).
 * @structure PagePreview({ title, srcdoc, loading, loadingLabel, email, live, src, href, openLabel,
 *   wideLabel, phoneLabel, foldLabel, unfoldLabel, note, markedNote, marks, refresh, empty }) ·
 *   LivePage(props) · useBlockMarks
 * @usage html`<${PagePreview} title=${title} srcdoc=${ctx.pageHtml ? ctx.previewDoc() : null} loadingLabel=${x('loading')} />`
 *        html`<${PagePreview} email title=${t('x.preview')} srcdoc=${templateHtml} />`
 *        html`<${PagePreview} live title=${x('title')} src=${'/v1/portal'} href="/v1/portal" refresh=${n}
 *          marks=${{ root: '.ld', count: shown }} note=${x('noteSaved')} markedNote=${x('noteNumbers')} … />`
 * @version-history
 *   v1.2.0 — 2026-09-27 — `live`: SitePreview (the admin Portal page's live preview, admin group G2)
 *     folded in, one component for a web page shown as it looks; its behaviour and look unchanged,
 *     its sheet now page-preview.css. Additive: a srcdoc or an email draws as before.
 *   v1.1.0 — 2026-09-27 — `email`: an email's HTML shown where nothing runs, 600px on white (the admin
 *     Email page's template preview); additive, page group G6.
 *   v1.0.0 — 2026-09-26 — Initial: the Portfolio page's preview (main's .pf-prev, .pf-prev-frame) as a
 *     component (page group G8).
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { swallowed } from '/js/swallowed.js';
import { Box } from '/components/Box.js';
import { Note } from '/components/Note.js';
import { Action } from '/components/Action.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');

/**
 * The numbers on the live page, matched to the numbers in the list. The marks are drawn inside the
 * framed document, which no sheet of this page reaches, so they carry their own look.
 */
function useBlockMarks({ ref, root, count, refresh, folded }) {
  const [marked, setMarked] = useState(0);
  useEffect(() => {
    if (folded || !root || !(count > 0)) { setMarked(0); return undefined; }
    let stopped = false;
    let tries = 0;
    const paint = () => {
      if (stopped) return;
      tries += 1;
      try {
        const doc = ref.current?.contentDocument;
        const top = doc?.querySelector(root);
        if (top) {
          for (const old of top.querySelectorAll('[data-site-preview-mark]')) old.remove();
          const kids = [...top.children].filter(el => el.offsetHeight > 0);
          if (kids.length === count) {
            kids.forEach((el, i) => {
              if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
              const chip = doc.createElement('div');
              chip.setAttribute('data-site-preview-mark', '1');
              chip.textContent = String(i + 1);
              chip.style.cssText = 'position:absolute;top:6px;left:6px;z-index:60;width:22px;height:22px;'
                + 'display:flex;align-items:center;justify-content:center;background:#1A1A2E;color:#FAFAF8;'
                + 'font:500 12px/1 ui-monospace,monospace;pointer-events:none';
              el.appendChild(chip);
            });
            setMarked(kids.length);
            return;
          }
          setMarked(0);
        }
      } catch (err) {
        // The document is not there yet, or is not ours to read. Neither is worth a word.
        swallowed('site preview: marks', err);
        setMarked(0);
      }
      if (tries < 12) window.setTimeout(paint, 500);
    };
    paint();
    return () => { stopped = true; };
  }, [ref, root, count, refresh, folded]);
  return marked;
}

/** The live page (`live`): its tools, the frame, the note and the way to open it. */
function LivePage({ title, src, href, openLabel, wideLabel, phoneLabel, foldLabel, unfoldLabel, note, markedNote, marks, refresh, empty }) {
  const [phone, setPhone] = useState(false);
  const [folded, setFolded] = useState(false);
  const frame = useRef(null);
  const marked = useBlockMarks({ ref: frame, root: marks?.root, count: marks?.count, refresh, folded: folded || !!empty });

  if (empty) {
    return html`
      <div class="page-preview-live">
        <div class="page-preview-live-head"><span class="poster-label">${title}</span></div>
        <p class="page-preview-live-empty">${empty}</p>
      </div>`;
  }

  const address = refresh !== undefined && refresh !== null ? `${src}${src.includes('?') ? '&' : '?'}_preview=${refresh}` : src;
  return html`
    <div>
      <div class="page-preview-live">
        <div class="page-preview-live-head">
          <span class="poster-label">${title}</span>
          <span class="page-preview-live-tools">
            <${Action} small soft onClick=${() => setPhone(false)} pressed=${!phone}>${wideLabel}<//>
            <${Action} small soft onClick=${() => setPhone(true)} pressed=${phone}>${phoneLabel}<//>
            <${Action} small soft onClick=${() => setFolded(f => !f)}>${folded ? unfoldLabel : foldLabel}<//>
          </span>
        </div>
        ${folded ? null : html`
          <iframe ref=${frame} class=${cx('page-preview-live-frame', phone && 'page-preview-live-frame--phone')}
            title=${title} src=${address} sandbox="allow-same-origin allow-scripts"></iframe>`}
      </div>
      ${note ? html`<p class="page-preview-live-note">${note}${marked > 0 && markedNote ? ' ' + markedNote : ''}</p>` : null}
      ${href ? html`<div class="page-preview-live-open"><${Action} small soft href=${href} newTab>${openLabel} →<//></div>` : null}
    </div>`;
}

/** Without `srcdoc` (or with `loading`) it says the page is loading. */
export function PagePreview({ title, srcdoc, loading, loadingLabel, email, live, ...rest }) {
  // live (SitePreview folded in, admin group G2): a page of this site by its address.
  if (live) return html`<${LivePage} title=${title} ...${rest} />`;
  // email (added by page group G6): nothing in the email runs (sandbox=""), even while it is empty.
  if (email) {
    return html`<${Box} flush><div class="page-preview-mail"><iframe class="page-preview-frame page-preview-frame--mail" title=${title} sandbox="" srcdoc=${srcdoc || ''}></iframe></div><//>`;
  }
  return html`<${Box} tone="raised" flush>
    ${srcdoc && !loading
      ? html`<iframe class="page-preview-frame" title=${title} sandbox="allow-scripts" srcdoc=${srcdoc}></iframe>`
      : html`<${Note} kind="loading">${loadingLabel}<//>`}
  <//>`;
}

export default PagePreview;
