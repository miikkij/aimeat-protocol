/**
 * @file public/views/home/teams-band.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The home's "Your teams" band (block home.teams, team setup T15): one line per team the
 *   person is in, saying what waits for them there, how many decisions the team made this week, how
 *   many matters are open, and whether their own AI is connected. It brings no new information
 *   together: the team status (GET /v1/teams/status, counts only) and what waits for the person
 *   (GET /v1/teams/waiting). A person in no team sees nothing.
 * @structure TeamsBand
 * @usage html`<${TeamsBand} status=${status} waiting=${waiting} />` (views/surface/blocks-home.js TeamsBlock)
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n, T15).
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { useSession } from '/js/use-session.js';
import { Band, BandNote } from '/components/Band.js';
import { LineList } from '/components/LineList.js';

const html = htm.bind(h);
const x = (key, vars) => t(`home.teams.${key}`, vars);

/** What waits for the person in one team: items written for them and approvals their role decides. */
function waitingIn(waiting, orgId) {
  const items = (waiting?.items ?? []).filter((i) => i.organism_id === orgId).length;
  const approvals = (waiting?.approvals ?? []).filter((a) => a.organism_id === orgId).length;
  return items + approvals;
}

/** @param {{ status: any, waiting: any }} p */
export function TeamsBand({ status, waiting }) {
  const session = useSession();
  const teams = status?.teams ?? [];
  if (!teams.length) return null;
  const me = session?.owner ?? '';
  const rows = teams.map((tm) => {
    const mine = (tm.members ?? []).find((m) => m.account === me);
    const parts = [];
    const n = waitingIn(waiting, tm.organism_id);
    if (n) parts.push(x('waiting', { n }));
    if (tm.week?.decided) parts.push(x('decided', { n: tm.week.decided }));
    if (tm.week?.open) parts.push(x('open', { n: tm.week.open }));
    parts.push(mine?.ai?.connected ? x('aiOn', { name: mine.ai.agents?.[0]?.name ?? '' }) : x('aiOff'));
    return {
      id: tm.organism_id,
      name: tm.name,
      text: `${tm.you_lead ? x('lead') : x('member', { n: (tm.members ?? []).length })} · ${parts.join(' · ')}`,
      href: `/v1/profile?tab=organisms&org=${encodeURIComponent(tm.organism_id)}`,
    };
  });
  return html`
    <${Band} title=${x('title')}>
      <${BandNote}>${x('note')}<//>
      <${LineList} rows=${rows} />
    <//>`;
}
