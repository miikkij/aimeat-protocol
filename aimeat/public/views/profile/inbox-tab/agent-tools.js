/**
 * @file public/views/profile/inbox-tab/agent-tools.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a thread with an agent adds above the composer: the agent's advertised chat
 *   commands (CommandBar), the form that fills one in (CommandFill), and, for the person's OWN
 *   agent, its schedule (SchedulePanel: the node scheduler scoped to that agent).
 * @structure CommandBar · CommandFill · SchedulePanel
 * @usage import { CommandBar, CommandFill, SchedulePanel } from './agent-tools.js';
 * @version-history
 *   v1.0.0 -- 2026-09-22 -- Moved out of components.js and composed from the shared set (Surface,
 *     Field, Action, ListRow), so the inbox sheets could go. The emoji left the headings.
 *     Behaviour unchanged.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);

import { t } from '/js/i18n.js';
import * as schedules from '/js/services/schedules.js';
import { swallowed } from '/js/swallowed.js';
import { Action, Field, ListRow, Stack, Surface, Text } from '/components/poster-parts.js';

/* ── Agent chat commands (Phase A) — a peer agent advertises fill-in templates via its public
 *    `chat.commands` memory key ([{id,label,description,template,params:[{name,type,required,placeholder,
 *    default,options}]}]). We render a chip per command; the human fills the params; the resulting prose
 *    drops into the composer to review + send. The agent receives the filled template it advertised. ── */
export function CommandBar({ commands, onPick }) {
  return html`<${Stack} direction="wrap" align="center" density="compact">
    <${Text} kind="label">${t('inbox.cmdTitle')}<//>
    ${commands.map(c => html`<${Action} key=${c.id} kind="tab" title=${c.description || ''}
      onClick=${() => onPick(c)}>${c.label || c.id}<//>`)}
  <//>`;
}

export function CommandFill({ command, onInsert, onCancel }) {
  const [values, setValues] = useState({});
  const params = Array.isArray(command.params) ? command.params : [];
  const valOf = (p) => String(values[p.name] ?? p.default ?? '');
  const missing = params.some(p => p.required && !valOf(p).trim());
  const set = (p) => (e) => setValues(v => ({ ...v, [p.name]: e.target.value }));
  return html`<${Surface} kind="box" density="compact">
    <${Stack} density="compact">
      <${Stack} direction="horizontal" align="between">
        <${Text} kind="heading" size="small">${command.label || command.id}<//>
        <${Action} kind="text" label=${t('inbox.close')} title=${t('inbox.close')} onClick=${onCancel}>✗<//>
      <//>
      ${command.description ? html`<${Text} tone="muted">${command.description}<//>` : null}
      ${params.map(p => (p.type === 'select' && Array.isArray(p.options)
        ? html`<${Field} key=${p.name} type="select" label=${p.name + (p.required ? ' *' : '')} value=${valOf(p)}
            options=${p.options.map(o => ({ value: o, label: String(o) }))} onChange=${set(p)} />`
        : html`<${Field} key=${p.name} type=${p.type === 'number' ? 'number' : 'text'} label=${p.name + (p.required ? ' *' : '')}
            placeholder=${p.placeholder || ''} value=${valOf(p)} onInput=${set(p)} />`))}
      <${Stack} direction="horizontal">
        <${Action} disabled=${missing} onClick=${() => onInsert(command, values)}>${t('inbox.cmdInsert')}<//>
      <//>
    <//>
  <//>`;
}

/* ── Agent schedule (Phase B) — surfaces the node scheduler scoped to one of YOUR OWN agents
 *    (GET/POST /v1/agents/:name/schedules, which always resolve under the caller's owner). List the
 *    agent's managed jobs + create a recurring agent_task. Only shown for the human's own agents. ── */
export function SchedulePanel({ agentName, onClose, showToast }) {
  const [jobs, setJobs] = useState(null);
  const [title, setTitle] = useState('');
  const [cron, setCron] = useState('0 9 * * *');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const r = await schedules.listAgentSchedules(agentName); setJobs(r?.data?.managed || []); }
    catch (err) { swallowed('components', err); setJobs([]); }
  }, [agentName]);
  useEffect(() => { setJobs(null); load(); }, [load]);
  const create = async () => {
    if (!title.trim() || !cron.trim() || busy) return;
    setBusy(true);
    try {
      await schedules.createAgentSchedule(agentName, {
        kind: 'agent_task', cron: cron.trim(), task_title: title.trim(),
        task_description: desc.trim(), display_name: title.trim(),
      });
      setTitle(''); setDesc(''); showToast?.(t('inbox.schedCreated'));
      await load();
    } catch (e) { showToast?.(e?.message || t('inbox.schedError'), true); }
    finally { setBusy(false); }
  };
  return html`<${Surface} kind="box" density="compact">
    <${Stack} density="compact">
      <${Stack} direction="horizontal" align="between">
        <${Text} kind="heading" size="small">${t('inbox.schedTitle')}<//>
        <${Action} kind="text" label=${t('inbox.close')} title=${t('inbox.close')} onClick=${onClose}>✗<//>
      <//>
      ${jobs == null ? html`<${Text} tone="muted">${t('inbox.loading')}<//>`
        : jobs.length === 0 ? html`<${Text} tone="muted">${t('inbox.schedNone')}<//>`
        : html`<${Surface} kind="plain" density="flush">${jobs.map(j => html`<${ListRow} key=${j.id} density="compact"
            name=${j.displayName || j.input?.taskTemplate?.title || j.id}
            detail=${j.cron + (j.enabled === false ? ' · ' + t('inbox.schedOff') : '')} />`)}<//>`}
      <${Field} ariaLabel=${t('inbox.schedTaskPh')} placeholder=${t('inbox.schedTaskPh')} value=${title} onInput=${e => setTitle(e.target.value)} />
      <${Field} ariaLabel=${t('inbox.schedTitle')} placeholder="0 9 * * *" value=${cron} onInput=${e => setCron(e.target.value)} />
      <${Field} type="textarea" rows=${3} ariaLabel=${t('inbox.schedDescPh')} placeholder=${t('inbox.schedDescPh')} value=${desc} onInput=${e => setDesc(e.target.value)} />
      <${Stack} direction="horizontal">
        <${Action} disabled=${busy || !title.trim() || !cron.trim()} onClick=${create}>${t('inbox.schedCreate')}<//>
      <//>
    <//>
  <//>`;
}
