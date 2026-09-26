/**
 * @file tab-schedules.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agent detail › Schedules sub-tab. Shows this agent's schedules in
 *   two groups: AIMEAT-dispatched (server-managed; full controls) and Agent
 *   internal (the agent's self-reported mirror, read-only). Lets the owner create
 *   a new schedule targeting this agent (reusing the master view's CreateForm).
 * @version-history
 *   v1.15.0 -- 2026-09-26 -- A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.14.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.13.0 -- 2026-09-26 -- An agent's schedules are the Listing (css/components/listing.css): the kind, name and by-agent tags in the name cell, the facts, the copy box and the purpose in the words cell, the actions in the doors, the edit form the open panel; the classic card's rules go (a unification: the look most tabs use).
 *   v1.12.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.11.0 -- 2026-09-25 -- The older tabs' remaining help lines are the Hint (.poster-hint); their own sizes and greys go, a place keeps its margin (a unification: the look most tabs use).
 *   v1.10.0 -- 2026-09-25 -- A table of rows is the Listing (css/components/listing.css): the P&L lines, the accountants, the usage report, the AI spend per app, the security overrides and an agent's internal jobs; figures stand at the right of their column (a unification: the look most tabs use).
 *   v1.9.0 -- 2026-09-25 -- Code inside a sentence or a value line is the code-inline cut of the Code block (UI consolidation phase 5, a unification).
 *   v1.8.0 -- 2026-09-25 -- The headings over lists wear .poster-day-title, grey (--quiet) over a record (Jouni's decision "Group heading", a unification).
 *   v1.7.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.6.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   v1.5.0 -- 2026-09-13 -- Compose list and guide rules from poster.css; retire unused list rules.
 *   v1.4.0 -- 2026-08-30 -- CreateForm now lives in scheduler/create-form.js (poster face); same props.
 *   v1.3.0 -- 2026-08-24 -- Live update listens on 'scheduler'; 'schedules' is emitted by nobody.
 *   v1.2.0 -- 2026-07-17 -- Dispatched / agent-internal groups become pf-agd-cards.
 *   v1.1.0 -- 2026-07-17 -- Style unification: canonical agent-detail section headers
 *     (pf-agd-section-header/-title) instead of scheduler-view headings, pf-agd-empty
 *     empty states, and the Tasks-tab "+ New" outline button pattern.
 *   v1.0.0 -- 2026-06-03 -- Initial agent Schedules sub-tab
 */
import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
import { t } from '/js/i18n.js';
import { listAgentSchedules } from '/js/services/schedules.js';
import { CreateForm } from '../scheduler/create-form.js';
import ScheduleItem from '../schedule-item.js';

const html = htm.bind(h);

export default function TabSchedules({ agentName, allAgents = [], showToast }) {
  const [managed, setManaged] = useState([]);
  const [internal, setInternal] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const res = await listAgentSchedules(agentName);
      setManaged(res?.data?.managed || []);
      setInternal(res?.data?.agentInternal || []);
    } catch (e) {
      showToast?.(e.message, true);
    } finally { setLoading(false); }
  }, [agentName, showToast]);

  const loadRef = useRef(loadData);
  loadRef.current = loadData;
  useEffect(() => {
    loadData();
    // 'scheduler' is the domain the emitters send; 'schedules' is emitted by nobody.
    return onLiveUpdate(['scheduler', 'agent-tasks'], () => loadRef.current());
  }, [loadData]);

  if (loading) return html`<div class="poster-quiet loading-mark sch-loading">${t('profile.scheduler.loading')}</div>`;

  return html`
    <div class="sch-tab">
      <div class="pf-agd-section-header">
        <span class="pf-agd-section-title sub-heading">${t('profile.agents.detail.tabs.schedules')}${managed.length + internal.length > 0 ? ` (${managed.length + internal.length})` : ''}</span>
        <button class="poster-action poster-action--small" onClick=${() => setShowForm(v => !v)}>
          ${showForm ? '-' : '+'} ${t('profile.scheduler.newSchedule')}
        </button>
      </div>
      <div class="section-desc">${t('profile.scheduler.agentDesc')}</div>

      ${showForm && html`<${CreateForm} agents=${allAgents} lockedAgent=${agentName} showToast=${showToast}
        onCreated=${() => { setShowForm(false); loadData(); }} />`}

      <div class="sch-section pf-agd-card poster-row--thing">
        <div class="pf-agd-section-title poster-day-title">${t('profile.scheduler.dispatchedTitle')}</div>
        ${managed.length === 0
          ? html`<div class="poster-quiet pf-agd-empty">${t('profile.scheduler.noDispatched')}</div>`
          : html`<div class="listing listing--name-desc-doors">${managed.map(j => html`<${ScheduleItem} key=${j.id} schedule=${j} onChanged=${loadData} showToast=${showToast} />`)}</div>`}
      </div>

      <div class="sch-section pf-agd-card poster-row--thing">
        <div class="pf-agd-section-title poster-day-title">${t('profile.scheduler.internalTitle')}</div>
        <div class="poster-hint">${t('profile.scheduler.internalNote')}</div>
        ${internal.length === 0
          ? html`<div class="poster-quiet pf-agd-empty">${t('profile.scheduler.noInternal')}</div>`
          : html`<div class="listing listing--name-desc-who-doors">
            ${internal.map((e, i) => html`<div class="listing-row" key=${e.id || i}>
              <div class="listing-name">${e.name}</div>
              <div class="listing-desc">${e.purpose || ''}</div>
              <div class="listing-who"><code class="code-inline">${e.cron || e.schedule || '—'}</code>${e.timezone && html`<small>${e.timezone}</small>`}</div>
              <div class="listing-doors">${e.status || 'active'}</div>
            </div>`)}
          </div>`}
      </div>
    </div>`;
}
