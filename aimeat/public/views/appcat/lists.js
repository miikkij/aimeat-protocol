/**
 * @file public/views/appcat/lists.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The catalogue's three lists and its foot (features.md F31–F53): your apps (with its
 *   headline, the loading, empty and no-match states, and the foot line), the community (a headline
 *   that folds the list, its loading and empty blocks, hidden whole when a search or a tag leaves
 *   nothing), the favourites (every starred app, own and others', drawn as the community's rows), and
 *   the foot on ink. One row open at a time in each list. Drawn with PageSection list, List index,
 *   EmptyState and InkFoot; no class here.
 * @structure LibraryList(props) · CommunityList(props) · FavouritesList(props) · BuildingList(props) · CatFoot({ loaded, n })
 * @usage html`<${LibraryList} rows=${rows} total=${own.length} … />`
 * @version-history
 *   v1.2.0 — 2026-10-04 — BuildingList: the apps the person builds for somebody else (wish-appcatin-sovellussivulle-design-spec-roadmap-rakentajat-ja-l).
 *   v1.1.0 — 2026-09-27 — Parity with the old page: the foot line and the 6px under the own list's
 *     headline are PageSection's (`foot`, `spaced`); an open row closes when the old page drew its
 *     list anew (search, tag, state, order, star, listing) or a filter hides it; the community and
 *     favourites rows keep their number under a search or a tag.
 *   v1.0.0 — 2026-09-27 — Initial (appcat, the shell).
 */
import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { PageSection } from '/components/PageSection.js';
import { List } from '/components/List.js';
import { EmptyState } from '/components/EmptyState.js';
import { InkFoot } from '/components/InkFoot.js';
import { x } from '/views/appcat/i18n.js';
import { appRef } from '/views/appcat/store.js';
import { AppRow } from '/views/appcat/rows.js';

const html = htm.bind(h);
const CUT = 'n-mark-name-desc-state-n-arrow';

/**
 * One open row per list: pressing it again closes it, pressing another moves the panel (F38).
 * The old page drew a list anew on every search, tag, state, order, star and listing, and a list
 * drawn anew has no row open; `closeOn` names those moments. A row a filter hides is never left
 * open (the old applyServerFilter).
 */
function useOpenRow(closeOn, rows) {
  const [openRef, setOpenRef] = useState(null);
  const seen = useRef(closeOn);
  useEffect(() => {
    // After every render: a moment in `closeOn` that changed closes the open row.
    if (closeOn.length !== seen.current.length || closeOn.some((v, i) => v !== seen.current[i])) {
      seen.current = closeOn;
      setOpenRef(null);
    }
  }, [closeOn]);
  useEffect(() => {
    if (openRef && !rows.some((sa) => appRef(sa) === openRef)) setOpenRef(null);
  }, [rows, openRef]);
  return [openRef, (ref) => setOpenRef((cur) => (cur === ref ? null : ref))];
}

/**
 * The rows of a list. `order` (the community and the favourites) is the list before the search and
 * the tag: a row keeps its number from there, as the old page hid rows without numbering them anew.
 */
function rowsOf(rows, own, favourites, openRef, toggle, order) {
  return rows.map((sa, i) => {
    const ref = appRef(sa);
    const n = order ? order.indexOf(sa) : i;
    return html`<${AppRow} key=${ref} sa=${sa} i=${n < 0 ? i : n} own=${own} open=${openRef === ref} onToggle=${() => toggle(ref)} starred=${favourites.has(ref)} />`;
  });
}

/** The waiting block (F41, F48): the ring, "Loading apps…" and where it fetches from. */
const Loading = () => html`<${EmptyState} start loading title=${x('loading.apps')} text=${x('loading.appsHint')} />`;

/**
 * Your apps (F31–F43): `rows` are the filtered and ordered own apps, `total` how many the person has.
 * `closeOn`: the moments the old page drew the list anew (see useOpenRow).
 * @param {{ rows: any[], total: number, loaded: boolean, filtering: boolean, favourites: Set<string>, closeOn: any[] }} props
 */
export function LibraryList({ rows, total, loaded, filtering, favourites, closeOn }) {
  const [openRef, toggle] = useOpenRow(closeOn, rows);
  let body;
  if (!rows.length) {
    if (!loaded) body = html`<${Loading} />`;
    else if (!filtering && total === 0) {
      body = html`<${EmptyState} start icon="🚀" title=${x('empty.noApps')} text=${x('empty.noAppsDesc')} aside=${x('empty.formats')} />`;
    } else body = html`<${EmptyState} start icon="🔍" title=${x('empty.noMatch')} text=${x('empty.noMatchDesc')} />`;
  } else {
    body = html`<${List} cols=${CUT} index>${rowsOf(rows, true, favourites, openRef, toggle)}<//>`;
  }
  // The headline shows only when the person has at least one app (F31).
  if (total > 0) return html`<${PageSection} list spaced title=${x('sec.local')} count=${'· ' + total} foot=${x('list.foot')}>${body}<//>`;
  return html`<${PageSection} list plain foot=${x('list.foot')}>${body}<//>`;
}

/**
 * The community (F44–F50): the headline folds the list; while the first listing is on its way the
 * waiting block, when there is none the empty block; a search or a tag that leaves nothing hides it.
 * `order` is the list before the search and the tag (a row's number); `closeOn` as the own list's.
 * @param {{ rows: any[], order: any[], total: number, loaded: boolean, filtering: boolean, favourites: Set<string>, closeOn: any[] }} props
 */
let communityFolded = false; // the fold stays as the person left it while they switch views (F72)

export function CommunityList({ rows, order, total, loaded, filtering, favourites, closeOn }) {
  const [openRef, toggle] = useOpenRow(closeOn, rows);
  const [folded, setFoldedState] = useState(communityFolded);
  const setFolded = (v) => { communityFolded = v; setFoldedState(v); };
  if (!total) {
    // The old community waiting and empty blocks were .view-empty lines under the heavy rule.
    if (!loaded) return html`<${PageSection} list plain><${EmptyState} line ruled loading text=${x('loading.apps')} hint=${x('loading.appsHint')} /><//>`;
    return html`<${PageSection} list plain><${EmptyState} line ruled text=${x('view.communityEmpty')} hint=${x('view.communityHint')} /><//>`;
  }
  if (filtering && !rows.length) return null;
  return html`<${PageSection} list title=${x('sec.community')} count=${'· ' + rows.length}
    onFold=${() => setFolded(!folded)} folded=${folded} foldLabel=${x('sec.community')}>
    <${List} cols=${CUT} index>${rowsOf(rows, false, favourites, openRef, toggle, order)}<//>
  <//>`;
}

/**
 * The favourites (F51, F52): every starred app of the listing, own ones too, in the community's rows
 * (the old page's choice, F362).
 * @param {{ rows: any[], order: any[], total: number, favourites: Set<string>, closeOn: any[] }} props
 */
export function FavouritesList({ rows, order, total, favourites, closeOn }) {
  const [openRef, toggle] = useOpenRow(closeOn, rows);
  return html`<${PageSection} list title=${x('fav.title')} count=${'· ' + total}>
    ${total === 0
      ? html`<${EmptyState} line text=${x('fav.empty')} hint=${x('fav.emptyHint')} />`
      : html`<${List} cols=${CUT} index>${rowsOf(rows, false, favourites, openRef, toggle, order)}<//>`}
  <//>`;
}

/**
 * The apps somebody else owns that the person may build: their design spec and roadmap open from
 * the row's detail, as on an own app.
 * @param {{ rows: any[], order: any[], total: number, favourites: Set<string>, closeOn: any[] }} props
 */
export function BuildingList({ rows, order, total, favourites, closeOn }) {
  const [openRef, toggle] = useOpenRow(closeOn, rows);
  return html`<${PageSection} list title=${x('building.title')} count=${'· ' + total} foot=${x('building.foot')}>
    ${total === 0
      ? html`<${EmptyState} line text=${x('building.empty')} />`
      : html`<${List} cols=${CUT} index>${rowsOf(rows, false, favourites, openRef, toggle, order)}<//>`}
  <//>`;
}

/**
 * The foot on ink (F53): the count of the person's apps (blank until the listing has loaded), the
 * word on AI, and the brand.
 * @param {{ loaded: boolean, n: number }} props
 */
export function CatFoot({ loaded, n }) {
  return html`<${InkFoot} brand="AIMEAT">
    <p>${loaded ? x('foot.p1', { n }) : ''}</p>
    <p>${x('foot.p2')}</p>
  <//>`;
}
