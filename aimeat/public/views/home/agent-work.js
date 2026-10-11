/**
 * @file public/views/home/agent-work.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One piece of an agent's work, as the home shows it: what it was asked to do, where
 *   it stands, and what it produced, on one plain page.
 *
 *   WHY IT EXISTS. A row of "Latest work" on the agent's home page (views/home/agent.js) used to
 *   open the agent in Settings & Controls, where the result is behind the task list, the task's
 *   own panel and a "Show" button. A person who made the agent with one sentence wants to see what
 *   it did from the place they made it (Jouni, 2026-10-11: "it went to such a confusing menu that
 *   users get scared").
 *
 *   THE RESULT is what the Tasks tab shows as the task's output, read the same way
 *   (js/services/offers.js getDeliverableValue: the key the task names, else what the run tagged
 *   with the task) and drawn by the same component (components/ImageDeliverable.js
 *   DeliverableBody): text as a document, an image as an image, data as a tree. Above it are the
 *   agent's own words about what it did, from the task's outcome. Everything else about a task
 *   (its steps, events, memory, rating) stays in Settings, and the last line goes there.
 *
 *   Composed from library components only; it has no sheet of its own. The two parts, what was
 *   asked and what came out, each sit under a small headline band and show where they stop
 *   (PageSection `group ends`), as the three groups of the agent's home page do.
 * @structure default AgentWorkView({ navigate })
 * @usage routed at /v1/home?agent=<name>&work=<task id> by spa.html
 * @version-history
 *   v1.1.0 — 2026-10-11 — What this work is tied to: where the result is and who sees it (the
 *     outcome's `shared_with`), and the apps that show the agent's work.
 *   v1.0.0 — 2026-10-11 — Initial (wish-agentin-ty-n-tulos-n-kyviin-yksinkertaisessa-agenttin-kym-ss).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { useSession } from '/js/use-session.js';
import { swallowed } from '/js/swallowed.js';
import { ago } from '/js/format.js';
import { PageFrame } from '/components/PageFrame.js';
import { PageIntro } from '/components/PageIntro.js';
import { BackLink } from '/components/BackLink.js';
import { Spinner } from '/components/Spinner.js';
import { ErrorNote } from '/components/ErrorNote.js';
import { Note } from '/components/Note.js';
import { FormActions } from '/components/Field.js';
import { Facts } from '/components/Facts.js';
import { Action, Loud } from '/components/Action.js';
import { PageSection } from '/components/PageSection.js';
import { Markdown } from '/components/Markdown.js';
import { DeliverableBody } from '/components/ImageDeliverable.js';
import { getTask } from '/js/services/agent-tasks.js';
import { getDeliverableValue } from '/js/services/offers.js';
import { readHomeAgents } from '/js/services/agent-draft.js';
import { LineList } from '/components/LineList.js';
import { placeWords } from '/views/home/agent-ties-parts.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const p = (key, fallback) => tr('home.agentWork.' + key, fallback);
const a = (key, fallback) => tr('home.agentPage.' + key, fallback);

/** A task's state as the word the agent's page uses for it, and the tone that goes with it. */
function stateOf(status) {
  if (status === 'done') return { word: a('taskDone', 'done'), tone: 'fine' };
  if (status === 'failed') return { word: a('taskFailed', 'failed'), tone: 'danger' };
  if (status === 'declined') return { word: a('taskDeclined', 'declined'), tone: 'attention' };
  if (status === 'active') return { word: a('taskActive', 'working'), tone: 'fine' };
  return { word: a('taskWaiting', 'waiting'), tone: 'off' };
}

const ENDED = new Set(['done', 'failed', 'declined']);

export default function AgentWorkView({ navigate }) {
  const session = useSession();
  const query = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const name = query.get('agent') || '';
  const id = query.get('work') || '';
  const [found, setFound] = useState(null);
  const [apps, setApps] = useState([]);
  const [result, setResult] = useState({ state: 'none' });
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    try {
      const resp = await getTask(name, id);
      const task = resp?.data?.task ?? null;
      setFound({ task, outcome: resp?.data?.outcome ?? null });
      setLoadError('');
      // The apps that show this agent's work. The page stands without them, so a failed read is logged.
      readHomeAgents(1, name).then((data) => setApps((data?.workers ?? [])[0]?.apps ?? []))
        .catch((err) => swallowed('agent work: apps', err));
      if (task && task.status === 'done') {
        setResult((r) => (r.state === 'ready' ? r : { state: 'loading' }));
        const value = await getDeliverableValue({ agentGaii: task.agentGaii, deliverableKey: task.deliverableKey, taskId: task.id })
          .catch((err) => { swallowed('agent work: result', err); return null; });
        setResult(value == null ? { state: 'empty' } : { state: 'ready', value });
      }
    } catch (err) {
      // A task that is not there, or not this person's, answers the same way: nothing to show.
      if (err?.status === 404 || err?.status === 403) setFound({ task: null, outcome: null });
      else setLoadError(err?.message || String(err));
    }
  }, [name, id]);

  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => { if (session && name && id) loadRef.current(); }, [session, name, id]);
  // The live-update contract every server-data page keeps: a running task that ends shows its
  // result here without a reload.
  useEffect(() => {
    const handler = () => { if (session && name && id) loadRef.current(); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [session, name, id]);

  const agentHome = `/v1/home?agent=${encodeURIComponent(name)}`;
  const goBack = useCallback((e) => { e?.preventDefault?.(); navigate(agentHome); }, [navigate, agentHome]);
  const back = html`<${BackLink} href=${agentHome} onClick=${goBack}>↩ ${p('back', 'Back to the agent')}<//>`;

  if (!session) {
    return html`
      <${PageFrame} width="narrow">
        <${PageIntro} title=${a('signInTitle', 'Your agent')} sub=${tr('home.signInDesc', 'Sign in to see where you left off.')} />
        <${FormActions}><${Loud} onClick=${() => navigate('/v1/portal')}>${tr('home.signIn', 'Sign in')}<//><//>
      <//>`;
  }
  if (loadError && !found) return html`<${PageFrame} width="narrow">${back}<${ErrorNote} text=${loadError} /><//>`;
  if (!found) return html`<${PageFrame} width="narrow" loading=${true}><${Spinner} /><//>`;

  const { task, outcome } = found;
  if (!task) {
    return html`
      <${PageFrame} width="narrow">
        ${back}
        <${PageIntro} title=${p('missingTitle', 'No such work')}
          sub=${p('missingSub', 'This agent has no work by that id.')} />
      <//>`;
  }

  const state = stateOf(task.status);
  const todos = (task.todos ?? []).filter((todo) => todo.status !== 'outdated');
  const stepsDone = todos.filter((todo) => todo.status === 'completed').length;
  const settings = `/v1/profile?tab=agents&agent=${encodeURIComponent(name)}`;
  const ended = ENDED.has(task.status);
  const shared = outcome?.shared_with ?? [];

  return html`
    <${PageFrame} width="narrow">
      ${back}
      <${PageIntro} title=${task.title || p('untitled', 'Work')} />

      <${Facts} wide rows=${[
        { k: p('state', 'State'), state: state.tone, v: state.word,
          sub: !ended && todos.length > 0
            ? p('steps', '{done} of {total} steps done').replace('{done}', String(stepsDone)).replace('{total}', String(todos.length))
            : undefined },
        { k: p('asked', 'Asked'), v: ago(task.createdAt) },
        ended && { k: p('finished', 'Ended'), v: ago(outcome?.at || task.completedAt || task.updatedAt) },
        // Where the result is, and who sees it: the workspaces it is shared with (the outcome's
        // `shared_with`), or the agent's own memory.
        task.status === 'done' && { k: p('where', 'Where the result is'),
          v: shared.length > 0 ? shared.map(placeWords).join(' · ') : p('whereOwn', 'The agent\'s own memory') },
        task.status === 'done' && { k: p('seenBy', 'Who sees it'),
          v: shared.length > 0
            ? p('seenByMembers', 'You, and the members of {organism}').replace('{organism}', [...new Set(shared.map((s) => s.organism_name))].join(', '))
            : p('seenByYou', 'Only you') },
      ].filter(Boolean)} />

      ${task.description && task.description !== task.title && html`
        <${PageSection} group ends title=${p('askedTitle', 'What it was asked to do')}>
          <${Markdown} text=${task.description} small />
        <//>`}

      <${PageSection} group ends title=${p('resultTitle', 'What it produced')}>
        ${task.status === 'active' && html`<${Note} kind="quiet">${p('running', 'The agent is working on this now. The result appears here when it is done.')}<//>`}
        ${!ended && task.status !== 'active' && html`<${Note} kind="quiet">${p('waiting', 'This work has not started yet.')}<//>`}
        ${ended && outcome?.message && html`
          <${Note} kind="message" error=${task.status === 'failed'}><b>${p('says', 'The agent says')}:</b> ${outcome.message}<//>`}
        ${result.state === 'loading' && html`<${Spinner} text=${p('loadingResult', 'Reading the result…')} />`}
        ${result.state === 'ready' && html`<${DeliverableBody} value=${result.value} alt=${task.title || ''} />`}
        ${result.state === 'empty' && html`<${Note} kind="quiet">${p('noOutput', 'The agent saved no separate result. Its own words are above.')}<//>`}
      <//>

      ${/* The apps whose data map names this agent: the places this work shows up in. */''}
      ${task.status === 'done' && apps.length > 0 && html`
        <${PageSection} group ends title=${p('shownTitle', 'Apps that show this work')}>
          <${LineList} rows=${apps.map((app) => ({
            id: app.filename,
            name: app.name,
            text: app.made_for ? tr('home.agentTies.madeFor', 'made for this agent') : tr('home.agentTies.uses', 'uses its work'),
            href: app.url || `/v1/apps/${encodeURIComponent(app.owner)}/${encodeURIComponent(app.filename)}?mode=inline`,
          }))} />
        <//>`}

      <${FormActions}>
        <${Action} href=${settings}>${p('all', 'All details of this work →')}<//>
      <//>
    <//>`;
}
