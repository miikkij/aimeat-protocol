/**
 * @file public/views/home/agent.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One agent, as the home shows it: whether it is at work, when it works, on which
 *   machine, how far it reaches, a field that gives it a task, and what it last did.
 *
 *   THE SHORT PAGE, AND THE WAY TO THE LONG ONE. Settings & Controls has every control of an agent
 *   (its definition, permissions, schedules, messages, usage). This page is what a person needs on
 *   an ordinary day, and its last line opens the other.
 *
 *   MOVING IT is here because it is the one act the machine a person chose can make necessary: the
 *   machine is away and the work waits. The move itself is POST /v1/agents/v2/agents/:name/move,
 *   which the owner makes in person.
 *
 *   Composed from library components only; it has no sheet of its own.
 * @structure default AgentView({ navigate })
 * @usage routed at /v1/home?agent=<name> by spa.html (optional started=running|waiting|made)
 * @version-history
 *   v1.0.0 — 2026-10-10 — Initial (wish-agentit-home-ruudusta-kuvaile-tilaa-ja-valitse-kone).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { useSession } from '/js/use-session.js';
import { swallowed } from '/js/swallowed.js';
import { ago, dateTime } from '/js/format.js';
import { areaLine } from '/js/consent-vocab.js';
import { PageFrame } from '/components/PageFrame.js';
import { PageIntro } from '/components/PageIntro.js';
import { BackLink } from '/components/BackLink.js';
import { Spinner } from '/components/Spinner.js';
import { ErrorNote } from '/components/ErrorNote.js';
import { Note } from '/components/Note.js';
import { Fields, FormActions } from '/components/Field.js';
import { TextArea } from '/components/TextField.js';
import { Choice } from '/components/Choice.js';
import { Facts } from '/components/Facts.js';
import { Action, Loud } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { SubHeading } from '/components/SubHeading.js';
import { LineList } from '/components/LineList.js';
import { listTasks, createTask } from '/js/services/agent-tasks.js';
import { readHomeAgents, moveAgent } from '/js/services/agent-draft.js';
import { machineName, whenWords, stateWords } from '/views/home/agents-band.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const p = (key, fallback) => tr('home.agentPage.' + key, fallback);

const HOME = '/v1/home';

/** A task's state as a word a person reads. The machine's own status names stay for the rest. */
function taskWord(status) {
  if (status === 'done') return p('taskDone', 'done');
  if (status === 'failed') return p('taskFailed', 'failed');
  if (status === 'declined') return p('taskDeclined', 'declined');
  if (status === 'active') return p('taskActive', 'working');
  return p('taskWaiting', 'waiting');
}

export default function AgentView({ navigate }) {
  const session = useSession();
  const query = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const name = query.get('agent') || '';
  const startedAs = query.get('started') || '';
  const scheduleFailed = query.get('schedule') === 'failed';

  const [home, setHome] = useState(null);
  const [record, setRecord] = useState(null);
  const [tasks, setTasks] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [ask, setAsk] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(null);
  const [moving, setMoving] = useState(false);
  const [target, setTarget] = useState('');

  const load = useCallback(async () => {
    try {
      const [data, list, work] = await Promise.all([
        readHomeAgents(1, name),
        apiGet('/v1/agents'),
        listTasks(name, { per_page: 5 }).catch((err) => { swallowed('agent page: tasks', err); return null; }),
      ]);
      setHome(data);
      setRecord((list?.data?.agents ?? []).find((a) => a.name === name) ?? null);
      setTasks(work?.data?.tasks ?? []);
      setLoadError('');
    } catch (err) { setLoadError(err?.message || String(err)); }
  }, [name]);

  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => { if (session && name) loadRef.current(); }, [session, name]);
  // The live-update contract every server-data page keeps: a task finishing or a machine
  // connecting moves this page too.
  useEffect(() => {
    const handler = () => { if (session && name) loadRef.current(); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [session, name]);

  const goHome = useCallback((e) => { e?.preventDefault?.(); navigate(HOME); }, [navigate]);
  const back = html`<${BackLink} href=${HOME} onClick=${goHome}>↩ ${tr('home.history.back', 'Back to your home')}<//>`;

  if (!session) {
    return html`
      <${PageFrame} width="narrow">
        <${PageIntro} title=${p('signInTitle', 'Your agent')} sub=${tr('home.signInDesc', 'Sign in to see where you left off.')} />
        <${FormActions}><${Loud} onClick=${() => navigate('/v1/portal')}>${tr('home.signIn', 'Sign in')}<//><//>
      <//>`;
  }
  if (loadError && !home) return html`<${PageFrame} width="narrow">${back}<${ErrorNote} text=${loadError} /><//>`;
  if (!home) return html`<${PageFrame} width="narrow" loading=${true}><${Spinner} /><//>`;

  const worker = (home.workers ?? [])[0] ?? null;
  if (!worker || !record) {
    return html`
      <${PageFrame} width="narrow">
        ${back}
        <${PageIntro} title=${p('missingTitle', 'No such agent')}
          sub=${p('missingSub', 'You have no agent by that name. Your agents are on your home.')} />
      <//>`;
  }

  const machines = home.connectors ?? [];
  const others = machines.filter((c) => c.id !== worker.connector?.id);
  const settings = `/v1/profile?tab=agents&agent=${encodeURIComponent(name)}`;
  const tone = !worker.has_key || (worker.connector && !worker.connector.online) ? 'attention' : 'fine';

  const give = async () => {
    const text = ask.trim();
    if (!text || busy) return;
    setBusy(true);
    setSaid(null);
    try {
      await createTask(name, { title: text.slice(0, 80), description: text });
      setAsk('');
      setSaid({ ok: true, at: 'task', text: p('given', 'The task is with the agent. Its result appears below.') });
      await load();
    } catch (err) { setSaid({ ok: false, at: 'task', text: err?.message || String(err) }); }
    finally { setBusy(false); }
  };

  const move = async () => {
    if (!target || busy) return;
    setBusy(true);
    setSaid(null);
    try {
      const out = await moveAgent(name, target);
      setMoving(false);
      setTarget('');
      setSaid({ ok: true, at: 'move', text: out?.waiting_for_connector
        ? p('movedWaiting', 'It now waits for that machine, and starts when the machine connects.')
        : p('moved', 'It runs on that machine now.') });
      await load();
    } catch (err) { setSaid({ ok: false, at: 'move', text: err?.message || String(err) }); }
    finally { setBusy(false); }
  };

  const startedNote = startedAs === 'running' ? p('startedRunning', 'Started. It has its instructions and its machine has taken it on.')
    : startedAs === 'waiting' ? p('startedWaiting', 'Made. It starts when its machine connects, with nothing for you to press.')
    : startedAs === 'made' ? p('startedMade', 'Made, but its machine did not take it on. Open all its settings to see why.')
    : '';

  const where = worker.connector
    ? html`${machineName(worker.connector)} <${Mark} kind="status" tone=${worker.connector.online ? 'fine' : 'attention'}>
        ${worker.connector.online ? tr('home.agents.connected', 'Connected') : p('notConnected', 'Not connected')}
      <//>`
    : p('noMachineYet', 'No machine has taken it on yet.');

  return html`
    <${PageFrame} width="narrow">
      ${back}
      <${PageIntro} title=${worker.display_name || name} sub=${worker.description || ''} />

      ${startedNote && html`<${Note} kind="message">${startedNote}<//>`}
      ${scheduleFailed && html`<${Note} kind="message" error>${p('scheduleFailed', 'The agent was made, but its schedule could not be saved. Add it in all its settings.')}<//>`}

      <${Facts} wide rows=${[
        { k: p('now', 'Now'), state: tone, v: stateWords(worker),
          sub: worker.schedule?.next_run_at ? p('next', 'Next work {when}').replace('{when}', dateTime(worker.schedule.next_run_at, { dateStyle: 'medium', timeStyle: 'short' })) : undefined },
        { k: p('when', 'When it works'), v: whenWords(worker) },
        { k: p('where', 'Where it runs'), v: where,
          action: others.length > 0 && !moving
            ? html`<${Action} small onClick=${() => { setMoving(true); setTarget(others[0].id); }}>${p('move', 'Move to another machine')}<//>`
            : undefined },
        { k: p('reach', 'What it reaches'), v: areaLine(record.default_scopes ?? [], t) },
      ]} />

      ${said?.at === 'move' && html`<${Note} kind="message" error=${!said.ok}>${said.text}<//>`}

      ${moving && html`
        <${Fields}>
          <${Choice} boxed cols=${2} label=${p('moveTo', 'Move it to')} value=${target} onChange=${setTarget}
            options=${others.map((c) => ({
              value: c.id, label: machineName(c),
              hint: c.online ? tr('home.agentNew.machineOn', 'Connected.') : p('moveOff', 'Not connected. Only an agent that still waits can be sent here.'),
            }))} />
          <${Note} kind="quiet">${p('moveNote', 'The agent gets a new key on the new machine, and the old machine can no longer act as it. Its instructions, permissions and schedules stay as they are.')}<//>
          <${FormActions}>
            <${Loud} control disabled=${busy || !target} onClick=${move}>${busy ? p('movingNow', 'Moving…') : p('moveDo', 'Move the agent')}<//>
            <${Action} disabled=${busy} onClick=${() => setMoving(false)}>${tr('home.agentNew.cancel', 'Cancel')}<//>
          <//>
        <//>`}

      <${SubHeading} level=${2}>${p('giveTitle', 'Give it a task')}<//>
      <${Fields}>
        <${TextArea} label=${p('giveLabel', 'What should it do now?')} rows=${2} value=${ask} onInput=${setAsk} onSend=${give}
          placeholder=${p('givePlaceholder', 'Say it as you would say it to a person.')} />
        ${said?.at === 'task' && html`<${Note} kind="message" error=${!said.ok}>${said.text}<//>`}
        <${FormActions}>
          <${Loud} control disabled=${busy || !ask.trim()} onClick=${give}>${busy ? p('giving', 'Sending…') : p('give', 'Give the task')}<//>
        <//>
      <//>

      <${SubHeading} level=${2}>${p('latestTitle', 'Latest work')}<//>
      ${(tasks ?? []).length === 0
        ? html`<${Note} kind="quiet">${p('latestNone', 'It has not been given any work yet.')}<//>`
        : html`<${LineList} rows=${tasks.map((task) => ({
            id: task.id,
            name: task.title || task.id,
            text: `${taskWord(task.status)} · ${ago(task.updatedAt || task.createdAt)}`,
            href: settings,
          }))} />`}

      <${FormActions}>
        <${Action} href=${settings}>${p('all', 'All its settings →')}<//>
      <//>
    <//>`;
}
