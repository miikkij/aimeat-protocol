/**
 * @file organism-ownership-tab.teams.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The teams on this node, as the operator sees them (team setup T16): each team's
 *   leads, its people and how many of them have their own AI connected, when it last changed, and
 *   the counts of its last week. Counts and names only, never a record: the operator runs the node
 *   and is not a member of its teams by doing so. Reads GET /v1/admin/teams, which
 *   aimeat_admin_teams answers too, and reads again on a live update of organisms.
 *   Every part is a library component; the page passes data and writes no class.
 * @structure useAdminTeams() · AdminTeams({ view, num })
 * @usage imported by organism-ownership-tab.js
 * @version-history
 *   v1.1.0 — 2026-11-15 — How many members went through the team's AI onboarding (T11).
 *   v1.0.0 — 2026-11-15 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n, T16).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { date as fmtDate } from '/js/format.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { swallowed } from '/js/swallowed.js';
import { Section } from '/components/Section.js';
import { List, Row as Item, Name, Num, When, Cell, Doors } from '/components/List.js';
import { Figure } from '/components/Figure.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { getAdminTeams } from '/js/services/admin.js';

const T = (key, params) => t('admin.orgOwnership.teams.' + key, params);

/** The teams on this node, or null until read; the page numbers its sections by whether there are any. */
export function useAdminTeams() {
  const [view, setView] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => getAdminTeams()
      .then((r) => { if (!cancelled) setView(r?.data ?? null); })
      .catch((err) => swallowed('admin teams: load', err));
    load();
    const off = onLiveUpdate(['organisms'], load);
    return () => { cancelled = true; off(); };
  }, []);
  return view?.teams?.length ? view : null;
}

/** The section; the page renders it only when useAdminTeams gave a view. */
export function AdminTeams({ view, num }) {
  const quietAi = view.teams.filter((r) => r.members > 0 && r.ai_connected < r.members).length;
  return html`
    <${Section} num=${num} title=${T('title')}>
      <${Note}>${T('sub', { count: view.count, quiet: quietAi })}<//>
      ${view.complete === false ? html`<${Note} kind="aside">${T('partial')}<//>` : null}
      <${List} cols="n-name-tags-n-when-doors" keepCols
        head=${[{ label: '#', num: true }, T('colTeam'), T('colState'), { label: T('colPeople'), num: true }, T('colChanged'), '']}>
        ${view.teams.map((r, i) => html`
          <${Item} key=${r.organism_id}>
            <${Num}><${Figure} small n=${String(i + 1).padStart(2, '0')} /><//>
            <${Name} meta=${T('leads', { names: r.leads.join(', ') || '—' })}>${r.name}<//>
            <${Cell} line>
              <${Mark}>${r.kind === 'virtual' ? T('virtual') : T('team')}<//>
              <${Mark} tone=${r.members > 0 && r.ai_connected < r.members ? 'attention' : 'fine'}>${T('ai', { n: r.ai_connected, of: r.members })}<//>
              ${r.temporary ? html`<${Mark}>${T('temporary', { n: r.temporary })}<//>` : null}
              ${r.ends_on ? html`<${Mark}>${T('ends', { date: fmtDate(r.ends_on) })}<//>` : null}
              <${Mark} tone=${r.members > 0 && (r.ai_onboarding ?? 0) < r.members ? 'attention' : 'fine'}>${T('onboarded', { n: r.ai_onboarding ?? 0, of: r.members })}<//>
              <${Note} kind="meta" inline>${T('week', { decided: r.week.decided, open: r.week.open, waiting: r.week.waiting })}<//>
            <//>
            <${Num}>${r.members}<//>
            <${When}>${r.last_change ? fmtDate(r.last_change) : '—'}<//>
            <${Doors} />
          <//>`)}
      <//>
      <${Note} kind="quiet">${T('privacy')}<//>
    <//>`;
}
