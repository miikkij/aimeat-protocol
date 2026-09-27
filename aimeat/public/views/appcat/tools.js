/**
 * @file public/views/appcat/tools.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The parts between the masthead and the lists (features.md F25–F30, F73, F76, F96,
 *   F162): the band with the four numbers of the own apps on the diagonal coral stripe, the one
 *   search with the order row at its foot, and the Active Extensions bar (the node's active public
 *   extensions, folded by default, each a tile that opens its popup). The bar reads with an anonymous
 *   token, as the old page did (F244, F245). Drawn with NumberBand fitted, SearchLine big, Tabs,
 *   Card and CardGrid; no class here.
 * @structure CatBand({ counts, n }) · CatTools({ q, onQuery, sort, onSort }) · CortexBar() · loadCortex()
 * @usage html`<${CatBand} …/><${CatTools} …/><${CortexBar} />`
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial (appcat, the shell).
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { NumberBand } from '/components/NumberBand.js';
import { SearchLine } from '/components/List.js';
import { Tabs } from '/components/Tabs.js';
import { Card, CardGrid } from '/components/Card.js';
import { Action } from '/components/Action.js';
import { Row, Space } from '/components/Layout.js';
import { SubHeading } from '/components/SubHeading.js';
import { onLocaleChange } from '/js/i18n.js';
import { x } from '/views/appcat/i18n.js';
import { openDialog } from '/views/appcat/dialogs/host.js';
import { anonymousToken } from '/views/appcat/dialogs/app-io.js';
import { fmtNum } from '/views/appcat/model.js';

const html = htm.bind(h);

/** The id of the search field (Ctrl+F brings the focus to it, F172). */
export const SEARCH_ID = 'appcat-search';

/**
 * The band (F25): Apps, Listed, Draft waiting, Opens all time; shown once the listing has loaded and
 * the person has at least one app.
 * @param {{ counts: { listed: number, draft: number, opens: number }, n: number }} props
 */
export function CatBand({ counts, n }) {
  return html`<${NumberBand} fitted items=${[
    { key: 'apps', n: String(n), label: x('band.apps') },
    { key: 'listed', n: String(counts.listed), label: x('band.listed') },
    { key: 'drafts', n: String(counts.draft), label: x('band.drafts') },
    { key: 'opens', n: fmtNum(counts.opens), label: x('band.opens') },
  ]} />`;
}

/**
 * The search and the order (F27, F28, F73, F76): typing filters every list at once; the order is
 * shared by the three lists and is not remembered.
 * @param {{ q: string, onQuery: (q: string) => void, sort: string, onSort: (s: string) => void }} props
 */
export function CatTools({ q, onQuery, sort, onSort }) {
  return html`<${SearchLine} big text id=${SEARCH_ID} value=${q} placeholder=${x('search.ph')} label=${x('search.ph')}
    onInput=${(e) => onQuery(e.currentTarget.value)}>
    <${Tabs} tone="line" caption=${x('sort.label')} label=${x('sort.label')} value=${sort} onSelect=${onSort} items=${[
      { value: 'newest', label: x('sort.newest') },
      { value: 'opens', label: x('sort.opens') },
      { value: 'name', label: x('sort.name') },
    ]} />
  <//>`;
}

/** The node's active public extensions (F245), read with an anonymous token (F244). */
export async function loadCortex() {
  const token = await anonymousToken();
  if (!token) return { token: null, list: [] };
  const resp = await fetch('/v1/cortex?status=active&visibility=public', { headers: { Authorization: 'Bearer ' + token } });
  const json = await resp.json();
  return { token, list: (json && json.data && json.data.extensions) || [] };
}

/**
 * The Active Extensions bar (F29, F30, F96): hidden unless the node has one; its tiles are folded
 * until "▶ toggle" is pressed; a tile opens the extension's popup. Read again on a language change (F86).
 */
let cached = null; // read once per page, and again on a language change (the old page's rhythm)
let barOpen = false; // folded by default; stays as the person left it while they switch views

export function CortexBar() {
  const [data, setData] = useState(cached || { token: null, list: [] });
  const [open, setOpenState] = useState(barOpen);
  const setOpen = (v) => { barOpen = v; setOpenState(v); };
  useEffect(() => {
    let live = true;
    const load = () => loadCortex().then((d) => { cached = d; if (live) setData(d); }, () => { /* the bar stays hidden, as before */ });
    if (!cached) load();
    const off = onLocaleChange(load);
    // The extension editor's Save & Re-install says the bar is stale; it is read again.
    window.addEventListener('appcat-cortex-changed', load);
    return () => { live = false; off?.(); window.removeEventListener('appcat-cortex-changed', load); };
  }, []);
  if (!data.list.length) return null;
  return html`<${Space} below="section" inset="section">
    <${Row} justify="between" below="medium">
      <${SubHeading} level=${3} quiet>${x('cortex.active')}<//>
      <${Action} tone="plain" expanded=${open} onClick=${() => setOpen(!open)}>${open ? '▼' : '▶'} ${x('common.toggle')}<//>
    <//>
    ${open ? html`<${CardGrid} cols="strip">
      ${data.list.map((ext) => {
        const types = ext.component_types || [];
        const libs = types.filter((tp) => tp === 'lib').length;
        const schemas = types.filter((tp) => tp === 'schema').length;
        return html`<${Card} key=${ext.name} tone="framed" name=${'📦 ' + (ext.short_name || ext.name)}
          meta=${x('cortex.chipMeta', { libs, schemas })} openLabel=${ext.name}
          onOpen=${() => openDialog('cortex', { name: ext.name, token: data.token })} />`;
      })}
    <//>` : null}
  <//>`;
}
