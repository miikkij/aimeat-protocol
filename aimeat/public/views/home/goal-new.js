/**
 * @file public/views/home/goal-new.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A new agent goal from the home (/v1/home?new-goal=1&say=…). The person says one
 *   sentence; their own model here writes the plan (who leads, who does each work, what is missing,
 *   what it may spend, why), the page shows it, and the person starts it with one press. Jouni,
 *   2026-10-25: "nobody fills these in any more; the connected AI makes the decisions and advises the
 *   person, who sees what happens, approves, and may change or add". The plan is written by
 *   services/goal-draft.js; the plan view is goal-plan.js.
 *
 *   THREE WAYS, ONE PAGE. With a model here, the proposal. Without one (no key, no budget), the
 *   sentence is not lost: the page gives it to the person's own AI as a prompt, which proposes the
 *   goal with aimeat_goal_set action "propose", and the proposal waits on the home. And "Make it by
 *   hand" keeps the rules form (goal-new-form.js) for a person who wants to set them.
 *
 *   Composed from library components only; it has no sheet of its own.
 * @structure default GoalNewView({ navigate })
 * @usage routed at /v1/home?new-goal=1 by spa.html (optional say=<sentence>)
 * @version-history
 *   v2.0.0 — 2026-10-25 — The AI's proposal first: sentence → plan → start. The rules form moved to
 *     goal-new-form.js under "Make it by hand" (Jouni, 2026-10-25).
 *   v1.0.0 — 2026-10-25 — Initial (session cc-jouni-goals).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { useSession } from '/js/use-session.js';
import { apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { PageFrame } from '/components/PageFrame.js';
import { PageIntro } from '/components/PageIntro.js';
import { PageSection } from '/components/PageSection.js';
import { BackLink } from '/components/BackLink.js';
import { TextArea } from '/components/TextField.js';
import { Loud } from '/components/Action.js';
import { Fields, FormActions } from '/components/Field.js';
import { ErrorNote } from '/components/ErrorNote.js';
import { Note } from '/components/Note.js';
import { Spinner } from '/components/Spinner.js';
import { FoldButton } from '/components/FoldButton.js';
import { PromptCard } from '/components/PromptCard.js';
import { HelpTip } from '/components/HelpTip.js';
import { createGoal } from '/js/services/goals.js';
import { goalPlanContext, draftGoal, planToGoal, ownAiGoalRequest } from '/js/services/goal-draft.js';
import { PlanView, MissingAgents } from './goal-plan.js';
import { ManualGoalForm } from './goal-new-form.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const g = (key, fallback) => tr('home.goalNew.' + key, fallback);

export default function GoalNewView({ navigate }) {
  const session = useSession();
  const query = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const said = query.get('say') || '';
  const [statement, setStatement] = useState(said);
  // ask: the sentence · drafting: the model plans · plan: the proposal · nomodel: no model answered ·
  // started: the goal runs and the plan lacked agents
  const [phase, setPhase] = useState(said ? 'drafting' : 'ask');
  const [ctx, setCtx] = useState(null);
  const [plan, setPlan] = useState(null);
  const [started, setStarted] = useState(null);
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // What the planner is told: the person's agents and how many computers run agents.
  useEffect(() => {
    if (!session) return;
    Promise.all([
      apiGet('/v1/agents').then((r) => r?.data?.agents ?? []),
      apiGet('/v1/home/agents').then((r) => r?.data?.connectors?.length ?? 0).catch((e) => { swallowed('new goal: computers', e); return 0; }),
    ]).then(([agents, computers]) => setCtx(goalPlanContext(agents, computers)))
      .catch((e) => { swallowed('new goal: agents', e); setCtx(goalPlanContext([], 0)); });
  }, [session]);

  const makePlan = useCallback(async (sentence) => {
    if (!ctx || !sentence.trim()) return;
    setPhase('drafting'); setErr('');
    try {
      setPlan(await draftGoal(sentence.trim(), ctx));
      setPhase('plan');
    } catch (e) {
      swallowed('new goal: plan', e);
      setPhase('nomodel');
    }
  }, [ctx]);

  // Arriving with a sentence from the home: plan it once the agents are known.
  useEffect(() => { if (said && ctx && phase === 'drafting' && !plan) makePlan(said); }, [said, ctx]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setBusy(true); setErr('');
    try {
      const resp = await createGoal(planToGoal(plan, statement.trim()));
      const id = resp.data.goal.id;
      if (plan.missing.length) { setStarted({ id, missing: plan.missing }); setPhase('started'); setBusy(false); return; }
      navigate(`/v1/home?goal=${encodeURIComponent(id)}`);
    } catch (e) { setErr(e?.message || String(e)); setBusy(false); }
  };

  const back = html`<${BackLink} href="/v1/home?agents=1" onClick=${(e) => { e.preventDefault(); navigate('/v1/home?agents=1'); }}>↩ ${g('back', 'Back to your agents')}<//>`;
  const intro = html`<${PageIntro} title=${html`${g('title', 'A new goal')} <${HelpTip} term="concept.goal" label=${g('title', 'A new goal')} />`}
    sub=${g('subAi', 'Say what you want done. Your AI plans who does what and shows it to you before anything starts.')} />`;
  const ownAi = html`<${PromptCard} label=${g('ownAiPropose', 'Or give it to your own AI (Claude, ChatGPT, Codex…)')}
    prompt=${ownAiGoalRequest(statement.trim() || '…')} copyLabel=${g('copyPrompt', 'Copy the prompt')} />`;

  if (phase === 'started') {
    return html`<${PageFrame} width="narrow">${back}${intro}<${MissingAgents} goalId=${started.id} missing=${started.missing} navigate=${navigate} /><//>`;
  }

  return html`
    <${PageFrame} width="narrow">
      ${back}
      ${intro}

      ${(phase === 'ask' || phase === 'nomodel') && html`
        <${Fields}>
          <${TextArea} label=${g('statement', 'What do you want done?')} value=${statement} onInput=${setStatement} rows=${3}
            placeholder=${g('statementPh', 'For example: find out our three biggest competitors and write a comparison by Monday')} />
          ${phase === 'ask' && html`
            <${FormActions}>
              <${Loud} disabled=${!statement.trim() || !ctx} onClick=${() => makePlan(statement)}>${g('planIt', 'Plan it')}<//>
            <//>`}
        <//>`}

      ${phase === 'drafting' && html`
        <${Note}>"${statement}"<//>
        <${Spinner} text=${g('planning', 'Your AI plans who does what…')} />`}

      ${phase === 'nomodel' && html`
        <${PageSection} group ends title=${g('noModelTitle', 'Your AI plans it')}>
          <${Note}>${g('noModelNote', 'There is no model here to plan it with. Give the sentence to your own AI: it reads your agents, plans the goal and proposes it, and the proposal waits on your home for your yes.')}<//>
          ${ownAi}
          <${FormActions}><${Loud} disabled=${!statement.trim()} onClick=${() => makePlan(statement)}>${g('tryAgain', 'Try the model here again')}<//><//>
        <//>`}

      ${phase === 'plan' && plan && html`
        <${Note} kind="quiet">"${statement}"<//>
        <${PlanView} plan=${plan} onPlan=${setPlan} onStart=${start} busy=${busy}
          onRedo=${() => { setPlan(null); setPhase('ask'); }} />
        ${err && html`<${ErrorNote} text=${err} />`}`}

      ${phase !== 'nomodel' && html`<${PageSection} plain>${ownAi}<//>`}

      <${PageSection} plain ends>
        <${FoldButton} expanded=${manual} onClick=${() => setManual(!manual)}>${g('byHand', 'Make it by hand: set the rules yourself')}<//>
        ${manual && html`<${ManualGoalForm} statement=${statement} agents=${(ctx?.agents ?? []).map((a) => a.name).concat(ctx?.ownAi ?? []).sort()} navigate=${navigate} />`}
      <//>
    <//>`;
}
