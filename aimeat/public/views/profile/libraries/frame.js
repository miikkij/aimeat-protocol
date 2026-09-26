/**
 * @file public/views/profile/libraries/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Libraries page's views share: the words (x), the three shelves a pack
 *   sorts into (the base, ready-made UI, third-party), the status and model words a row shows,
 *   the app name behind an "owner/filename" reference, the text an AI gets when a library is
 *   copied to it, the crumb and the cross-page rail links.
 * @structure x · shelfOf · statusWord · modelWord · proofWord · appName · appUrlOf · aiRule ·
 *   aiTextFor · crumb · pageLinks
 * @usage import { x, shelfOf, statusWord, modelWord } from './frame.js';
 * @version-history
 *   v1.1.0 — 2026-09-26 — The crumb and the rail's sibling pages are data for SettingsPage (component
 *     plan C9); this file writes no markup (page group G8).
 *   v1.0.0 — 2026-09-03 — Initial (design canvas "AIMEAT Kirjastot-sivu", direction A).
 */
import { t } from '/js/i18n.js';

export const x = (key, vars) => t('libspage.' + key, vars);

/** The shelf a pack sits on: 'base' (SDK), 'ui' (cortex, node or community), 'third' (vendored and the styling bundle). */
export function shelfOf(p) {
  if (p.kind === 'sdk') return 'base';
  if (p.kind === 'cortex') return 'ui';
  return 'third';
}

export const statusWord = (p) => x('status.' + (p.status || 'preview'));
/** The model words a row shows; the base and UI shelves say nothing here because the panel explains it once. */
export function modelWord(p) {
  if (p.modelTier === 'any') return x('model.any');
  if (p.modelTier === 'frontier') return x('model.frontier');
  return '';
}
/** One proof as a row word: "✓ claude-haiku-4-5" or "✗ claude-haiku-4-5". */
export function proofWord(p) {
  const proofs = p.proofs || [];
  if (!proofs.length) return '';
  const last = proofs[proofs.length - 1];
  return `${last.verdict === 'pass' ? '✓' : '✗'} ${last.model}`;
}
export const isCommunity = (p) => p.scope === 'community';

export const appName = (ref) => String(ref || '').split('/').pop().replace(/\.html?$/i, '');
export const appUrlOf = (ref) => { const [owner, ...rest] = String(ref || '').split('/'); return rest.length ? `/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(rest.join('/'))}?mode=inline` : null; };

/** The rule an AI gets with the page's slab: where the index is and how a library is loaded. English, since it is for the model. */
export function aiRule(nodeUrl) {
  return [
    `Libraries on this AIMEAT node: before using one, GET ${nodeUrl}/v1/library-packs/<id> and read its ai_doc (current usage) and changelog.`,
    `The full index is GET ${nodeUrl}/v1/library-packs (id, kind, description, include lines, requires, version, status, modelTier, proofs, used_by).`,
    'Load every library from this node with the include lines the pack gives; never from a CDN. A major version is always a new file (chartjs@4.js stays when chartjs@5.js appears), so an app that keeps its include lines keeps working.',
    'A deprecated pack names its replacement in supersededBy. A pack with modelTier "frontier" carries apiCaveat: the one idiom a model gets wrong from memory; read it before writing code.',
  ].join('\n');
}

/** What one library hands an AI: the include lines, the API, the caveat and the usage doc. */
export function aiTextFor(pack, detail) {
  const d = detail || pack;
  const lines = [];
  lines.push(`Library ${pack.id} (${pack.title || pack.id})${pack.version ? ' ' + pack.version : ''}: ${pack.description || ''}`);
  if (Array.isArray(d.include) && d.include.length) lines.push('', 'Include, in this order:', ...d.include);
  if (pack.apiSurface) lines.push('', `API: ${pack.apiSurface}`);
  if (Array.isArray(pack.requires) && pack.requires.length) lines.push(`Requires: ${pack.requires.join(', ')}`);
  if (pack.apiCaveat) lines.push('', `Caveat: ${pack.apiCaveat}`);
  if (d.ai_doc) lines.push('', 'Usage:', d.ai_doc);
  return lines.join('\n');
}

/** The crumb's steps (SettingsPage draws them). */
export function crumb() {
  return [t('nav.profile'), t('profile.landing.menuBuildShare'), t('librariesTab.tabLabel')];
}

/** The sibling pages in the rail, as data (SettingsPage draws them → … →). */
export function pageLinks() {
  return [
    { tab: 'apps', label: t('profile.tabs.apps') },
    { tab: 'extensions', label: t('profile.tabs.extensions') },
    { tab: 'appdev', label: t('profile.tabs.appDev') },
    { href: 'https://design-book.apps.aimeat.io/', newTab: true, label: 'Design Book' },
  ];
}
