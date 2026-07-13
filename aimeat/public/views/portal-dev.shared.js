/**
 * @file public/views/portal-dev.shared.js
 * @description Shared constants + helpers for the portal-dev view (html binding, NODE_URL,
 *   dt() i18n wrapper, formatBytes, GOAL_LIST, CopyBtn). Extracted from portal-dev.js to
 *   satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from portal-dev.js (max-file-lines)
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
// Thin wrapper over the canonical CopyButton — keeps the dev-portal locale labels
// (dt) + the .dv-copy-btn styling; the copy/feedback logic lives in the component.
export function CopyBtn({ text, locale }) {
  return html`<${CopyButton} text=${text} label=${dt('copy', locale)} copiedLabel=${dt('copied', locale)} className="dv-copy-btn" />`;
}
