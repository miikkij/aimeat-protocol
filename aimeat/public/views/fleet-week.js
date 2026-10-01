/**
 * @file public/views/fleet-week.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the person's agents did in the last 7 days, at the top of the Fleet page (guided
 *   journey P4, brief doc-mupor242l3cq).
 *
 *   WHY. The Fleet page talked about sign-in health only, so an agent that worked all week looked the
 *   same as one that did nothing. The count is `stats.tasks.doneWeek` from GET /v1/agents?include=stats,
 *   per agent, newest work first. The sign-in health follows it on the page.
 * @structure WeekBlock({ agents })
 * @usage <${WeekBlock} agents=${agents} />
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { Facts, FactLine } from '/components/Facts.js';

/** At most this many agents are named; the total counts all of them. */
const SHOWN = 6;

export function WeekBlock({ agents }) {
  const worked = (agents ?? [])
    .filter(a => (a.stats?.tasks?.doneWeek ?? 0) > 0)
    .sort((a, b) => String(b.stats.tasks.lastTaskUpdateAt ?? '').localeCompare(String(a.stats.tasks.lastTaskUpdateAt ?? '')));
  const total = worked.reduce((n, a) => n + a.stats.tasks.doneWeek, 0);
  const rows = worked.slice(0, SHOWN).map(a => html`
    <${FactLine} key=${a.name} sub=${a.stats.tasks.lastTaskUpdateAt ? t('fleet.week.last', { when: timeAgo(a.stats.tasks.lastTaskUpdateAt) }) : ''}>
      ${t('fleet.week.agentDone', { name: a.display_name || a.name, n: a.stats.tasks.doneWeek })}
    <//>`);
  return html`<${Facts} wide rows=${[{
    k: t('fleet.week.title'),
    v: total > 0 ? html`${t('fleet.week.total', { n: total })}${rows}` : t('fleet.week.none'),
    sub: worked.length > SHOWN ? t('fleet.week.more', { n: worked.length - SHOWN }) : '',
  }]} />`;
}
