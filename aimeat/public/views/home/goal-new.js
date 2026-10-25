/**
 * @file public/views/home/goal-new.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A new agent goal from the home (/v1/home?new-goal=1&say=…): the person's sentence, how the
 *   work is shared, who may take part, when it is done, when it ends and what it may spend. The default
 *   is the one Jouni set on 2026-10-25: one capable agent takes the whole goal as one open work and the
 *   agents hand the next work on to each other; a coordinator and a fixed plan are the other two ways.
 *   The same goal made from the person's own AI is one sentence to it; the prompt for that is on the
 *   page, for an AI without MCP too.
 *
 *   Composed from library components only; it has no sheet of its own.
 * @structure default GoalNewView({ navigate })
 * @usage routed at /v1/home?new-goal=1 by spa.html
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (session cc-jouni-goals).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { useSession } from '/js/use-session.js';
import { apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { PageFrame } from '/components/PageFrame.js';
import { PageIntro } from '/components/PageIntro.js';
import { BackLink } from '/components/BackLink.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Choice } from '/components/Choice.js';
import { Check } from '/components/Check.js';
import { Select } from '/components/Select.js';
import { Loud } from '/components/Action.js';
import { Fields, FormActions } from '/components/Field.js';
import { ErrorNote } from '/components/ErrorNote.js';
import { Note } from '/components/Note.js';
import { PromptCard } from '/components/PromptCard.js';
import { PageSection } from '/components/PageSection.js';
import { HelpTip } from '/components/HelpTip.js';
import { createGoal } from '/js/services/goals.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const g = (key, fallback) => tr('home.goalNew.' + key, fallback);

export default function GoalNewView({ navigate }) {
  const session = useSession();
  const query = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const [statement, setStatement] = useState(query.get('say') || '');
  const [mode, setMode] = useState('single');
  const [coordinator, setCoordinator] = useState('');
  const [who, setWho] = useState('any');
  const [skills, setSkills] = useState('');
  const [names, setNames] = useState([]);
  const [doneWhen, setDoneWhen] = useState('');
  const [days, setDays] = useState('30');
  const [usd, setUsd] = useState('');
  const [agents, setAgents] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!session) return;
    apiGet('/v1/agents').then((r) => setAgents((r?.data?.agents ?? []).map((a) => a.name).sort()))
      .catch((e) => swallowed('new goal: agents', e));
  }, [session]);

  const back = html`<${BackLink} href="/v1/home?agents=1" onClick=${(e) => { e.preventDefault(); navigate('/v1/home?agents=1'); }}>↩ ${g('back', 'Back to your agents')}<//>`;
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
  const prompt = g('prompt', 'Give my agents this goal in AIMEAT with aimeat_goal_set: "{s}". Read my agents first (aimeat_agents_list) and propose who carries it, when it is done, and what it may spend. Ask me before you make it.')
    .replace('{s}', statement.trim() || '…');

  return html`
    <${PageFrame} width="narrow">
      ${back}
      <${PageIntro} title=${html`${g('title', 'A new goal')} <${HelpTip} term="concept.goal" label=${g('title', 'A new goal')} />`}
        sub=${g('sub', 'Say what you want done. Your agents share the work, continue from each other\'s results and bring you what needs you.')} />

      <${Fields}>
      <${TextArea} label=${g('statement', 'What do you want done?')} value=${statement} onInput=${setStatement} rows=${3}
        placeholder=${g('statementPh', 'For example: find out our three biggest competitors and write a comparison by Monday')} />

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
      <//>

      <${PageSection} plain>
        <${PromptCard} label=${g('ownAi', 'Or give it from your own AI')} prompt=${prompt} copyLabel=${g('copyPrompt', 'Copy the prompt')} />
      <//>
    <//>`;
}
