/**
 * @file public/js/services/places.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The index of places for the menu find: public/data/places.json (the pages of Settings
 *   & Controls and of the admin side, and the sections inside a page), read once per page load, and
 *   the words a menu find matches a place by. The same file answers an AI through
 *   aimeat_handbook_get { tier: "places" } (src/services/places.ts).
 * @structure loadPlaces() · placeWords(side, id, labelKey) · sectionsOf(index, side, id) ·
 *   indexGroups(index, side, { operator }) · scrollToSectionSoon(id)
 * @usage const index = await loadPlaces();
 *        const groups = indexGroups(index, 'admin');
 * @version-history
 *   v1.0.0 — 2026-10-14 — Initial (wish-pikahaku-settings-controls-ja-admin-sivuille).
 */
import { t, tEn } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';
import { scrollToSection } from '/components/Rail.js';

/** @type {Promise<any>|null} */
let loading = null;

/** The index, fetched once; null when it could not be read (the menu find then searches names only). */
export function loadPlaces() {
  loading ??= fetch('/data/places.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .catch((err) => { swallowed('places: loadPlaces', err); loading = null; return null; });
  return loading;
}

/** A locale string as a list of words: "bot, assistant" → ['bot', 'assistant']; a missing key → []. */
function wordList(key, text) {
  if (!text || text === key) return [];
  return text.split(',').map((w) => w.trim()).filter(Boolean);
}

/**
 * The other words a place is found by: its words in the person's language and in English, and its
 * English name, so a person who knows the English word finds it in any language.
 * @param {'settings'|'admin'} side
 * @param {string} id
 * @param {string} [labelKey]
 */
export function placeWords(side, id, labelKey) {
  const key = `places.kw.${side}.${id}`;
  const own = wordList(key, t(key));
  const en = wordList(key, tEn(key));
  const name = labelKey ? tEn(labelKey) : '';
  return [...new Set([...own, ...en, ...(name && name !== labelKey ? [name] : [])])];
}

/**
 * A page's sections from the index, in the person's language, each also found by its English name.
 * @returns {Array<{ id: string, num: string, label: string, words: string[] }>}
 */
export function sectionsOf(index, side, id) {
  const items = (index?.[side]?.groups || []).flatMap((g) => g.items || []);
  const place = items.find((it) => it.id === id);
  return (place?.sections || []).map((s) => {
    const en = tEn(s.labelKey);
    return { id: s.id, num: s.num || '', label: t(s.labelKey), words: en && en !== s.labelKey ? [en] : [] };
  });
}

/**
 * A side's whole menu from the index, for the other side's menu find: its groups with every place
 * (the operator-only group only for an operator).
 * @param {any} index
 * @param {'settings'|'admin'} side
 * @param {{ operator?: boolean }} [opts]
 */
export function indexGroups(index, side, opts = {}) {
  const operator = opts.operator ?? true;
  const top = (index?.[side]?.top || []).length ? [{ titleKey: '', items: index[side].top }] : [];
  return [...top, ...(index?.[side]?.groups || [])]
    .filter((g) => !g.operator || operator)
    .map((g) => ({
      key: `${side}:${g.titleKey}`,
      title: g.titleKey ? t(g.titleKey) : '',
      items: (g.items || []).map((it) => ({ id: it.id, label: t(it.labelKey), words: placeWords(side, it.id, it.labelKey), data: { side, id: it.id } })),
    }));
}

/**
 * Bring a section into view once the page that holds it has drawn it: a page loads its data first,
 * so the section appears a moment after the page opens, and the parts above it may still grow and
 * push it down. So the scroll is repeated while the section's place keeps moving, for a second and
 * a half at most. Gives up after four seconds when the section never appears, leaving the page at
 * its top.
 * @param {string} id
 */
export function scrollToSectionSoon(id) {
  if (!id) return;
  let tries = 0;
  let lastTop = null;
  let settles = 0;
  const offset = () => {
    const el = document.getElementById(id);
    return el ? el.getBoundingClientRect().top : null;
  };
  const settle = () => {
    const top = offset();
    if (top === null || settles++ > 15) return;
    if (lastTop === null || Math.abs(top - lastTop) > 2) scrollToSection(id);
    lastTop = offset();
    setTimeout(settle, 100);
  };
  const look = () => {
    if (document.getElementById(id)) { settle(); return; }
    if (++tries < 40) setTimeout(look, 100);
  };
  setTimeout(look, 30);
}
