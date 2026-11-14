/**
 * @file public/views/profile/organisms/team-map.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The team map (team setup T21): drawn from the teams themselves, never from an org
 *   chart. One tile per team the reader is in, with its leads, how many members have their own AI
 *   connected, its last day, and the teams it depends on (said in chat: "Sales needs the technical
 *   details from software"); under the tiles, the people the teams share. It shows only the teams the
 *   reader is a member of and none of their content. No hierarchy: a flat organisation of teams and
 *   virtual teams is the normal case. Reads GET /v1/teams/status and reads again on a live update.
 * @structure TeamMap
 * @usage html`<${TeamMap} onOpen=${(orgId) => …} />` (views/profile/organisms-tab.js)
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n, T21).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { swallowed } from '/js/swallowed.js';
import { Section } from '/components/Section.js';
import { Card, CardGrid } from '/components/Card.js';
import { LineList } from '/components/LineList.js';
import { Note } from '/components/Note.js';

const html = htm.bind(h);
const x = (key, vars) => t(`organisms.teamMap.${key}`, vars);

/** @param {{ onOpen: (orgId: string) => void }} p */
export function TeamMap({ onOpen }) {
  const [teams, setTeams] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => apiGet('/v1/teams/status')
      .then((r) => { if (!cancelled) setTeams(r?.data?.teams ?? []); })
      .catch((err) => swallowed('team-map: load', err));
    load();
    const off = onLiveUpdate(['organisms'], load);
    return () => { cancelled = true; off(); };
  }, []);
  // A map of one team says nothing a list does not.
  if (!teams || teams.length < 2) return null;

  const nameOf = Object.fromEntries(teams.map((tm) => [tm.organism_id, tm.name]));
  const teamsOf = new Map();
  for (const tm of teams) for (const m of tm.members ?? []) {
    teamsOf.set(m.account, [...(teamsOf.get(m.account) ?? []), tm.name]);
  }
  const shared = [...teamsOf.entries()].filter(([, names]) => names.length > 1)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

  return html`
    <${Section} band title=${x('title')}>
      <${Note}>${x('lead')}<//>
      <${CardGrid}>
        ${teams.map((tm) => {
          const members = (tm.members ?? []).length;
          const meta = [x('members', { n: members }), x('ai', { n: tm.ai_connected ?? 0, of: members })];
          if (tm.ends_on) meta.push(x('until', { date: tm.ends_on }));
          const deps = (tm.depends_on ?? []).map((d) => `→ ${nameOf[d.organism_id] ?? x('otherTeam')}${d.what ? `: ${d.what}` : ''}`);
          return html`<${Card} key=${tm.organism_id} tone="framed"
            kicker=${tm.kind === 'virtual' ? x('virtual') : x('team')}
            name=${tm.name}
            sub=${(tm.leads ?? []).length ? x('leads', { names: tm.leads.join(', ') }) : null}
            text=${deps.length ? deps.join(' · ') : null}
            meta=${meta.join(' · ')}
            onOpen=${() => onOpen(tm.organism_id)} openLabel=${x('open')} />`;
        })}
      <//>
      ${shared.length ? html`
        <${LineList} rows=${shared.slice(0, 12).map(([account, names]) => ({ id: account, name: account, text: names.join(', '), href: `/v1/profile?tab=contacts` }))} />` : null}
      <${Note} kind="quiet">${x('chat')}<//>
    <//>`;
}
