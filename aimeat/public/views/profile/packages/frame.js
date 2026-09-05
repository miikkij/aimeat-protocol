/**
 * @file public/views/profile/packages/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Packages page's views share: the words (x), the join of template listings
 *   and public packages into one offer per group, the words for a component type, a category and
 *   a listing status, the text an agent gets, the crumb and the cross-page rail links.
 * @structure x · joinOffers · partWord · categoryWord · listingWord · dateWord · agentRule ·
 *   agentTextFor · crumb · pageLinks · openTab
 * @usage import { x, joinOffers } from './frame.js';
 * @version-history
 *   v1.1.0 — 2026-09-05 — An offer carries its `manifest`, which is where a composed package records
 *     what the installing side must already have.
 *   v1.0.0 — 2026-09-03 — Initial (design canvas "AIMEAT Paketit-sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';

export const x = (key, vars) => t('pkpage.' + key, vars);

const PART_KEYS = { app: 'part.app', extension: 'part.extension', cortex: 'part.cortex', memory: 'part.memory', translation: 'part.translation', csm: 'part.csm', msm: 'part.msm' };
export const partWord = (type) => x(PART_KEYS[type] || 'part.other');
/** The tab a component's own page lives on. */
export const partTab = (type) => (type === 'app' ? 'apps' : type === 'extension' || type === 'cortex' ? 'extensions' : 'memory');
const CATEGORIES = ['knowledge', 'commerce', 'marketplace', 'security', 'iot', 'community', 'signage', 'social', 'productivity', 'communication', 'other'];
export const categoryWord = (c) => (CATEGORIES.includes(c) ? x('cat.' + c) : (c || ''));
export const listingWord = (s) => (s ? x('listing.' + s) : '');
export const isSystem = (author) => author === 'system' || author === 'operator';

/** Counts of the parts a package or instance carries, as [word, n] pairs in a stable order. */
export function partCounts(list) {
  const counts = new Map();
  for (const c of list || []) counts.set(c.type, (counts.get(c.type) || 0) + 1);
  return [...counts.entries()].sort((a, b) => Object.keys(PART_KEYS).indexOf(a[0]) - Object.keys(PART_KEYS).indexOf(b[0]));
}

/**
 * One row per package group on offer: the public packages carry the parts, version and author; a
 * template listing for the same group adds its title, its longer description and the gallery's
 * counts. A listing whose package is not in the public list (unlisted, private) still shows, since
 * the gallery is what it was listed in; a remote listing from another node joins with its source.
 */
export function joinOffers(available, templates, remote) {
  const byGroup = new Map();
  for (const p of available || []) {
    // `manifest` rides along because a composed package records in it what the installing node has
    // to supply itself; the offer row reads it to say so before anybody presses install.
    byGroup.set(p.packageGroupId, { group: p.packageGroupId, name: p.name, title: p.name, author: p.author, version: p.version, description: p.description || '', category: p.category, tags: p.tags || [], components: p.components || [], manifest: p.manifest || '', updatedAt: p.updatedAt || p.createdAt, pkg: p, listing: null, remote: false, system: isSystem(p.author) });
  }
  for (const l of templates || []) {
    const row = byGroup.get(l.packageGroupId);
    if (row) {
      row.title = l.title || row.title;
      if ((l.description || '').length > row.description.length) row.description = l.description;
      row.category = row.category || l.category;
      row.listing = l;
    } else {
      byGroup.set(l.packageGroupId, { group: l.packageGroupId, name: l.packageName, title: l.title || l.packageName, author: l.packageAuthor, version: '', description: l.description || '', category: l.category, tags: l.tags || [], components: [], updatedAt: l.updatedAt || l.createdAt, pkg: null, listing: l, remote: false, system: isSystem(l.packageAuthor) });
    }
  }
  for (const r of remote || []) {
    const key = r.packageGroupId || `remote:${r.sourceNode || ''}:${r.title || r.name}`;
    if (byGroup.has(key)) continue;
    byGroup.set(key, { group: r.packageGroupId || '', name: r.name || r.title, title: r.title || r.name, author: r.author || '', version: '', description: r.description || '', category: r.category, tags: [], components: [], updatedAt: r.updatedAt || '', pkg: null, listing: null, remote: true, sourceNode: r.sourceNode || '', installCount: r.installCount, system: false });
  }
  return [...byGroup.values()].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

export function dateWord(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(getLocale() === 'fi' ? 'fi-FI' : getLocale() === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'numeric', year: 'numeric' });
}
/** A package version is `v2026-06-12-0136`; the day is what a person reads. */
export function versionDate(v) {
  const m = String(v || '').match(/^v(\d{4})-(\d{2})-(\d{2})/);
  return m ? dateWord(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`) : String(v || '');
}

/** The rule an agent gets with the page's slab. English, since it is for the model. */
export function agentRule(nodeUrl) {
  return [
    'Packages on this AIMEAT node are installable wholes (an app, its server extension and browser library, memory defaults, translations), not single apps. When the owner asks to set up something that is on offer as a package (a company brain, a shop, a marketplace), list the packages, read the one they mean, and install it under the name they give. Ask for the name before installing. Installing registers every part under the owner\'s identity as their own copy.',
    'aimeat_package_list → aimeat_package_get { group_id } → aimeat_package_install { group_id, label }. An app is not a package: apps are aimeat_app_list.',
    `Without MCP: GET ${nodeUrl}/v1/packages and POST ${nodeUrl}/v1/packages/<group_id>/install { label }.`,
  ].join('\n');
}

/** What one offer hands an agent. */
export function agentTextFor(o) {
  return [
    `${o.title} (${o.group || 'remote'}): ${o.description}`,
    `parts: ${(o.components || []).map((c) => `${c.type} ${c.label || c.id}`).join(', ') || 'unknown'}`,
    o.group ? `install: aimeat_package_install { group_id: "${o.group}", label: "<name for the copy>" }` : `from another node: ${o.sourceNode}`,
  ].join('\n');
}

export function crumb() {
  return html`<div class="og-crumb"><span>${t('nav.profile')}</span><span>/</span><span>${t('profile.landing.menuBuildShare')}</span><span>/</span><span class="og-crumb-here">${t('profile.tabs.packages')}</span></div>`;
}

export const openTab = (tabId) => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));
export function pageLinks() {
  return html`
    <button type="button" class="og-rail-link" onClick=${() => openTab('apps')}><i>→</i>${t('profile.tabs.apps')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('extensions')}><i>→</i>${t('profile.tabs.extensions')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('memory')}><i>→</i>${t('profile.tabs.memory')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('skills')}><i>→</i>${t('skills.tabLabel')}<em>→</em></button>`;
}
