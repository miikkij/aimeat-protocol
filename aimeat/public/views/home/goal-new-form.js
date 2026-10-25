/**
 * @file public/views/home/goal-new-form.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The new goal made by hand: how the work is shared, who may take part, when it is done,
 *   when it ends and what it may spend. Moved out of goal-new.js unchanged when that page became the
 *   AI's proposal (Jouni, 2026-10-25: the AI decides and advises, the person approves); it stays
 *   under "Make it by hand" for a person who wants to set the rules themselves.
 *
 *   Composed from library components only; it has no sheet of its own.
 * @structure ManualGoalForm({ statement, agents, navigate })
 * @usage html`<${ManualGoalForm} statement=${sentence} agents=${names} navigate=${navigate} />`
 * @version-history
 *   v1.0.0 — 2026-10-25 — Moved out of goal-new.js (session cc-jouni-goals).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { TextField } from '/components/TextField.js';
import { Choice } from '/components/Choice.js';
import { Check } from '/components/Check.js';
import { Select } from '/components/Select.js';
import { Loud } from '/components/Action.js';
import { Fields, FormActions } from '/components/Field.js';
import { ErrorNote } from '/components/ErrorNote.js';
import { Note } from '/components/Note.js';
import { createGoal } from '/js/services/goals.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const g = (key, fallback) => tr('home.goalNew.' + key, fallback);

/** @param {{ statement: string, agents: string[], navigate: (to: string) => void }} props */
export function ManualGoalForm({ statement, agents, navigate }) {
  const [mode, setMode] = useState('single');
  const [coordinator, setCoordinator] = useState('');
  const [who, setWho] = useState('any');
  const [skills, setSkills] = useState('');
  const [names, setNames] = useState([]);
  const [doneWhen, setDoneWhen] = useState('');
  const [days, setDays] = useState('30');
  const [usd, setUsd] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const skillList = skills.split(',').map((s) => s.trim()).filter(Boolean);

  const give = async () => {
    setBusy(true); setErr('');
    try {
      const body = {
        statement: statement.trim(),
        mode,
        ...(mode === 'coordinator' && coordinator ? { coordinator } : {}),
        ...(who === 'skills' ? { skills: skillList, any_agent: false } : who === 'named' ? { agents: names, any_agent: false } : { any_agent: true }),
        ...(who === 'skills' && mode === 'single' ? { works: [{ title: statement.trim().split(/[.!?\n]/)[0].slice(0, 200), description: statement.trim(), wants: skillList }] } : {}),
        ...(doneWhen.trim() ? { done_when: doneWhen.trim() } : {}),
        ends_at: new Date(Date.now() + Number(days) * 86_400_000).toISOString(),
        ...(usd.trim() && Number(usd) >= 0 ? { limits: { usd: Number(usd) } } : {}),
      };
      const resp = await createGoal(body);
      navigate(`/v1/home?goal=${encodeURIComponent(resp.data.goal.id)}`);
    } catch (e) { setErr(e?.message || String(e)); setBusy(false); }
  };

  const ready = statement.trim().length > 0 && (mode !== 'coordinator' || coordinator) && (who !== 'skills' || skillList.length > 0) && (who !== 'named' || names.length > 0);

  return html`
    <${Fields}>
      <${Choice} label=${g('modeLabel', 'How the work is shared')} value=${mode} onChange=${setMode} boxed cols=${3} dot name="goal-mode" options=${[
        { value: 'single', label: g('modeSingle', 'One agent takes the whole goal'), hint: g('modeSingleHint', 'Best for a capable agent. It may hand the next work to another agent.') },
        { value: 'coordinator', label: g('modeCoordinator', 'A coordinator leads'), hint: g('modeCoordinatorHint', 'An agent plans, hands out work, makes subgoals and asks you.') },
        { value: 'plan', label: g('modePlan', 'A fixed plan'), hint: g('modePlanHint', 'For narrow tool agents: your own AI writes the steps.') },
      ]} />
      ${mode === 'coordinator' && html`
        <${Select} label=${g('coordinator', 'Coordinator')} value=${coordinator} onChange=${setCoordinator} help="concept.coordinator"
          options=${[['', g('pick', 'Pick an agent')], ...agents.map((a) => [a, a])]} />`}
      ${mode === 'plan' && html`<${Note} kind="quiet">${g('planNote', 'Give the goal here, then ask your own AI to write its steps (the prompt below).')}<//>`}

      <${Choice} label=${g('whoLabel', 'Who may take part')} value=${who} onChange=${setWho} options=${[
        ['any', g('whoAny', 'Any of my agents')], ['skills', g('whoSkills', 'Agents that know…')], ['named', g('whoNamed', 'These agents')],
      ]} />
      ${who === 'skills' && html`<${TextField} label=${g('skills', 'Skills, separated by commas')} value=${skills} onInput=${setSkills}
        placeholder=${g('skillsPh', 'research, writing')} help="concept.open_work" />`}
      ${who === 'named' && agents.map((a) => html`
        <${Check} key=${a} ruled checked=${names.includes(a)} onChange=${(on) => setNames((cur) => on ? [...cur, a] : cur.filter((x) => x !== a))}>${a}<//>`)}

      <${TextField} label=${g('doneWhen', 'Done when (optional)')} value=${doneWhen} onInput=${setDoneWhen}
        placeholder=${g('doneWhenPh', 'For example: I approve the comparison')} />
      <${Choice} label=${g('ends', 'Ends in')} value=${days} onChange=${setDays} options=${[['7', g('d7', '7 days')], ['30', g('d30', '30 days')], ['90', g('d90', '90 days')]]} />
      <${TextField} label=${g('usd', 'Spending limit in dollars (optional)')} value=${usd} onInput=${setUsd} inputMode="decimal"
        placeholder=${g('usdPh', 'For example: 5')} help="concept.spending" />

      ${err && html`<${ErrorNote} text=${err} />`}
      <${FormActions}>
        <${Loud} disabled=${busy || !ready} onClick=${give}>${g('give', 'Give the goal')}<//>
      <//>
    <//>`;
}
