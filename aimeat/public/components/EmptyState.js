/**
 * @file EmptyState.js
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
 * @usage import { EmptyState } from '/components/EmptyState.js';
 *   html`<${EmptyState} text=${t('x.empty')} />`
 *   html`<${EmptyState} icon="🎯" text=${t('x.noMatches')} />`
 *   html`<${EmptyState} icon="🔑" title=${t('x.gateTitle')} text=${t('x.gateDesc')}
 *          action=${html`<button class="btn-primary btn-sm" onClick=${login}>…</button>`} />`
 * @version-history
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
 * @param {{ icon?: string, title?: any, text?: any, action?: any, children?: any }} props
 */
export function EmptyState({ icon, title, text, action, children }) {
  return html`<div class="empty">
    ${icon ? html`<span class="empty-icon">${icon}</span>` : ''}
    ${title != null ? html`<div class="empty-title">${title}</div>` : ''}
    ${text != null ? html`<div class="empty-text">${text}</div>` : ''}
    ${children != null ? children : ''}
    ${action != null ? html`<div class="empty-action">${action}</div>` : ''}
  </div>`;
}
