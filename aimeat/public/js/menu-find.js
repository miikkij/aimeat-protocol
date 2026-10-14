/**
 * @file public/js/menu-find.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the menu find shows for the words typed (components/MenuFind.js): the places of
 *   a menu whose name, other words or group match, the sections inside a page whose name matches,
 *   and the places of the other side (admin from Settings & Controls, and the other way round). The
 *   menu's order is kept, because a person knows the menu; the place the words fit best is the one
 *   chosen first. A letter matches its plain form too ("nakyma" finds "näkymä"), and the part that
 *   matched is returned so the row can underline it. Pure: no DOM, no fetch, no translation; the
 *   page gives every word already in the person's language.
 * @structure foldText(s) · cutLabel(label, query) · findInMenu(groups, query, { other, otherTitle })
 * @usage const found = findInMenu(groups, 'agent', { other, otherTitle: 'On the operator side' });
 *        found.groups[0].rows[0].cut → { before: '', hit: 'Agent', after: 's' }
 * @version-history
 *   v1.0.0 — 2026-10-14 — Initial (wish-pikahaku-settings-controls-ja-admin-sivuille).
 */

/** One character in the form a match compares: lower case, without its accent when it has one. */
function foldChar(ch) {
  const plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return plain.length === 1 ? plain : ch.toLowerCase().slice(0, 1) || ch;
}

/**
 * A text in the form a match compares, one character for one, so a position found in the folded
 * text is the same position in the text as written.
 * @param {string} s
 */
export function foldText(s) {
  let out = '';
  for (const ch of String(s ?? '')) out += foldChar(ch);
  return out;
}

/**
 * Where the words appear in a label: the label in three parts, or null when they do not appear.
 * @param {string} label
 * @param {string} query the words, already folded and trimmed
 * @returns {{ before: string, hit: string, after: string, at: number } | null}
 */
export function cutLabel(label, query) {
  if (!query) return null;
  const chars = [...String(label ?? '')];
  const at = foldText(label).indexOf(query);
  if (at < 0) return null;
  const len = [...query].length;
  return { before: chars.slice(0, at).join(''), hit: chars.slice(at, at + len).join(''), after: chars.slice(at + len).join(''), at };
}

/** The first of a place's other words that holds the typed words, or ''. */
function wordHit(words, query) {
  for (const w of words || []) if (foldText(w).includes(query)) return w;
  return '';
}

/**
 * How well a place's own name fits: the words at the start of a word fit better than inside one,
 * and a short name they fill most of fits best ("Agents" before "Agent status" for "agent").
 */
function nameScore(label, cut, queryLen) {
  const start = cut.at === 0 || /[\s&(/-]/.test([...label][cut.at - 1] || '');
  return (start ? 3 : 2) + queryLen / Math.max(1, [...label].length);
}

/**
 * @typedef {{ id: string, num?: string, label: string, words?: string[], tail?: string, data?: any }} FindSection
 * @typedef {{ id: string, label: string, words?: string[], hidden?: boolean, tail?: string, sections?: FindSection[], data?: any }} FindPlace
 * @typedef {{ key: string, title: string, items: FindPlace[] }} FindGroup
 * @typedef {{ key: string, kind: 'place'|'section'|'more', place: FindPlace, section: FindSection|null, group: FindGroup,
 *   other: boolean, label: string, cut: ReturnType<typeof cutLabel>, via: string, num: string, tail: string, score: number,
 *   index: number, more: number }} FindRow
 */

/**
 * The rows the menu shows for the typed words.
 * @param {FindGroup[]} groups the menu's own groups, in its order
 * @param {string} words what the person typed
 * @param {{ other?: FindGroup[], otherTitle?: string, maxSections?: number }} [opts] the other side's
 *   places, shown last under one title (their sections are not searched); and how many sections of
 *   one place are shown (8): past it, one row of kind 'more' says how many more there are
 * @returns {{ query: string, groups: Array<{ key: string, title: string, other: boolean, rows: FindRow[] }>,
 *   rows: FindRow[], best: number, places: number, sections: number, hidden: number }}
 */
export function findInMenu(groups, words, opts = {}) {
  const query = foldText(words).trim().replace(/\s+/g, ' ');
  const out = { query, groups: [], rows: [], best: -1, places: 0, sections: 0, hidden: 0 };
  if (!query) return out;
  const qLen = [...query].length;
  const maxSections = opts.maxSections ?? 8;

  const collect = (group, other) => {
    const groupFits = !other && foldText(group.title).includes(query);
    /** @type {FindRow[]} */
    const rows = [];
    for (const place of group.items || []) {
      const cut = cutLabel(place.label, query);
      const via = cut ? '' : wordHit(place.words, query);
      const sections = other ? [] : (place.sections || []).filter((s) => cutLabel(s.label, query) || wordHit(s.words, query));
      if (!cut && !via && !groupFits && !sections.length) continue;
      const score = cut ? nameScore(place.label, cut, qLen) : via ? 1.5 : sections.length ? 1 : 0.5;
      out.places++;
      if (place.hidden) out.hidden++;
      rows.push({ key: `${group.key}:${place.id}`, kind: 'place', place, section: null, group, other, label: place.label,
        cut, via, num: '', tail: place.tail || '', score, index: -1, more: 0 });
      for (const section of sections.slice(0, maxSections)) {
        const sCut = cutLabel(section.label, query);
        out.sections++;
        rows.push({ key: `${group.key}:${place.id}#${section.id}`, kind: 'section', place, section, group, other, label: section.label,
          cut: sCut, via: sCut ? '' : wordHit(section.words, query), num: section.num || '', tail: section.tail || '',
          score: sCut ? 1.4 : 1.1, index: -1, more: 0 });
      }
      if (sections.length > maxSections) {
        const more = sections.length - maxSections;
        out.sections += more;
        rows.push({ key: `${group.key}:${place.id}#more`, kind: 'more', place, section: null, group, other, label: '',
          cut: null, via: '', num: '', tail: '', score: 0, index: -1, more });
      }
    }
    return rows;
  };

  for (const group of groups || []) {
    const rows = collect(group, false);
    if (rows.length) out.groups.push({ key: group.key, title: group.title, other: false, rows });
  }
  const otherRows = (opts.other || []).flatMap((g) => collect(g, true));
  if (otherRows.length) out.groups.push({ key: 'other', title: opts.otherTitle || '', other: true, rows: otherRows });

  for (const g of out.groups) for (const r of g.rows) { r.index = out.rows.length; out.rows.push(r); }
  out.rows.forEach((r, i) => { if (out.best < 0 || r.score > out.rows[out.best].score) out.best = i; });
  return out;
}
