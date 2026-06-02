/**
 * @file EmptyState.js
 * @description Canonical empty-state placeholder — a centered muted message with an
 *   optional icon. Replaces the per-view clones (pf-empty / mk-empty / hb-empty /
 *   agd-empty / pkg-empty …) and the bare `<div class="empty">` scattered across the
 *   frontend. Renders the themed `.empty` class so it flips with dark/light mode.
 * @structure EmptyState({ icon?, text, children? })
 * @usage import { EmptyState } from '/components/EmptyState.js';
 *   html`<${EmptyState} text=${t('x.empty')} />`
 *   html`<${EmptyState} icon="🎯" text=${t('x.noMatches')} />`
 * @version-history
 *   v1.0.0 — 2026-06-02 — Component unification (#9): single empty-state primitive
 *     (themed .empty + optional .empty-icon); admin Empty() delegates to it.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);

/**
 * EmptyState — centered muted placeholder.
 * @param {{ icon?: string, text?: any, children?: any }} props
 */
export function EmptyState({ icon, text, children }) {
  return html`<div class="empty">
    ${icon ? html`<span class="empty-icon">${icon}</span>` : ''}
    ${text != null ? text : children}
  </div>`;
}
