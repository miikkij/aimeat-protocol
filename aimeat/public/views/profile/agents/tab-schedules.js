/**
 * @file tab-schedules.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agent detail › Schedules sub-tab. Shows this agent's schedules in
 *   two groups: AIMEAT-dispatched (server-managed; full controls) and Agent
 *   internal (the agent's self-reported mirror, read-only). Lets the owner create
 *   a new schedule targeting this agent (reusing the master view's CreateForm).
 * @version-history
 *   2026-09-22 -- Composed from the shared component set: one small Section (count, description,
 *     New schedule in its actions), the two groups a label over their content, the agent-internal
 *     list the shared table. It no longer borrows the Scheduler tab's sch-* classes, and the +/-
 *     glyphs on New schedule are gone (the action says open or closed through aria-expanded). No
 *     class of its own is left. Same words, data and handlers.
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
import { Section, Stack, Table, Action, Text } from '/components/poster-parts.js';

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

  if (loading) return html`<${Text} tone="muted">${t('profile.scheduler.loading')}<//>`;

  const total = managed.length + internal.length;
  const internalRows = internal.map((e) => [
    html`<${Stack} density="compact">${e.name}${e.purpose && html`<${Text} kind="caption" tone="muted">${e.purpose}<//>`}<//>`,
    html`<${Stack} density="compact"><${Text} kind="mono">${e.cron || e.schedule || '—'}<//>${e.timezone && html`<${Text} kind="caption" tone="muted">${e.timezone}<//>`}<//>`,
    e.status || 'active',
  ]);

  return html`
    <${Section} size="small" density="compact" title=${t('profile.agents.detail.tabs.schedules')}
      count=${total > 0 ? total : undefined}
      description=${t('profile.scheduler.agentDesc')}
      actions=${html`<${Action} expanded=${showForm} onClick=${() => setShowForm(v => !v)}>
        ${t('profile.scheduler.newSchedule')}
      <//>`}>
      <${Stack}>
        ${showForm && html`<${CreateForm} agents=${allAgents} lockedAgent=${agentName} showToast=${showToast}
          onCreated=${() => { setShowForm(false); loadData(); }} />`}

        <${Stack} density="compact">
          <${Text} kind="label">${t('profile.scheduler.dispatchedTitle')}<//>
          ${managed.length === 0
            ? html`<${Text} tone="muted">${t('profile.scheduler.noDispatched')}<//>`
            : html`<div>${managed.map(j => html`<${ScheduleItem} key=${j.id} schedule=${j} onChanged=${loadData} showToast=${showToast} />`)}</div>`}
        <//>

        <${Stack} density="compact">
          <${Text} kind="label">${t('profile.scheduler.internalTitle')}<//>
          <${Text} tone="muted">${t('profile.scheduler.internalNote')}<//>
          ${internal.length === 0
            ? html`<${Text} tone="muted">${t('profile.scheduler.noInternal')}<//>`
            : html`<${Table} headers=${[]} rows=${internalRows} density="compact" label=${t('profile.scheduler.internalTitle')} />`}
        <//>
      <//>
    <//>`;
}
