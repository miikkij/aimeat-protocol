/**
 * @file public/views/home/goal.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One agent goal, as the home shows it (/v1/home?goal=<id>): what the person wanted, where
 *   it stands, what waits for them, what came out, and below that, quietly, how it got there.
 *
 *   RESULT FIRST, TRACES IF YOU WANT THEM (Jouni, 2026-10-25: "drill-in mennä syvemmälle jos haluaa,
 *   mut ei pakko"). The order is: the steps that wait for the person; what was produced; the works
 *   with their state, each with a quiet "What it did" that folds open the result and the way to the
 *   whole trace (the task's own page, /v1/home?agent=…&work=…); then subgoals, material, what happened
 *   and the changes, the last folded. The words a person may not know carry a question mark that
 *   explains them (components/HelpTip.js, explain.concept.*).
 *
 *   Everything here is also done from the person's own AI (aimeat_goal_*), and both places move
 *   together through the live stream (domain `goals`). Composed from library components only; it has
 *   no sheet of its own.
 * @structure default GoalView({ navigate })
 * @usage routed at /v1/home?goal=<id> by spa.html
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (session cc-jouni-goals).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { useSession } from '/js/use-session.js';
import { getSession } from '/js/services/auth.js';
import { relayLiveUpdates } from '/lib/live-updates.js';
import { ago, money, date, dateTime } from '/js/format.js';
import { PageFrame } from '/components/PageFrame.js';
import { PageIntro } from '/components/PageIntro.js';
import { BackLink } from '/components/BackLink.js';
import { Spinner } from '/components/Spinner.js';
import { ErrorNote } from '/components/ErrorNote.js';
import { Note } from '/components/Note.js';
import { Facts } from '/components/Facts.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { PageSection } from '/components/PageSection.js';
import { Markdown } from '/components/Markdown.js';
import { PlanSteps, PlanStep, PlanNote } from '/components/PlanSteps.js';
import { TimelineList, TimelineRow } from '/components/Timeline.js';
import { LineList } from '/components/LineList.js';
import { Mark } from '/components/Mark.js';
import { FoldButton } from '/components/FoldButton.js';
import { HelpTip } from '/components/HelpTip.js';
import { PromptCard } from '/components/PromptCard.js';
import { FormActions } from '/components/Field.js';
import { getGoal, goalAction, deleteGoal } from '/js/services/goals.js';
import { StepCard, NobodyCard, goalPrompt } from './goal-steps.js';
import { keepLineBreaks } from './line-breaks.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const g = (key, fallback) => tr('home.goal.' + key, fallback);
const titled = (title, term) => html`${title} <${HelpTip} term=${term} label=${title} />`;

/** A goal's status in words and the tone of its fact. */
export function goalStatusWords(status) {
  return ({
    proposed: { word: g('statusProposed', 'Proposed, waits for your yes'), tone: 'attention' },
    active: { word: g('statusActive', 'Running'), tone: 'fine' },
    paused: { word: g('statusPaused', 'Paused'), tone: 'attention' },
    done: { word: g('statusDone', 'Done'), tone: 'fine' },
    stopped: { word: g('statusStopped', 'Stopped'), tone: 'off' },
    expired: { word: g('statusExpired', 'Ended'), tone: 'off' },
  })[status] ?? { word: status, tone: 'off' };
}

/** Who took a work, as a person reads it: an agent's name, or AIMEAT's model. */
const takerName = (name) => (name === 'model' ? g('modelName', 'AIMEAT\'s model') : name ?? '');

/** A work's state as one phrase. */
function workState(w) {
  if (w.status === 'claimed') return g('wClaimed', '{agent} is doing it').replace('{agent}', takerName(w.claimed_by));
  if (w.status === 'done') return w.kind === 'human' ? g('wAnswered', 'answered') : g('wDone', 'done by {agent}').replace('{agent}', takerName(w.claimed_by ?? w.result?.by));
  if (w.status === 'open') return w.kind === 'human' ? g('wYours', 'waits for you') : w.nobody_took ? g('wNobody', 'nobody took it yet') : g('wOpen', 'not taken yet');
  if (w.status === 'waiting') return g('wWaiting', 'starts when the works before it are done');
  if (w.status === 'failed') return g('wFailed', 'could not be done');
  if (w.status === 'declined') return g('wDeclined', 'asked again');
  return g('wCancelled', 'not needed any more');
}

/** Who does a work, as the line under its title says it. */
function workWho(w) {
  if (w.kind === 'human') return g('whoYou', 'You');
  if (w.runner === 'model') return w.model ? g('whoModelNamed', 'AIMEAT\'s model ({model}), with your key').replace('{model}', w.model) : g('whoModel', 'AIMEAT\'s model, with your key');
  if (w.agent) return w.agent;
  if (w.wants?.length) return g('whoOpen', 'Open work for an agent that knows {skills}').replace('{skills}', w.wants.join(', '));
  return g('whoAny', 'Open work for any of your agents');
}

/** One work in the plan, with its quiet fold of what it did. */
function WorkStep({ w, open, onToggle }) {
  const state = w.status === 'done' ? 'done' : (w.status === 'cancelled' || w.status === 'declined') ? 'skipped' : undefined;
  const trace = w.task_id && w.claimed_by ? `/v1/home?agent=${encodeURIComponent(w.claimed_by)}&work=${encodeURIComponent(w.task_id)}` : null;
  const has = !!(w.result?.summary || trace || w.reason);
  return html`
    <${PlanStep} state=${state}
      before=${w.status === 'claimed' ? html`<${Mark} live>${g('now', 'now')}<//>` : null}
      title=${w.title}
      after=${html`<${Note} kind="quiet" size="small">${workWho(w)}<//>`}
      doors=${has ? html`<${FoldButton} expanded=${open} onClick=${onToggle}>${w.status === 'claimed' ? g('whatNow', 'What it is doing') : g('whatDid', 'What it did')}<//>` : null}>
      <${PlanNote}>${workState(w)}${w.hop > 0 ? ' · ' + g('hop', 'link {n} of the chain').replace('{n}', String(w.hop)) : ''}${w.round ? ' · ' + g('round', 'round {n}').replace('{n}', String(w.round)) : ''}<//>
      ${open && html`
        ${w.reason && html`<${Note} kind="quiet">${g('why', 'Why')}: ${w.reason}<//>`}
        ${w.result?.summary && html`<${Markdown} text=${keepLineBreaks(w.result.summary)} small />`}
        ${w.result?.answer && w.kind === 'human' && html`<${Note} kind="quiet">${JSON.stringify(w.result.answer)}<//>`}
        <${Note} kind="quiet" size="small">
          ${[w.claimed_at && g('took', 'took it {when}').replace('{when}', ago(w.claimed_at)),
             w.settled_at && g('ended', 'ended {when}').replace('{when}', ago(w.settled_at)),
             w.cost_usd > 0 && money(w.cost_usd)].filter(Boolean).join(' · ')}
        <//>
        ${trace && html`<${Action} tone="more" href=${trace}>${g('wholeTrace', 'The whole trace →')}<//>`}`}
    <//>`;
}

export default function GoalView({ navigate }) {
  const session = useSession();
  const id = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').get('goal') || '';
  const [goal, setGoal] = useState(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [opened, setOpened] = useState({});
  const [showChanges, setShowChanges] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    try {
      const resp = await getGoal(id);
      setGoal(resp?.data?.goal ?? null);
      setLoadError('');
    } catch (err) {
      if (err?.status === 404 || err?.status === 403) setMissing(true);
      else setLoadError(err?.message || String(err));
    }
  }, [id]);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => { if (session && id) loadRef.current(); }, [session, id]);
  // The live stream: an agent taking work, finishing it, or the person's own AI changing the goal
  // moves this page without a reload. A route of its own, so it opens the stream itself.
  useEffect(() => (session ? relayLiveUpdates(() => getSession()?.jwt) : undefined), [session]);
  useEffect(() => {
    const handler = () => { if (session && id) loadRef.current(); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [session, id]);

  const AGENTS = '/v1/home?agents=1';
  const goBack = useCallback((e) => { e?.preventDefault?.(); navigate(AGENTS); }, [navigate]);
  const back = html`<${BackLink} href=${AGENTS} onClick=${goBack}>↩ ${g('back', 'Back to your agents')}<//>`;

  const act = async (action) => {
    setBusy(true); setActionError('');
    try {
      if (action === 'delete') { await deleteGoal(id); navigate(AGENTS); return; }
      if (action === 'decline') { await goalAction(id, action); navigate(AGENTS); return; }
      await goalAction(id, action);
      await load();
    } catch (err) { setActionError(err?.message || String(err)); }
    finally { setBusy(false); }
  };

  if (!session) {
    return html`
      <${PageFrame} width="narrow">
        <${PageIntro} title=${g('signInTitle', 'Your goal')} sub=${tr('home.signInDesc', 'Sign in to see where you left off.')} />
        <${FormActions}><${Loud} onClick=${() => navigate('/v1/portal')}>${tr('home.signIn', 'Sign in')}<//><//>
      <//>`;
  }
  if (missing) return html`<${PageFrame} width="narrow">${back}<${PageIntro} title=${g('missingTitle', 'No such goal')} sub=${g('missingSub', 'You have no goal by that id.')} /><//>`;
  if (loadError && !goal) return html`<${PageFrame} width="narrow">${back}<${ErrorNote} text=${loadError} /><//>`;
  if (!goal) return html`<${PageFrame} width="narrow" loading=${true}><${Spinner} /><//>`;

  const st = goalStatusWords(goal.status);
  const p = goal.progress;
  const settled = ['done', 'stopped', 'expired'].includes(goal.status);
  const waiting = goal.works.filter((w) => w.kind === 'human' && w.status === 'open');
  const nobody = goal.works.filter((w) => w.kind === 'agent' && w.status === 'open' && w.nobody_took);
  const results = goal.works.filter((w) => w.kind === 'agent' && w.status === 'done' && w.result?.summary).slice(-5).reverse();
  const round = goal.rounds?.count ?? 0;
  const shown = goal.rounds ? goal.works.filter((w) => (w.round ?? 0) === round || w.status === 'open' || w.status === 'claimed') : goal.works;
  const logNewest = [...goal.log].reverse();

  return html`
    <${PageFrame} width="narrow">
      ${back}
      <${PageIntro} title=${goal.title} sub=${goal.statement !== goal.title ? `"${goal.statement}"` : undefined} />

      <${Facts} wide rows=${[
        { k: g('state', 'State'), state: st.tone, v: st.word,
          sub: g('progress', '{done} of {total} done, {running} running').replace('{done}', String(p.done)).replace('{total}', String(p.total)).replace('{running}', String(p.running)) },
        { k: titled(g('carrier', 'Who carries it'), 'concept.coordinator'),
          v: goal.mode === 'coordinator' && goal.coordinator ? g('coordinatorIs', 'Coordinator: {agent}').replace('{agent}', goal.coordinator)
            : goal.mode === 'plan' ? g('carrierPlan', 'A fixed plan') : g('carrierSingle', 'One agent takes the whole goal; agents hand on the next work') },
        goal.done_when?.text && { k: g('doneWhen', 'Done when'), v: goal.done_when.text },
        { k: titled(g('spent', 'Spent'), 'concept.spending'),
          v: goal.limits.usd !== null ? `${money(goal.spent.usd)} / ${money(goal.limits.usd)}` : money(goal.spent.usd),
          sub: g('spentSub', 'Model calls through AIMEAT; an outside agent\'s own model is not counted') },
        goal.rounds && { k: titled(g('rounds', 'Rounds'), 'concept.round'),
          v: (round > 0 ? g('roundsV', 'Round {n}').replace('{n}', String(round)) : g('roundsNone', 'No round yet')) + (goal.rounds.next_at ? ' · ' + g('next', 'next {when}').replace('{when}', dateTime(goal.rounds.next_at)) : '') },
        { k: g('ends', 'Ends'), v: goal.ends_at ? date(goal.ends_at) : goal.renew_by ? g('renewBy', 'Runs until {d}; renew it before then').replace('{d}', date(goal.renew_by)) : g('noEnd', 'No end date') },
      ].filter(Boolean)} />

      ${goal.status === 'paused' && html`
        <${Note} kind="aside">${g('pausedNote', 'Paused. Agents saved where they were; nothing new starts until you resume.')}
          ${' '}<${Action} tone="inline" disabled=${busy} onClick=${() => act('resume')}>${g('resume', 'Resume')}<//><//>`}

      ${goal.status === 'proposed' && html`
        <${PageSection} group ends title=${g('proposalTitle', 'A proposal waits for your yes')}>
          <${Note}>${g('proposalNote', 'Your AI proposed this goal. Read the work below; nothing starts and nobody is asked anything until you approve it.')}<//>
          <${Actions}>
            <${Loud} control disabled=${busy} onClick=${() => act('approve')}>${g('approveStart', 'Approve and start')}<//>
            <${Action} control tone="danger" disabled=${busy} onClick=${() => act('decline')}>${g('decline', 'Decline')}<//>
          <//>
        <//>`}

      ${goal.status !== 'proposed' && (waiting.length > 0 || nobody.length > 0) && html`
        <${PageSection} group ends title=${titled(g('waitingTitle', 'Waiting for you'), 'concept.waiting_for_you')}>
          ${waiting.map((w) => html`<${StepCard} key=${w.id} item=${{ goal_id: goal.id, goal: goal.title, work: w }} onDone=${load} />`)}
          ${nobody.map((w) => html`<${NobodyCard} key=${w.id} item=${{ goal_id: goal.id, goal: goal.title, work: w }} navigate=${navigate} />`)}
        <//>`}

      ${results.length > 0 && html`
        <${PageSection} group ends title=${g('gotTitle', 'What came out')}>
          ${results.map((w) => html`
            <div key=${w.id}>
              <${Note} kind="message"><b>${w.title}</b> · ${w.claimed_by ?? w.result?.by ?? ''}<//>
              <${Markdown} text=${keepLineBreaks(w.result.summary.slice(0, 1500))} small />
            </div>`)}
        <//>`}

      <${PageSection} group ends title=${titled(g('planTitle', 'The work'), 'concept.open_work')}>
        ${shown.length === 0 && html`<${Note} kind="quiet">${g('noWork', 'No work yet. The coordinator or your own AI adds it.')}<//>`}
        <${PlanSteps}>
          ${shown.map((w) => html`<${WorkStep} key=${w.id} goal=${goal} w=${w} open=${!!opened[w.id]}
            onToggle=${() => setOpened((o) => ({ ...o, [w.id]: !o[w.id] }))} />`)}
        <//>
      <//>

      ${goal.subgoals.length > 0 && html`
        <${PageSection} group ends title=${titled(g('subTitle', 'Subgoals'), 'concept.subgoal')}>
          <${LineList} rows=${goal.subgoals.map((sid) => ({ id: sid, name: sid, href: `/v1/home?goal=${encodeURIComponent(sid)}` }))} />
        <//>`}

      ${goal.material.length > 0 && html`
        <${PageSection} group ends title=${titled(g('materialTitle', 'Material'), 'concept.material')}>
          <${LineList} rows=${[...goal.material].reverse().map((m) => ({ id: m.id, name: m.title, text: `${m.kind} · ${m.by === 'owner' ? g('you', 'you') : String(m.by).split('#')[0]} · ${ago(m.at)}` }))} />
        <//>`}

      <${PageSection} group ends title=${g('logTitle', 'Now and just before')}>
        <${TimelineList}>
          ${logNewest.slice(0, showLog ? 200 : 8).map((e, i) => html`
            <${TimelineRow} key=${e.at + i} category=${e.kind === 'failed' || e.kind === 'limit' ? 'trouble' : e.kind === 'done' || e.kind === 'finished' ? 'made' : e.who === 'node' ? 'system' : 'agent'}
              live=${i === 0 && goal.works.some((w) => w.status === 'claimed')}
              text=${e.why ? `${e.what} (${e.why})` : e.what} when=${ago(e.at)} />`)}
        <//>
        ${logNewest.length > 8 && html`<${FoldButton} expanded=${showLog} onClick=${() => setShowLog(!showLog)}>${showLog ? g('less', 'Show less') : g('allLog', 'Everything that happened')}<//>`}
      <//>

      <${PageSection} group ends title=${g('changesTitle', 'Changes')}>
        ${goal.changes.length < 2
          ? html`<${Note} kind="quiet">${g('changesNone', 'No changes since it was made.')}<//>`
          : html`<${FoldButton} expanded=${showChanges} onClick=${() => setShowChanges(!showChanges)}>
              ${g('changesN', '{n} versions').replace('{n}', String(goal.changes.length))}
            <//>`}
        ${showChanges && goal.changes.length > 1 && html`<${LineList} rows=${[...goal.changes].reverse().map((c) => ({
          id: String(c.v), name: `v${c.v} · ${c.who === 'owner' ? g('you', 'you') : String(c.who).split('#')[0]}`, text: `${c.what} · ${ago(c.at)}` }))} />`}
      <//>

      ${goal.status === 'proposed' && actionError && html`<${ErrorNote} text=${actionError} />`}
      ${goal.status !== 'proposed' && html`
      <${PageSection} group ends title=${g('controlTitle', 'Steer the goal')}>
      <${PromptCard} label=${g('ownAi', 'Steer it from your own AI')} prompt=${goalPrompt(goal)} copyLabel=${g('copyPrompt', 'Copy the prompt')} />
      ${actionError && html`<${ErrorNote} text=${actionError} />`}
      <${Actions}>
        ${goal.status === 'active' && html`<${Action} control disabled=${busy} onClick=${() => act('pause')}>${g('pause', 'Pause')}<//>`}
        ${goal.status === 'paused' && html`<${Loud} control disabled=${busy} onClick=${() => act('resume')}>${g('resume', 'Resume')}<//>`}
        ${goal.rounds && !settled && html`<${Action} control disabled=${busy} onClick=${() => act('start_round')}>${g('startRound', 'Start a round now')}<//>`}
        ${!settled && html`<${Action} control disabled=${busy} onClick=${() => act('done')}>${g('markDone', 'Mark done')}<//>`}
        ${!settled && html`<${Action} control tone="danger" disabled=${busy} onClick=${() => act('stop')}>${g('stop', 'Stop the goal')}<//>`}
        ${(goal.status === 'expired' || goal.renew_by) && html`<${Action} control disabled=${busy} onClick=${() => act('renew')}>${g('renew', 'Renew for 90 days')}<//>`}
        ${settled && html`<${Action} control tone="danger" disabled=${busy} onClick=${() => act('delete')}>${g('delete', 'Remove the goal')}<//>`}
        <${Action} tone="more" href=${`/v1/profile?tab=goals&goal=${encodeURIComponent(goal.id)}`}>${g('settings', 'Rules and the whole chain →')}<//>
      <//>
      <//>`}
    <//>`;
}
