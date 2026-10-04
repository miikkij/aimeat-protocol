/**
 * @file public/components/Rail.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The contents rail beside a Settings page (component plan C9, page parts): the dark
 *   column with the page's sections as numbered links that bring a section to the top, the other
 *   ways a page offers from there (back, a mode, an act), and the links to the sibling pages. A page
 *   passes the groups as data and never writes a class. Its look is css/components/tab-page.css
 *   (.og-rail, .og-rail-label, .og-rail-link, shared with the admin); on a phone the rail stands
 *   under the page (the same sheet).
 *
 *   It owns the scroll: a section link scrolls the content column itself and nothing else
 *   (scrollToSection, formerly scrollTo in views/profile/organisms/poster-parts.js), after opening a
 *   folded section when the item says how. It owns the current item: `on` draws it at full strength
 *   and says aria-current.
 *
 *   Rail({ title, groups, tone }): `title` is the rail's name for a screen reader. `tone="light"`:
 *   the index on the page's own ground under a heavy ink rule, the group words in ink capitals of the
 *   poster face, the items grey, the counts in grey typewriter (the admin Config page's index on
 *   main, .adm-cfg-rail). `tone="ink"`: the App Catalog detail's rail, on the ink ground in both
 *   themes like every contents rail (it turned light in the dark theme until 2026-10-05). Each group is
 *   { label?, items, rule? }: a coral label, then its items; a rule (hr) stands between two groups
 *   unless the later one says `rule: false`.
 *
 *   An item is { label, mark?, count?, ... } and one of these ways on:
 *   - section: 'id' — scrolls to that section; `open` (a function) opens a folded section first and
 *     the scroll waits for it; with `href` ('#id') the link is an anchor, as on an organism's page.
 *   - tab: 'agents' — opens that Settings tab. Its mark and its count default to →.
 *   - href: a link (`newTab` opens it beside). Its mark and its count default to →.
 *   - onClick: anything else (a mode of the page, an act on the thing shown).
 *   - back: true — the way back, with the ← mark.
 *   - still: true — a line that only says something (no way on), drawn at full strength.
 *   - plain: true — a line that only says something, at the rail's own strength and without the
 *     pointer (a workflow's agents, the checks before a save, the "5 more" under a list).
 *   `mark` is the small mono sign on the left (a number, ←, →, ·), `count` the mono word on the
 *   right (a number, →, ↗, …); `on`, `disabled`, `title`, `key` as their names say. `code`: the
 *   label is an identifier (a memory key), in the typewriter letters as written. `notice`: the
 *   label in coral, a line that asks for a look (a check that fails). `note: true`: small grey words
 *   under the item above it, indented to its label (a board poster's standing and since when).
 * @structure Rail({ title, groups, tone }) · scrollToSection(id) · openTab(tabId) · railSection(s)
 * @usage html`<${Rail} title=${x('railTitle')} groups=${[
 *          { label: x('railTitle'), items: [{ section: 'sk-own', mark: '01', label: x('secOwn'), count: 12 }] },
 *          { label: x('pages'), items: [{ tab: 'agents', label: t('profile.tabs.agents') }] }]} />`
 * @version-history
 *   v1.4.1 — 2026-10-05 — The description of `tone="ink"` follows tab-page.css v1.7.0: the ink ground in
 *     both themes. No code change.
 *   v1.4.0 — 2026-09-27 — `tone="ink"`: the box in the text's own colour, so it turns light in the dark
 *     theme with dark words (the old app catalogue's detail rail, .dtl-rail; appcat parity); additive.
 *   v1.3.1 — 2026-09-27 — scrollToSection keeps the section's scroll-margin-top in sight above it
 *     (16px when it sets none): on the admin the headline no longer lands behind the bars that stay
 *     at the top (Jouni).
 *   v1.3.0 — 2026-09-27 — `tone="light"`: the index on the page's ground, main's admin Config index
 *     (Jouni: the dark look belongs only to the operator menu); additive.
 *   v1.2.0 — 2026-09-26 — The note line (additive, page group G7: the Boards notice page's
 *     .bp-rail-note, the poster's standing under their name).
 *   v1.1.0 — 2026-09-26 — The plain line, the code label and the notice label (additive, page group
 *     G5: the Workflows rail's .wp-rail-static, .wp-rail-key and .wp-bad lines, the Scheduler's "N more").
 *   v1.0.0 — 2026-09-26 — Initial: the rail every Settings page wrote by hand (og-rail markup, a
 *     pageLinks() helper per page, scrollTo in poster-parts.js), as data (component plan C9).
 */
import { h, Fragment } from 'preact';
import htm from 'htm';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');
const shown = (v) => v !== null && v !== undefined && v !== '' && v !== false;

/** Open a Settings tab by its id (the event the Settings frame listens to). */
export const openTab = (tabId) => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));

/**
 * Bring a section to the top of the content area, and move NOTHING else. scrollIntoView() walks
 * every scrollable ancestor, and on this shell that included the window: the static agent-footer
 * below #app gave the document 70 px of slack, and each rail click slid the whole page up by the
 * height of the top bar, which then sat above the viewport (aimeat.io, 2026-08-29, seen twice).
 * Scrolling the content region by hand touches one element and cannot reach the bar.
 * @param {string} id
 */
export const scrollToSection = (id) => {
  const el = document.getElementById(id);
  if (!el) return;
  const box = el.closest('.page-content') || el.closest('.settings-frame-content') || null;
  if (!box) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  // The section's own scroll-margin-top says how much stays in sight above it: a page with a bar
  // that stays at the top (the admin's title bar, the Config page's search row) sets it to their
  // height, so the section's headline lands under them instead of behind them. 16px otherwise.
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 16;
  const top = box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - margin;
  box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
};

/** A page's section as a rail item: { id, num, label, count, open } → the item. */
export const railSection = ({ id, num, label, count, open, href }) => ({ section: id, mark: num, label, count, open, href, key: id });

function RailItem({ item }) {
  const { label, section, open, href, newTab, tab, onClick, on, disabled, title, still, back, plain, code, notice, note } = item;
  // note (added by page group G7): small grey words under the item above (a board poster's standing).
  if (note) return html`<div class="og-rail-note" title=${title}>${label}</div>`;
  const outward = !section && (tab || href);
  const mark = item.mark !== undefined ? item.mark : back ? '←' : outward ? '→' : undefined;
  const count = item.count !== undefined ? item.count : outward ? '→' : undefined;
  const words = code || notice ? html`<span class=${cx(code && 'og-rail-code', notice && 'og-rail-notice')}>${label}</span>` : label;
  const inner = html`${shown(mark) ? html`<i>${mark}</i>` : null}${words}${shown(count) ? html`<em>${count}</em>` : null}`;
  const current = on ? 'true' : undefined;
  if (still) return html`<span class="og-rail-link on" title=${title}>${inner}</span>`;
  if (plain) return html`<span class="og-rail-link og-rail-plain" title=${title}>${inner}</span>`;
  const go = (e) => {
    if (section) {
      if (href) e.preventDefault();
      if (open) { open(); setTimeout(() => scrollToSection(section), 30); } else scrollToSection(section);
    } else if (tab) openTab(tab);
    onClick?.(e);
  };
  const cls = cx('og-rail-link', on && 'on');
  if (href) {
    return html`<a class=${cls} href=${href} title=${title} aria-current=${current}
      target=${newTab ? '_blank' : undefined} rel=${newTab ? 'noopener' : undefined} onClick=${go}>${inner}</a>`;
  }
  return html`<button type="button" class=${cls} title=${title} aria-current=${current} disabled=${disabled} onClick=${go}>${inner}</button>`;
}

/**
 * @typedef {{ label?: any, rule?: boolean, items?: Array<object|null|false> }} RailGroup
 */

/**
 * @param {{ title?: string, groups: Array<RailGroup|null|false>, tone?: 'light'|'ink' }} props
 */
export function Rail({ title, groups, tone }) {
  const list = /** @type {RailGroup[]} */ ((groups || []).filter((g) => g && (g.label || (g.items || []).some(Boolean))));
  return html`
    <nav class=${cx('og-rail', tone === 'light' && 'og-rail--light', tone === 'ink' && 'og-rail--ink')} aria-label=${title}>
      ${list.map((g, gi) => html`
        <${Fragment} key=${'g' + gi}>
          ${gi > 0 && g.rule !== false ? html`<hr />` : null}
          ${g.label ? html`<span class="og-rail-label">${g.label}</span>` : null}
          ${(g.items || []).filter(Boolean).map((it, i) => html`<${RailItem} key=${it.key ?? it.section ?? it.tab ?? i} item=${it} />`)}
        <//>`)}
    </nav>`;
}

export default Rail;
