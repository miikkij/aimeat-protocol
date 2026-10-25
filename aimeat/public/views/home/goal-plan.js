/**
 * @file public/views/home/goal-plan.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AI's proposal for a goal, shown before anything exists: what the goal is, who
 *   leads it, each work and who does it (an agent, open work for a skill, AIMEAT's model with the
 *   person's key, or the person), what is missing and why, and what it may spend. The person starts
 *   it with one press; "Change before starting" lets them rename it, change the limit and the days,
 *   and leave a work out. After the start, MissingAgents offers to make each agent the plan lacks:
 *   the new-agent page gives it the skill tag its open work asks for and returns to the goal.
 *
 *   Composed from library components only; it has no sheet of its own.
 * @structure PlanView({ plan, onPlan, onStart, onRedo, busy }) · MissingAgents({ goalId, missing, navigate }) · doerWords(doer)
 * @usage html`<${PlanView} plan=${plan} onPlan=${setPlan} onStart=${start} onRedo=${redo} busy=${busy} />`
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (session cc-jouni-goals; Jouni, 2026-10-25: the AI decides and
 *     advises, the person sees what happens and approves).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { money } from '/js/format.js';
import { Facts } from '/components/Facts.js';
import { PageSection } from '/components/PageSection.js';
import { PlanSteps, PlanStep, PlanNote } from '/components/PlanSteps.js';
import { Card } from '/components/Card.js';
import { Note } from '/components/Note.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { FoldButton } from '/components/FoldButton.js';
import { TextField } from '/components/TextField.js';
import { Check } from '/components/Check.js';
import { Fields } from '/components/Field.js';
import { HelpTip } from '/components/HelpTip.js';
import { kindWord } from './goal-steps.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const g = (key, fallback) => tr('home.goalPlan.' + key, fallback);

/** Who does a work, in the person's words. */
export function doerWords(doer) {
  if (doer.kind === 'agent') return g('byAgent', 'Your agent {agent}').replace('{agent}', doer.agent);
  if (doer.kind === 'skill') return g('bySkill', 'Open work: an agent that knows {skill} takes it').replace('{skill}', doer.tag);
  if (doer.kind === 'person') return `${g('byYou', 'You')}: ${kindWord(doer.step)}`;
  return g('byModel', 'AIMEAT\'s model, with your own key');
}

/** @param {{ plan: any, onPlan: (p: any) => void, onStart: () => void, onRedo: () => void, busy: boolean }} props */
export function PlanView({ plan, onPlan, onStart, onRedo, busy }) {
  const [editing, setEditing] = useState(false);
  const models = plan.works.filter((w) => w.doer.kind === 'model').length;
  const set = (patch) => onPlan({ ...plan, ...patch });
  const leaveOut = (i, on) => set({ works: plan.works.map((w, j) => (j === i ? { ...w, left: !on } : w)) });
  const kept = plan.works.filter((w) => !w.left);

  return html`
    <${PageSection} group title=${g('title', 'This is how it would go')}>
      ${plan.why && html`<${Note}>${plan.why}<//>`}
      <${Facts} wide rows=${[
        { k: g('goal', 'Goal'), v: plan.title },
        plan.doneWhen && { k: g('doneWhen', 'Done when'), v: plan.doneWhen },
        { k: html`${g('lead', 'Who leads it')} <${HelpTip} term="concept.coordinator" label=${g('lead', 'Who leads it')} />`,
          v: plan.coordinator ? g('leadAgent', 'Your agent {agent} coordinates it').replace('{agent}', plan.coordinator) : g('leadRules', 'AIMEAT keeps it moving: each work starts when the one before it is done') },
        { k: html`${g('limit', 'It may spend')} <${HelpTip} term="concept.spending" label=${g('limit', 'It may spend')} />`,
          v: money(plan.limitUsd), sub: models ? g('limitSub', '{n} of the works use AIMEAT\'s model with your key; the limit stops it').replace('{n}', String(models)) : g('limitNone', 'No work here uses AIMEAT\'s model') },
        { k: g('days', 'It runs for'), v: g('daysV', '{n} days').replace('{n}', String(plan.days)) },
      ].filter(Boolean)} />
    <//>

    <${PageSection} group title=${g('works', 'The work')}>
      <${PlanSteps}>
        ${plan.works.map((w, i) => html`
          <${PlanStep} key=${i} state=${w.left ? 'skipped' : undefined} title=${`${i + 1}. ${w.title}`}
            after=${html`<${Note} kind="quiet" size="small">${doerWords(w.doer)}<//>`}>
            ${w.description && html`<${PlanNote}>${w.description}<//>`}
            ${w.options?.length > 0 && html`<${PlanNote}>${g('options', 'Choices: {list}').replace('{list}', w.options.join(' · '))}<//>`}
            ${w.after?.length > 0 && html`<${PlanNote}>${g('after', 'Starts after work {list}').replace('{list}', w.after.join(', '))}<//>`}
            ${editing && html`<${Check} checked=${!w.left} onChange=${(on) => leaveOut(i, on)}>${g('keep', 'Keep this work')}<//>`}
          <//>`)}
      <//>
    <//>

    ${plan.missing.length > 0 && html`
      <${PageSection} group title=${g('missing', 'What it still lacks')}>
        <${Note} kind="quiet">${g('missingNote', 'The goal starts with what you have. These works wait as open work until you make the agent that takes them; you can do it right after starting.')}<//>
        ${plan.missing.map((m, i) => html`<${Card} key=${i} tone="framed" kicker=${g('missingKicker', 'A new agent')} name=${m.sentence}>${m.why && html`<${Note} kind="quiet">${m.why}<//>`}<//>`)}
      <//>`}

    <${PageSection} group ends title=${g('decide', 'Start it')}>
      ${editing && html`
        <${Fields}>
          <${TextField} label=${g('goal', 'Goal')} value=${plan.title} onInput=${(v) => set({ title: v })} />
          <${TextField} label=${g('doneWhen', 'Done when')} value=${plan.doneWhen} onInput=${(v) => set({ doneWhen: v })} />
          <${TextField} label=${g('limitEdit', 'It may spend, in dollars')} value=${String(plan.limitUsd)} inputMode="decimal"
            onInput=${(v) => set({ limitUsd: Math.max(0, Number(v) || 0) })} help="concept.spending" />
          <${TextField} label=${g('daysEdit', 'It runs for, in days')} value=${String(plan.days)} inputMode="numeric"
            onInput=${(v) => set({ days: Math.min(Math.max(Number(v) || 1, 1), 365) })} />
        <//>`}
      <${Actions}>
        <${Loud} control disabled=${busy || kept.length === 0} onClick=${onStart}>${g('start', 'Start the goal')}<//>
        <${FoldButton} expanded=${editing} onClick=${() => setEditing(!editing)}>${g('change', 'Change before starting')}<//>
        <${Action} control onClick=${onRedo}>${g('redo', 'Say it differently')}<//>
      <//>
    <//>`;
}

/** After the start: one press per missing agent, which comes back to the goal when it is made. */
export function MissingAgents({ goalId, missing, navigate }) {
  const open = (m) => navigate(`/v1/home?new-agent=1&say=${encodeURIComponent(m.sentence)}&tag=${encodeURIComponent(m.tag)}&goal=${encodeURIComponent(goalId)}`);
  return html`
    <${PageSection} group ends title=${g('startedTitle', 'The goal is running')}>
      <${Note}>${g('startedNote', 'It started with what you have. Make these agents, and each takes the work that waits for it:')}<//>
      ${missing.map((m, i) => html`
        <${Card} key=${i} tone="framed" kicker=${g('missingKicker', 'A new agent')} name=${m.sentence}>
          ${m.why && html`<${Note} kind="quiet">${m.why}<//>`}
          <${Actions}><${Loud} control onClick=${() => open(m)}>${g('makeAgent', 'Make this agent')}<//><//>
        <//>`)}
      <${Actions}><${Action} control onClick=${() => navigate(`/v1/home?goal=${encodeURIComponent(goalId)}`)}>${g('openGoal', 'Open the goal →')}<//><//>
    <//>`;
}
