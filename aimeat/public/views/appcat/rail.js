/**
 * @file public/views/appcat/rail.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The catalogue's index at the page's left (features.md F16–F21): the way home, the
 *   page's name with its 📚, the three views with their counts, the state rows and the "Something
 *   missing" rows (the own list only), and the tags of the list on screen with their counts, folded
 *   after eight. Drawn with the SideMenu in its index tone; this file gives data and never a class.
 * @structure CatRail(props)
 * @usage html`<${CatRail} view=${view} onView=${setView} … />`
 * @version-history
 *   v1.1.0 — 2026-09-27 — "Something missing" is a second word inside the state group
 *     (SideMenuLabel), as the old #state-bar held both: no air between, one strip on a phone.
 *   v1.0.0 — 2026-09-27 — Initial (appcat, the shell).
 */
import { h } from 'preact';
import htm from 'htm';
import { SideMenu, SideMenuTitle, SideMenuHome, SideMenuItem, SideMenuGroup, SideMenuLabel, SideMenuMore } from '/components/SideMenu.js';
import { x } from '/views/appcat/i18n.js';
import { KUNTO_KEYS, tagCounts } from '/views/appcat/model.js';

const html = htm.bind(h);
const TAGS_FOLDED = 8;

/**
 * @param {{ view: string, onView: (v: string) => void, loaded: boolean,
 *   counts: { library: number, community: number, favorites: number },
 *   states: { listed: number, unlisted: number, draft: number, kunto: Record<string, number> } | null,
 *   stateFilter: string|null, onState: (s: string) => void,
 *   tagRows: any[], tag: string|null, onTag: (t: string|null) => void, tagsOpen: boolean, onTagsOpen: () => void }} p
 */
export function CatRail(p) {
  const views = [
    { value: 'library', label: x('view.library'), n: p.loaded ? p.counts.library : '' },
    { value: 'community', label: x('view.community'), n: p.loaded && p.counts.community > 0 ? p.counts.community : '' },
    { value: 'favorites', label: x('view.favorites'), n: p.loaded ? p.counts.favorites : '' },
  ];
  const tags = tagCounts(p.tagRows);
  const activeLc = p.tag ? p.tag.toLowerCase() : null;
  let shown = p.tagsOpen ? tags : tags.slice(0, TAGS_FOLDED);
  // An active tag past the fold stays on screen, or the reader cannot see why the list is short (F20).
  if (activeLc && !shown.some((tg) => tg.key === activeLc)) shown = shown.concat(tags.filter((tg) => tg.key === activeLc));
  const kuntoRows = p.states && p.loaded ? KUNTO_KEYS.filter((k) => p.states.kunto[k] > 0) : [];
  return html`
    <${SideMenu} index label=${x('header.title')}>
      <${SideMenuHome} href="/v1/home">← ${x('rail.home')}<//>
      <${SideMenuTitle} mark="📚">${x('header.title')}<//>
      <${SideMenuGroup} role="tablist" label=${x('header.title')}>
        ${views.map((v) => html`<${SideMenuItem} key=${v.value} tab tally active=${p.view === v.value} count=${v.n}
          onClick=${() => p.onView(v.value)}>${v.label}<//>`)}
      <//>
      ${p.states ? html`
        <${SideMenuGroup} title=${x('rail.state')}>
          ${['listed', 'unlisted', 'draft'].map((s) => html`<${SideMenuItem} key=${s} tally active=${p.stateFilter === s}
            count=${p.states[s]} onClick=${() => p.onState(s)}>${x('state.' + s)}<//>`)}
          ${kuntoRows.length ? html`<${SideMenuLabel}>${x('rail.kunto')}<//>` : null}
          ${kuntoRows.map((k) => html`<${SideMenuItem} key=${k} tally active=${p.stateFilter === k}
            count=${p.states.kunto[k]} onClick=${() => p.onState(k)}>${x('kunto.' + k)}<//>`)}
        <//>` : null}
      <${SideMenuGroup} title=${x('rail.tags')}>
        <${SideMenuItem} tally small active=${p.tag === null} count=${p.tagRows.length} onClick=${() => p.onTag(null)}>${x('tag.all')}<//>
        ${shown.map((tg) => html`<${SideMenuItem} key=${tg.key} tally small active=${activeLc === tg.key} count=${tg.n}
          onClick=${() => p.onTag(tg.label)}>${tg.label}<//>`)}
        ${tags.length > TAGS_FOLDED ? html`<${SideMenuMore} onClick=${p.onTagsOpen}>${p.tagsOpen ? x('rail.fewerTags') : x('rail.allTags', { n: tags.length })}<//>` : null}
      <//>
    <//>`;
}

export default CatRail;
