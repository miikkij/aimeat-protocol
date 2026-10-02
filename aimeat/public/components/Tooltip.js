/**
 * @file public/components/Tooltip.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A short explanation that appears beside a control while the pointer rests on it or
 *   the keyboard focus is in it. Tooltip wraps the control (one element) and draws the tooltip
 *   itself: a dark block with a small sun heading, the words, and an optional quiet line under them
 *   ("Click for examples."), with a pointer towards the control.
 *
 *   It stands against the window (position: fixed), above the control and below it when the window
 *   has no room above, and inside the window's edges, so no ancestor's overflow can cut it. It
 *   follows WCAG 1.4.13: Escape hides it, the pointer can move onto it, and it stays until the
 *   pointer or the focus leaves; scrolling hides it. The control is described by the words
 *   (aria-describedby) whether the tooltip is shown or not. The look is css/components/tooltip.css,
 *   on the theme's tokens and shape values only, so a theme changes it without CSS of its own.
 * @structure Tooltip({ text, title, more, quiet, children })
 * @usage html`<${Tooltip} title=${t('x.name')} text=${t('x.what')} more=${t('x.more')}>
 *          <button …>?</button><//>`
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial, extracted from HelpTip so any control can carry one (wish
 *     "Ohjenappi ja vihjeteksti asetuksille").
 */
import { h, cloneElement, toChildArray } from 'preact';
import { useState, useRef, useLayoutEffect, useEffect, useId } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);

/** How long the pointer rests before the tooltip shows, and how long it may be away before it hides. */
const SHOW_MS = 150;
const HIDE_MS = 120;
/** The space kept between the tooltip and the control, and between the tooltip and the window's edge. */
const GAP = 10;
const EDGE = 8;

/** Where the tooltip stands: above the control, or below it when the window has no room above. */
function placeTip(anchor, bubble) {
  const b = anchor.getBoundingClientRect();
  const w = bubble.offsetWidth;
  const hgt = bubble.offsetHeight;
  const centre = b.left + b.width / 2;
  const left = Math.min(Math.max(centre - w / 2, EDGE), window.innerWidth - w - EDGE);
  const below = b.top - hgt - GAP < EDGE;
  const top = below ? b.bottom + GAP : b.top - hgt - GAP;
  return { left, top, below, arrow: Math.min(Math.max(centre - left, 12), w - 12) };
}

/**
 * @param {{ text: any, title?: any, more?: any, quiet?: boolean, children: any }} props
 *   `text` the explanation; `title` the small heading over it; `more` a quiet line under it;
 *   `quiet` keeps the tooltip hidden (while what the control opened is in front of it).
 */
export function Tooltip({ text, title, more, quiet, children }) {
  const [shown, setShown] = useState(false);
  const [place, setPlace] = useState(null);
  const anchor = useRef(null);
  const bubble = useRef(null);
  const timer = useRef(0);
  const id = `tt${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const later = (fn, ms) => { clearTimeout(timer.current); timer.current = setTimeout(fn, ms); };
  const show = () => { if (!quiet) later(() => setShown(true), SHOW_MS); };
  const hide = () => later(() => { setShown(false); setPlace(null); }, HIDE_MS);
  const now = () => { clearTimeout(timer.current); setShown(false); setPlace(null); };

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { if (quiet) now(); }, [quiet]);

  // Measure once the tooltip is in the page, before it is painted where it stands.
  useLayoutEffect(() => {
    if (shown && anchor.current && bubble.current) setPlace(placeTip(anchor.current, bubble.current));
  }, [shown]);

  useEffect(() => {
    if (!shown) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') now(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', now, true);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('scroll', now, true); };
  }, [shown]);

  if (!text) return children;
  const [only] = toChildArray(children);
  const control = only && typeof only === 'object' ? cloneElement(only, { 'aria-describedby': id }) : children;
  const style = place
    ? `left:${place.left}px;top:${place.top}px;--tooltip-arrow:${place.arrow}px`
    : 'left:0;top:0;visibility:hidden';
  return html`
    <span class="tooltip-anchor" ref=${anchor}
      onMouseEnter=${show} onMouseLeave=${hide} onFocusIn=${show} onFocusOut=${now}>
      ${control}
      ${shown ? html`
        <span ref=${bubble} id=${id} role="tooltip" style=${style}
          class=${place?.below ? 'tooltip tooltip--below' : 'tooltip'}
          onMouseEnter=${() => clearTimeout(timer.current)} onMouseLeave=${hide}>
          ${title ? html`<span class="tooltip-title">${title}</span>` : null}
          ${text}
          ${more ? html`<span class="tooltip-more">${more}</span>` : null}
        </span>` : html`<span id=${id} class="tooltip-said">${text}</span>`}
    </span>`;
}

export default Tooltip;
