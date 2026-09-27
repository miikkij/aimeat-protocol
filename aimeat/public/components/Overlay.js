/**
 * @file public/components/Overlay.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A page laid over the page: the whole window, its bar across the top (the close
 *   button, the title cut to one line, and what the bar offers at its right end), and under the bar
 *   the body, which alone scrolls. The body is a reading page of its own, or, with `fill`, one thing
 *   that fills it edge to edge (a framed app). With `rail` the body is two columns: the page, and
 *   beside it the contents rail, which stays in view while the page scrolls and goes away when the
 *   window is too narrow for both. A page passes the title, the tools, the rail and the content; it
 *   never writes a class. Its look is css/components/overlay.css.
 *
 *   Named options (added in the parity pass, appcat):
 *   - glyph: the thing's own sign before the title, a step larger (an app's icon).
 *   - onEdit, editLabel: a quiet pencil after the title that opens the thing's editor; leave onEdit
 *     out while the editor is open and the pencil goes.
 *   - back: { label, onClick }: the way back at the top of the body, a mono coral line under a heavy
 *     rule ("← Your apps").
 *   - link: { href, label, mark }: a pill link at the bar's right end that opens in a new tab ("⚡
 *     Publish your own app").
 *   - normalLeading: the layer reads at the browser's own line height rather than the site's 1.6, as
 *     the app catalogue's page did; everything inside inherits it.
 *   - smallWords: the small action links inside (Action small) read a step smaller in the body face,
 *     the app catalogue's quiet word (.dtl-btn, .78rem).
 *   With `fill` the bar is the app viewer's own: a thinner glass bar with a larger close button.
 *
 *   It holds no state of its own and moves no focus: the page decides when it is there (it draws the
 *   Overlay while it is open), and `bodyRef` hands the page the element that scrolls, so the page can
 *   bring a part of itself to the top or know where the reader is.
 * @structure Overlay({ label, title, glyph, onEdit, editLabel, back, link, tools, onClose, closeLabel, fill, rail, bodyRef,
 *   normalLeading, smallWords, children })
 * @usage html`<${Overlay} normalLeading label=${name} glyph=${icon} title=${name} onEdit=${edit} editLabel=${t('x.edit')}
 *          back=${{ label: '← ' + t('x.back'), onClick: close }} onClose=${close} closeLabel=${t('common.close')}
 *          rail=${html`<${Rail} …/>`} bodyRef=${ref}>…<//>`
 *        html`<${Overlay} fill title=${name} onClose=${close} link=${{ href: '/', label: t('x.cta'), mark: '⚡' }}><iframe …></iframe><//>`
 * @version-history
 *   v1.2.0 — 2026-09-27 — `smallWords`: the small action links at the catalogue's .78rem in the body
 *     face (.dtl-btn); additive.
 *   v1.1.0 — 2026-09-27 — Parity with the app catalogue: `glyph`, `onEdit`/`editLabel`, `back`, `link` and
 *     `normalLeading`; the close button is the catalogue's own (a thin framed square, larger in the
 *     viewer) rather than the poster icon button; `fill` draws the viewer's glass bar. Additive: the
 *     bar, title and body are unchanged for a caller that passes none of them, except the close
 *     button's look (appcat is the only caller).
 *   v1.0.0 — 2026-09-27 — Initial: the app catalogue's two full-window layers (its detail view,
 *     #detail-view with .dtl-toolbar, .dtl-body and the .dtl-page grid with the "On this page" rail,
 *     and its app viewer, #iframe-view with .iframe-toolbar and the framed app), for appcat.
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');

/**
 * @param {{ label?: string, title?: any, glyph?: any, onEdit?: () => void, editLabel?: string,
 *   back?: { label: any, onClick: () => void }, link?: { href: string, label: any, mark?: any, title?: string },
 *   tools?: any, onClose: () => void, closeLabel?: string, fill?: boolean, rail?: any, bodyRef?: any,
 *   normalLeading?: boolean, smallWords?: boolean, children?: any }} props
 *   label: the layer's name for a screen reader (the title's words when it is plain text).
 *   tools: what stands at the bar's right end. fill: the body is one thing, edge to edge, that does
 *   not scroll (a frame). rail: the contents rail beside the page. bodyRef: the scrolling body.
 */
export function Overlay({ label, title, glyph, onEdit, editLabel, back, link, tools, onClose, closeLabel, fill, rail, bodyRef, normalLeading, smallWords, children }) {
  const name = label || (typeof title === 'string' ? title : undefined);
  const close = closeLabel || 'Close';
  const backLine = back ? html`<button type="button" class="overlay-back" onClick=${back.onClick}>${back.label}</button>` : null;
  const page = html`${backLine}${children}`;
  return html`
    <div class=${cx('overlay', fill && 'overlay--fill', normalLeading && 'overlay--normal-leading', smallWords && 'overlay--small-words')} role="region" aria-label=${name}>
      <div class="overlay-bar">
        <button type="button" class="overlay-close" title=${close} aria-label=${close} onClick=${onClose}>✕</button>
        <span class="overlay-title">
          ${glyph !== undefined && glyph !== null && glyph !== '' ? html`<span class="overlay-glyph" aria-hidden="true">${glyph}</span>` : null}
          ${title}
          ${onEdit ? html`<button type="button" class="overlay-edit" title=${editLabel} aria-label=${editLabel} onClick=${onEdit}>✏️</button>` : null}
        </span>
        ${link ? html`<a class="overlay-link" href=${link.href} target="_blank" rel="noopener" title=${link.title || undefined}>${link.mark
          ? html`<span class="overlay-link-mark">${link.mark}</span>` : null}<span>${link.label}</span></a>` : null}
        ${tools ? html`<span class="overlay-tools">${tools}</span>` : null}
      </div>
      <div class=${cx('overlay-body', fill && 'overlay-body--fill')} ref=${bodyRef}>
        ${rail
          ? html`<div class="overlay-page"><div class="overlay-main">${page}</div><div class="overlay-side">${rail}</div></div>`
          : page}
      </div>
    </div>`;
}

export default Overlay;
