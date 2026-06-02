import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);

/**
 * @file KeyValueRow.js
 * @description Canonical key/value detail row — a label/value pair laid out as
 *   flex space-between with a muted label and an emphasized value, separated by
 *   a subtle bottom border. Backed by `.kv-row` / `.kv-label` / `.kv-value` in
 *   theme.css; all colors come from theme tokens so it flips correctly in dark
 *   mode. Consolidates the common label+value-pair shape (the admin .adm-erow /
 *   .adm-hrow and the profile .pf-agd-info-row families). The existing per-view
 *   classes are intentionally left in place where their look differs (admin rows
 *   are mono/bordered, the profile agent-detail rows are borderless) — use this
 *   for NEW detail lists rather than reinventing the markup.
 * @structure KeyValueRow({ label, value, badge?, mono? }) — renders
 *   `<div class="kv-row"><span class="kv-label">${label}</span>
 *    <span class="kv-value[ mono]">${value | badge}</span></div>`.
 *   - `mono` — render the value in the monospace font (for ids, hashes, amounts).
 *   - `badge` — a semantic badge tone (success|warn|danger|info); when set, the
 *     value is wrapped in a `.badge badge-${badge}` chip instead of plain text.
 * @usage
 *   import { KeyValueRow } from '/components/index.js';
 *   html`<${KeyValueRow} label=${t('field.id')} value=${id} mono />`
 *   html`<${KeyValueRow} label=${t('field.status')} value=${status} badge="success" />`
 * @version-history
 *   v1.0.0 — 2026-06-02 — Component unification (#21): created canonical
 *     key/value detail row backed by .kv-row in theme.css.
 */
export function KeyValueRow({ label, value, badge, mono }) {
  return html`<div class="kv-row">
    <span class="kv-label">${label}</span>
    <span class="kv-value${mono ? ' mono' : ''}">${
      badge ? html`<span class="badge badge-${badge}">${value}</span>` : value
    }</span>
  </div>`;
}
