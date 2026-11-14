/**
 * @file public/views/appcat/recent.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Recently opened: the apps the signed-in person used last, newest first, over the lists
 *   of My Apps, so an app from yesterday is one press away among hundreds. Their own apps and other
 *   people's alike, each with the day they last used it and the way to open it. The days come from the
 *   person's own usage report (store.js openedOn: an open while signed in, and the app's calls in their
 *   name). Nothing shows for a person who is not signed in, while a search or a tag is on, or before
 *   anything was used.
 *
 *   Writes no class; the parts are components.
 * @structure RecentList({ rows }) · recentRows(rows, n)
 * @usage html`<${RecentList} rows=${cat.all} />`
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-omien-sovellusten-l-yt-minen-kun-niit-on-satoja).
 */
import { h } from 'preact';
import htm from 'htm';
import { PageSection } from '/components/PageSection.js';
import { List, Row, Name, Doors } from '/components/List.js';
import { Action } from '/components/Action.js';
import { x } from '/views/appcat/i18n.js';
import { openedOn, appRef } from '/views/appcat/store.js';
import { appName, fmtDate } from '/views/appcat/model.js';
import { openApp } from '/views/appcat/rows.js';

const html = htm.bind(h);

/** How many apps the row shows. */
const SHOWN = 6;

/** The `n` apps of `rows` the person used last, newest first; a day apart, the name decides. */
export function recentRows(rows, n = SHOWN) {
  return rows
    .map((sa) => ({ sa, day: openedOn(sa) }))
    .filter((r) => r.day)
    .sort((a, b) => b.day.localeCompare(a.day) || String(appName(a.sa)).localeCompare(String(appName(b.sa))))
    .slice(0, n);
}

export function RecentList({ rows }) {
  const recent = recentRows(rows);
  if (!recent.length) return null;
  return html`<${PageSection} list spaced title=${x('recent.title')} count=${'· ' + recent.length}>
    <${List} cols="name-doors">
      ${recent.map(({ sa, day }) => html`<${Row} key=${appRef(sa)}>
        <${Name} desc=${x('recent.line', { date: fmtDate(day) })}>${appName(sa)}<//>
        <${Doors}><${Action} small onClick=${() => openApp(sa)}>${x('card.open')}<//><//>
      <//>`)}
    <//>
  <//>`;
}
