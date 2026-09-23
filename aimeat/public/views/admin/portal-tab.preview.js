/**
 * @file public/views/admin/portal-tab.preview.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a visitor sees, beside the list of parts (design canvas "AIMEAT Admin Portal",
 *   section 02). Two widths, a way to fold it out of sight, and a line that says exactly which
 *   version is in the frame.
 *
 *   WHICH PAGE THIS SHOWS got it wrong for months and the reason is worth keeping: the site's root
 *   forwards a signed-in person to their own home, so an operator standing here saw their home and
 *   had no way to tell it was not the page they were editing. /v1/portal is the front page itself
 *   and forwards nobody. A custom HTML page has no such forward: it IS what the root hands every
 *   visitor, so once one is saved the frame goes back to the root.
 *
 *   IT SHOWS THE SAVED PAGE, AND SAYS SO. The node renders the front page from what is stored, so
 *   an arrangement you have not saved cannot be in the frame. Rather than let the operator believe
 *   otherwise, the line under it counts the changes that are not in it yet.
 * @structure PagePreview
 * @usage html`<${PagePreview} surface="portal" hasCustom=${false} nonce=${n} unsaved=${3} />`
 * @version-history
 *   v1.1.0 -- 2026-09-22 -- Composed from the shared component set: the frame sits on the shared
 *     stage (a light ground in every theme, sized by the stage, at a phone's width while the
 *     Phone tab is on) under tab actions for the two widths; no inline style and no sheet of its own.
 *   v1.0.0 — 2026-09-12 — Initial.
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';
import { Stack, Text, Action, Surface } from '/components/poster-parts.js';

const html = htm.bind(h);
const P = (key, params) => t('admin.portal.' + key, params);

/**
 * The numbers on the page, matched to the numbers in the list.
 *
 * The renderer emits exactly one root element per shown part, in order, inside `.ld`, so the
 * children of that element ARE the parts. That is an assumption about someone else's markup, so it
 * is checked rather than trusted: unless the count matches the number of parts the list shows, no
 * number is drawn at all. A wrong number beside a part would be worse than none.
 */
function useBlockMarks({ ref, shown, nonce, folded }) {
  const [marked, setMarked] = useState(0);
  useEffect(() => {
    if (folded || shown <= 0) { setMarked(0); return undefined; }
    let stopped = false;
    let tries = 0;
    const paint = () => {
      if (stopped) return;
      tries += 1;
      try {
        const doc = ref.current?.contentDocument;
        const root = doc?.querySelector('.ld');
        if (root) {
          for (const old of root.querySelectorAll('[data-adm-pt-mark]')) old.remove();
          const kids = [...root.children].filter(el => el.offsetHeight > 0);
          if (kids.length === shown) {
            kids.forEach((el, i) => {
              if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
              const chip = doc.createElement('div');
              chip.setAttribute('data-adm-pt-mark', '1');
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
        swallowed('portal preview: marks', err);
        setMarked(0);
      }
      if (tries < 12) window.setTimeout(paint, 500);
    };
    paint();
    return () => { stopped = true; };
  }, [ref, shown, nonce, folded]);
  return marked;
}

export function PagePreview({ surface, hasCustom, nonce, unsaved, shown }) {
  const [phone, setPhone] = useState(false);
  const [folded, setFolded] = useState(false);
  const frame = useRef(null);
  const marked = useBlockMarks({ ref: frame, shown, nonce, folded });

  // A member's page is behind a sign-in, so there is nothing honest to put in a frame here.
  if (surface !== 'portal') {
    return html`
      <${Surface} kind="box">
        <${Stack} density="compact">
          <${Text} kind="label">${P('preview.title')}<//>
          <${Text} kind="caption" tone="muted">${P('preview.memberOnly')}<//>
        <//>
      <//>`;
  }

  const path = hasCustom ? '/' : '/v1/portal';
  // The shared stage frames the page on a light ground in every theme and sizes the frame.
  return html`
    <${Stack} density="compact">
      <${Stack} direction="wrap" align="between">
        <${Text} kind="label">${P('preview.title')}<//>
        <${Stack} direction="wrap" align="center" density="compact">
          <${Action} kind="tab" selected=${!phone} onClick=${() => setPhone(false)}>${P('preview.wide')}<//>
          <${Action} kind="tab" selected=${phone} onClick=${() => setPhone(true)}>${P('preview.phone')}<//>
          <${Action} onClick=${() => setFolded(f => !f)} expanded=${!folded}>
            ${folded ? P('preview.unfold') : P('preview.fold')}
          <//>
        <//>
      <//>
      ${!folded && html`
        <${Surface} kind="stage" width=${phone ? 'phone' : undefined}>
          <iframe ref=${frame} title=${P('preview.title')}
            src=${`${path}?_preview=${nonce}`}
            sandbox="allow-same-origin allow-scripts"></iframe>
        <//>`}
      <${Text} kind="caption" tone="muted">
        ${unsaved > 0 ? P('preview.noteUnsaved', { n: unsaved }) : P('preview.noteSaved')}
        ${marked > 0 ? ' ' + P('preview.noteNumbers') : ''}
      <//>
      <${Stack} direction="wrap" align="center">
        <${Action} href=${path} target="_blank">${P('preview.open')} →<//>
      <//>
    <//>`;
}

export default PagePreview;
