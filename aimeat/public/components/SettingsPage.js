/**
 * @file public/components/SettingsPage.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A whole Settings & Controls page (component plan C9, page parts): the crumb, the head
 *   (PageHead), the figure strip, and under them the page's sections beside the contents rail
 *   (Rail), which on a phone stands under the page. Every Settings tab wrote this frame by hand
 *   (<div class="og og-<page>">, a crumb() and a pageLinks() helper per page, og-mast, og-grid,
 *   og-main, og-rail); a page now passes data and its sections, and never a class. The look is the
 *   library's page kit: css/components/tab-page.css, page-head.css, crumb-trail.css (the og-*
 *   names, shared with the admin) and css/components/settings-page.css (the two layouts below).
 *
 *   Three layouts, chosen by what the page passes:
 *   - With a rail (`sections`, `pages`, `back` or `rail`): the sections in the page column, the
 *     rail beside it. `rail` may be a list of rails, stacked in the side column (Memory's key
 *     space stands its own rail over the page's). `side` puts a thing of the page's own in the
 *     rail's place (an organism workspace's tree).
 *   - Without one: the head in its own block, then the page's content under it (the classic
 *     Settings pages: Security, Services, Nodes, Fleet, Usage, Work, Chat sessions, ...).
 *   - `page`: a page inside a page (a record, a board, a person): the smaller head, and a rule
 *     over the page column.
 *
 *   The data:
 *   - name: the page's short name as its sheet knows it ('skills' gives the root .og-skills, which
 *     css/views/skills-poster.css keys its rules on). It goes when the page's sheet goes.
 *   - crumb: the steps (see Crumb.js).
 *   - label, title, sub, marks, desc, actions: the head (see PageHead.js).
 *   - strip: the figure strip under the head (a slot: the FigureStrip component).
 *   - sections: the page's sections for the rail, [{ id, num, label, count, open }]; railTitle
 *     names that group and the rail; back ({ label, onClick }) stands first in it; railItems are
 *     more items of that group after the sections (a mode of the page, an act; see Rail.js).
 *   - pages: the links to the sibling pages under pagesLabel, [{ tab, label } | { href, label,
 *     newTab } | { onClick, label }] (see Rail.js for every field).
 *   - rail: the whole rail as data ({ title, groups }) when the short form above does not say it,
 *     or a list of them.
 *   - aside: what stands in the side column over the rails (a record's own settings: its
 *     visibility, its tags, the shares that cover it); the column then stacks as with two rails.
 *   - asKey: the title is a memory key (see PageHead.js).
 *   - after: what the page draws after its frame inside it (its confirm dialog, a dialog, a file
 *     field).
 * @structure SettingsPage(props) · settingsRail(props)
 * @usage html`<${SettingsPage} name="skills" crumb=${[t('nav.profile'), t('profile.landing.menuBuildShare'), t('skills.tabLabel')]}
 *          title=${t('skills.tabLabel')} sub=${x('titleSub')} marks=${marks} desc=${x('desc')} actions=${actions}
 *          strip=${strip} railTitle=${x('railTitle')} sections=${sections} pagesLabel=${x('pages')} pages=${pages}
 *          after=${html`<${ctx.ConfirmUI} />`}>…the sections…<//>`
 * @version-history
 *   v1.2.0 — 2026-09-26 — `edit` passed to PageHead: the rename field in the title's place (a
 *     calibration's page; additive, G4).
 *   v1.1.0 — 2026-09-26 — `aside` (settings over the rails in the side column) and `asKey` (a key as
 *     the title), for Memory's record page (additive, G3).
 *   v1.0.0 — 2026-09-26 — Initial: the Settings page frame as one component (component plan C9).
 */
import { h } from 'preact';
import htm from 'htm';
import { Crumb } from '/components/Crumb.js';
import { PageHead } from '/components/PageHead.js';
import { Rail, railSection } from '/components/Rail.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');

/**
 * The rail a page's short form says: its sections (with the way back first), then its sibling
 * pages. Null when the page has neither.
 */
export function settingsRail({ railTitle, sections, back, pages, pagesLabel, railItems }) {
  const own = [back ? { back: true, key: 'back', ...back } : null, ...(sections || []).map(railSection), ...(railItems || [])].filter(Boolean);
  const groups = [];
  if (own.length) groups.push({ label: railTitle, items: own });
  // A sibling page is marked → on both sides, whichever way it opens (a tab, a link, a route).
  if (pages && pages.length) groups.push({ label: pagesLabel, items: pages.filter(Boolean).map((p) => ({ mark: '→', count: '→', ...p })) });
  return groups.length ? { title: railTitle, groups } : null;
}

export function SettingsPage(props) {
  const { name, page, crumb, label, title, sub, marks, desc, actions, strip, rail, side, aside, after, asKey, children } = props;
  const rails = (Array.isArray(rail) ? rail : [rail || settingsRail(props)]).filter(Boolean);
  const head = html`
    ${crumb ? html`<${Crumb} steps=${crumb} />` : null}
    <${PageHead} label=${label} title=${title} sub=${sub} marks=${marks} desc=${desc} actions=${actions} page=${page} asKey=${asKey} edit=${props.edit} />`;
  const column = side || (rails.length > 1 || aside
    ? html`<div class="settings-page-side">${aside}${rails.map((r, i) => html`<${Rail} key=${i} ...${r} />`)}</div>`
    : rails.length ? html`<${Rail} ...${rails[0]} />` : null);
  return html`
    <div class=${cx('og', name && `og-${name}`, page && 'og-page')}>
      ${column ? head : html`<div class="settings-page-head">${head}</div>`}
      ${strip}
      ${column ? html`
        <div class="og-grid">
          <div class=${cx('og-main', page && 'poster-row--thing')}>${children}</div>
          ${column}
        </div>` : children}
      ${after}
    </div>`;
}

export default SettingsPage;
