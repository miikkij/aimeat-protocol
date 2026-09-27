/**
 * @file EmptyState.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Canonical empty-state placeholder — a centered muted message with an
 *   optional icon, bold title, and action row. Replaces the per-view clones
 *   (pf-empty / mk-empty / hb-empty / agd-empty / pkg-empty …) and the bare
 *   `<div class="empty">` scattered across the frontend. Renders the themed
 *   `.empty` class so it flips with dark/light mode.
 * @structure EmptyState({ icon?, title?, text?, action?, children? })
 *   - icon   — large decorative glyph above the message (.empty-icon)
 *   - title  — bold non-italic heading line (.empty-title)
 *   - text   — the muted body line (inherits the italic .empty look)
 *   - action — a node (button/link) rendered below (.empty-action)
 *   - children — arbitrary body, rendered as-is (back-compat; use instead of text)
 *   - start  — (added for appcat) the empty state of a poster list, at the list's start: left
 *              aligned, the icon large and faint, the title in the poster face (the old app
 *              catalogue's .empty-state in its lists)
 *   - loading — (added for appcat) the list is still being fetched: a ring in the icon's place,
 *              still for a person who asks for reduced motion (the old .cat-spinner), said as a status
 *   - ruled  — (added for appcat) a heavy rule over it (the old catalogue's .view-empty)
 *   - line   — (added for appcat parity) the empty state that stands in for a list under its
 *              headline: its words in ink and semibold, no icon, the ring centred while it waits
 *              (the old catalogue's .view-empty)
 *   - hint   — (added for appcat parity) the grey line under the words (.view-empty-hint)
 *   - aside  — (added for appcat parity) a small faint line under the words (the old list's
 *              "Supports: HTML files and ZIP packages", .empty-formats)
 * @usage import { EmptyState } from '/components/EmptyState.js';
 *   html`<${EmptyState} text=${t('x.empty')} />`
 *   html`<${EmptyState} icon="🎯" text=${t('x.noMatches')} />`
 *   html`<${EmptyState} icon="🔑" title=${t('x.gateTitle')} text=${t('x.gateDesc')}
 *          action=${html`<button class="btn-primary btn-sm" onClick=${login}>…</button>`} />`
 * @version-history
 *   v1.3.0 — 2026-09-27 — `line`, `hint` and `aside` (appcat parity): the old catalogue's
 *     .view-empty block and its hint, and the list's faint formats line; additive.
 *   v1.2.0 — 2026-09-27 — `start`, `loading` and `ruled`: the old app catalogue's empty, loading and
 *     view-empty blocks (appcat); additive, empty-state.css .empty--start, .empty-ring, .empty--ruled.
 *   v1.1.0 — 2026-07-17 — Add title + action slots so the richer bespoke empties
 *     (pkv title+desc, pwv icon+action gates, mk/hb icon+text triads) can fold in
 *     instead of the single-line placeholder being a downgrade. Back-compat: the
 *     text/children-only signature renders identically to v1.0.0.
 *   v1.0.0 — 2026-06-02 — Component unification (#9): single empty-state primitive
 *     (themed .empty + optional .empty-icon); admin Empty() delegates to it.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);

/**
 * EmptyState — centered muted placeholder.
 * @param {{ icon?: string, title?: any, text?: any, action?: any, children?: any, start?: boolean, loading?: boolean, ruled?: boolean,
 *   line?: boolean, hint?: any, aside?: any }} props
 */
export function EmptyState({ icon, title, text, action, children, start, loading, ruled, line, hint, aside }) {
  const cls = 'empty' + (start ? ' empty--start' : '') + (line ? ' empty--line' : '') + (ruled ? ' empty--ruled' : '');
  return html`<div class=${cls}>
    ${loading ? html`<span class="empty-ring" role="status" aria-live="polite"></span>` : ''}
    ${icon && !loading ? html`<span class="empty-icon">${icon}</span>` : ''}
    ${title != null ? html`<div class="empty-title">${title}</div>` : ''}
    ${text != null ? html`<div class="empty-text">${text}</div>` : ''}
    ${aside != null ? html`<div class="empty-aside">${aside}</div>` : ''}
    ${hint != null ? html`<div class="empty-hint">${hint}</div>` : ''}
    ${children != null ? children : ''}
    ${action != null ? html`<div class="empty-action">${action}</div>` : ''}
  </div>`;
}
