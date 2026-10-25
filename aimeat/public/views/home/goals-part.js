/**
 * @file public/views/home/goals-part.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The goals in the home's agents band: one field that says what the person wants done, the
 *   running goals with how far each is and who works on it now, and what waits for the person across
 *   them (a person's step, or open work no agent took). It reads its own data (GET /v1/goals and
 *   /v1/goals/waiting) and reads it again on the live stream (domain `goals`), so the band's other
 *   rows and their reader stay as they were.
 *
 *   TWO FIELDS, TWO THINGS (Jouni's choice 4 of 2026-10-25): "What should the agent do?" makes an
 *   agent; "What do you want done?" here gives the agents a goal. A row with nothing to say is not
 *   drawn, as everywhere on the home.
 *   Composed from library components only; it has no sheet of its own.
 * @structure GoalsPart({ navigate })
 * @usage html`<${GoalsPart} navigate=${navigate} />`   // views/home/agents-band.js
 * @version-history
 *   v1.0.1 — 2026-10-25 — The live-update handler reads the domains with .has: they are a Set, and
 *     .includes threw, so the goals never refreshed on their own.
 *   v1.0.0 — 2026-10-25 — Initial (session cc-jouni-goals).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';
import { NamedRow } from '/components/NamedRow.js';
import { LineList } from '/components/LineList.js';
import { TextField } from '/components/TextField.js';
import { Loud } from '/components/Action.js';
import { HelpTip } from '/components/HelpTip.js';
import { listGoals, waitingGoals } from '/js/services/goals.js';
import { StepCard, NobodyCard, ProposalCard } from './goal-steps.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const g = (key, fallback) => tr('home.goals.' + key, fallback);

/** One running goal as a line: its title, how far, who works on it now. */
function goalLine(goal) {
  const p = goal.progress;
  const parts = [g('progress', '{done} of {total} done').replace('{done}', String(p.done)).replace('{total}', String(p.total))];
  if (goal.working_now.length) parts.push(g('now', 'now: {who}').replace('{who}', [...new Set(goal.working_now.map((w) => w.agent))].join(', ')));
  if (p.waiting_for_you) parts.push(g('waitsYou', '{n} waits for you').replace('{n}', String(p.waiting_for_you)));
  if (goal.status === 'paused') parts.push(g('paused', 'paused'));
  if (goal.rounds) parts.push(g('round', 'round {n}').replace('{n}', String(goal.rounds.count)));
  return { id: goal.id, name: goal.title, text: parts.join(' · '), href: `/v1/home?goal=${encodeURIComponent(goal.id)}` };
}

export function GoalsPart({ navigate }) {
  const [say, setSay] = useState('');
  const [goals, setGoals] = useState(null);
  const [waiting, setWaiting] = useState([]);

  const load = useCallback(async () => {
    try {
      const [list, wait] = await Promise.all([listGoals('running'), waitingGoals()]);
      setGoals(list?.data?.goals ?? []);
      setWaiting(wait?.data?.waiting ?? []);
    } catch (err) { swallowed('home: goals', err); setGoals([]); }
  }, []);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => { loadRef.current(); }, []);
  useEffect(() => {
    const handler = (e) => {
      const domains = e?.detail?.domains;
      // A Set from lib/live-updates.js, so .has: .includes threw on every live update.
      if (!domains || domains.has('goals') || domains.has('agent-tasks')) loadRef.current();
    };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  const give = () => {
    const sentence = say.trim();
    navigate?.('/v1/home?new-goal=1' + (sentence ? '&say=' + encodeURIComponent(sentence) : ''));
  };
  const label = g('label', 'Goals');

  return html`
    <${NamedRow} stack label=${html`${label} <${HelpTip} term="concept.goal" label=${label} />`}>
      <${TextField}
        label=${g('askLabel', 'What do you want done?')}
        placeholder=${g('askPlaceholder', 'For example: find out our three biggest competitors and write a comparison by Monday')}
        value=${say} onInput=${setSay} onEnter=${give}
        actions=${html`<${Loud} control onClick=${give}>${g('give', 'Give the goal')}<//>`} />
      ${goals && goals.length > 0 && html`<${LineList} rows=${goals.map(goalLine)} />`}
    <//>
    ${waiting.length > 0 && html`
      <${NamedRow} stack label=${g('waitingLabel', 'Your goals wait for you')}>
        ${waiting.slice(0, 5).map((item) => item.kind === 'proposal'
          ? html`<${ProposalCard} key=${item.goal_id} item=${item} navigate=${navigate} />`
          : item.kind === 'step'
            ? html`<${StepCard} key=${item.goal_id + item.work.id} item=${item} showGoal onDone=${load} />`
            : html`<${NobodyCard} key=${item.goal_id + item.work.id} item=${item} navigate=${navigate} />`)}
      <//>`}`;
}

export default GoalsPart;
