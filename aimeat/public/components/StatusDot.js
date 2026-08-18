import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);

/**
 * @file StatusDot.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Canonical status-indicator dot — a small colored circle whose
 *   color is driven by a semantic status token (online/healthy → success,
 *   syncing/pending → warn, error/offline → danger, idle/muted → text-muted).
 *   Consolidates the per-view bespoke dots (.live-dot, .peer-dot, .pn-status-dot,
 *   .ext-status-dot, .dv-dot) into one component backed by `.status-dot` in
 *   theme.css. All colors come from theme tokens so the dot flips correctly in
 *   dark mode.
 * @structure StatusDot({ status, title? }) — renders
 *   `<span class="status-dot status-dot--${status}" title=${title}></span>`.
 *   Recognized statuses: online, active, healthy, live (→ success);
 *   warn, syncing, pending (→ warn); error, offline, down (→ danger);
 *   idle, muted (→ text-muted). `live` additionally pulses.
 * @usage
 *   import { StatusDot } from '/components/index.js';
 *   html`<${StatusDot} status="online" title=${t('...')} />`
 * @version-history
 *   v1.0.0 — 2026-06-02 — Component unification (#11): created canonical
 *     status-dot, replacing .live-dot / .peer-dot / .pn-status-dot /
 *     .ext-status-dot / .dv-dot bespoke classes.
 */
export function StatusDot({ status, title }) {
  return html`<span class="status-dot status-dot--${status}" title=${title}></span>`;
}
