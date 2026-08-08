/**
 * @file public/views/portal-dev.shared.js
 * @description Shared constants + helpers for the portal-dev view (html binding, NODE_URL,
 *   dt() i18n wrapper, formatBytes, GOAL_LIST, CopyBtn). Extracted from portal-dev.js to
 *   satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from portal-dev.js (max-file-lines)
 *   v1.1.0 — 2026-08-08 — CopyBtn is now a pure label-free wrapper over <CopyButton>: shared btn-primary btn-sm
 *       btn-copy-inline styling and the default common.copy / common.copied labels, replacing the
 *       .dv-copy-btn class and the dev.copy / dev.copied keys. The unused `locale` prop is gone.
 */
import { h } from 'preact';
import htm from 'htm';
import { t as globalT } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';

export const html = htm.bind(h);
export const NODE_URL = window.location.origin;

/* ══════════════════════════════════════════════
   i18n — use SPA i18n.js t() with 'dev.' prefix
   ══════════════════════════════════════════════ */
// `locale` is accepted for call-site symmetry but currently unused — t() resolves against
// the active global locale, not a per-call override.
export function dt(key, _locale) {
  return globalT('dev.' + key);
}

/* ══════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════ */
export function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / (1024 * 1024)).toFixed(1) + ' MB';
}

/* ══════════════════════════════════════════════
   GOALS
   ══════════════════════════════════════════════ */
export const GOAL_LIST = [
  { id: 'dashboard', icon: '\ud83d\udccb' },
  { id: 'notes',     icon: '\ud83d\udcdd' },
  { id: 'game',      icon: '\ud83c\udfae' },
  { id: 'news',      icon: '\ud83d\udcf0' },
  { id: 'marketplace', icon: '\ud83d\uded2' },
  { id: 'chat',      icon: '\ud83d\udcac' },
  { id: 'iot',       icon: '\ud83d\udcca' },
  { id: 'custom',    icon: '\ud83d\udd27' },
];

/* ══════════════════════════════════════════════
   COPY BUTTON
   ══════════════════════════════════════════════ */
// Thin wrapper over the canonical CopyButton. It used to carry the dev-portal's own copy labels
// and its own .dv-copy-btn styling; both are now the shared ones — btn-primary, and the default
// common.copy / common.copied. btn-copy-inline keeps it from stretching the .dv-code-row it
// sometimes sits in; inside a .dv-prompt-output the container positions it in the corner.
export function CopyBtn({ text }) {
  return html`<${CopyButton} text=${text} className="btn-primary btn-sm btn-copy-inline" />`;
}
