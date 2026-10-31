/**
 * @file public/views/home/agents-band.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The home's band about a person's agents: one field that says what a new agent
 *   should do, the proposals that wait for the person, the agents at work, and the machines they
 *   run on.
 *
 *   ONE SENTENCE IS THE WAY IN. The field takes what the person wants in their own words and the
 *   page behind it shows the agent before anything exists. The same sentence said to their own AI
 *   ends in the same place: a proposal in the "waiting for you" row.
 *
 *   A ROW WITH NOTHING TO SAY IS NOT DRAWN, as everywhere on the home. A person with no agents sees
 *   the field and, when they have no machine either, the line that says an agent needs one.
 *
 *   THE WORDS FOR WHEN AN AGENT WORKS are the five the proposal page offers (whenWords), so a row
 *   here and a choice there cannot name one thing two ways.
 *
 *   Composed from library components only (Band, NamedRow, LineList, List, TextField, Action, Mark, Note);
 *   it has no sheet of its own.
 * @structure AgentsBand({ data, navigate }) · whenWords(worker) · machineName(connector) · agentName(worker) ·
 *   stateWords(worker)
 * @usage html`<${AgentsBand} data=${homeAgents} navigate=${ctx.navigate} />`
 * @version-history
 *   2026-10-31 — Each proposal under "Waiting for you" has Approve and Decline on its row; its name
 *     opens its own page. The rows were links only, with nothing to press (v31 K49).
 *   2026-10-31 — The computers row is "Where your agents run"; on a node the store sold, the place's
 *     own runtime ("aim-solo-…-node (crew)") reads "Your own server" and the "concierge" agent "Your
 *     assistant" (machineName, agentName; v31 K50). A connector is still a computer in every other word.
 *   2026-10-25 — The band's title carries the question mark that explains an agent, and its first rows
 *     are the goals (views/home/goals-part.js): the field that gives the agents a goal, the running
 *     goals, and what in them waits for the person (session cc-jouni-goals).
 *   2026-10-19 — A worker's line starts with the agent's own picture when it has set one.
 *   2026-10-12 — whenWords says "When something new arrives in a workspace" for an agent whose
 *     definition names the workspace spaces it watches.
 *   2026-10-11 — A stopped agent's row says "stopped", and how many tasks wait for it.
 *   2026-10-11 — The word a person reads for a connector is "computer" (laptop, server, cloud, AIMEAT instance), never "machine" (Jouni, 2026-10-11).
 *   v1.0.0 — 2026-10-10 — Initial (wish-agentit-home-ruudusta-kuvaile-tilaa-ja-valitse-kone).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { ago } from '/js/format.js';
import { customerNode } from '/js/site.js';
import { Band, BandNote } from '/components/Band.js';
import { NamedRow } from '/components/NamedRow.js';
import { LineList } from '/components/LineList.js';
import { List, Row, Name, Desc, Doors } from '/components/List.js';
import { apiPost } from '/js/api.js';
import { AgentAvatar, avatarOf } from '/components/AgentAvatar.js';
import { TextField } from '/components/TextField.js';
import { Action, Loud } from '/components/Action.js';
import { Mark, Marks } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { cronWordsIn } from '/views/profile/scheduler/cron-words.js';
import { HelpTip } from '/components/HelpTip.js';
import { GoalsPart } from './goals-part.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/**
 * A machine's name as a person reads it; one nobody named says so. On a node the store sold, the
 * runtime the fleet service set up on the place's own server is named like "aim-solo-…-node (crew)",
 * which a buyer cannot read: it is "Your own server" (v31 K50).
 */
export function machineName(connector) {
  if (customerNode() && /\(crew\)\s*$/i.test(connector?.name || '')) return tr('home.agents.ownServer', 'Your own server');
  return connector?.name || tr('home.agents.unnamedMachine', 'Unnamed computer');
}

/** An agent's name as a person reads it: the node's own helper, "concierge", is "Your assistant" to a buyer (v31 K50). */
export function agentName(worker) {
  if (worker?.display_name) return worker.display_name;
  if (customerNode() && worker?.name === 'concierge') return tr('home.agents.concierge', 'Your assistant');
  return worker?.name;
}

/** When an agent works, in the words the proposal page offers. */
export function whenWords(worker) {
  if (worker.when === 'clock' && worker.schedule?.cron) {
    return tr('home.agents.when.clockAt', 'By the clock, {words}')
      .replace('{words}', cronWordsIn(worker.schedule.cron, worker.schedule.timezone));
  }
  if (worker.when === 'always') return tr('home.agents.when.always', 'Always on');
  if (worker.when === 'records') return tr('home.agents.when.records', 'When something new arrives in a workspace');
  if (worker.when === 'talk') return tr('home.agents.when.talk', 'When someone writes to it');
  if (worker.when === 'clock') return tr('home.agents.when.clock', 'By the clock');
  return tr('home.agents.when.ask', 'When I ask');
}

/** What the agent is doing or last did, in one phrase. */
export function stateWords(worker) {
  // Stopped comes first: it is the person's own decision, and it is why nothing else is happening.
  if (worker.stopped) {
    const stopped = tr('home.agents.state.stopped', 'stopped');
    return worker.queued > 0
      ? `${stopped}, ${tr('home.agents.state.waiting', 'tasks waiting: {n}').replace('{n}', String(worker.queued))}`
      : stopped;
  }
  if (!worker.has_key) {
    const waits = worker.connector
      ? tr('home.agents.state.waitsFor', 'waits for {machine}').replace('{machine}', machineName(worker.connector))
      : tr('home.agents.state.waits', 'waits for a computer');
    return worker.queued > 0
      ? `${waits}, ${tr('home.agents.state.queued', '{n} tasks queued').replace('{n}', String(worker.queued))}`
      : waits;
  }
  if (worker.connector && !worker.connector.online) {
    const off = tr('home.agents.state.machineOff', '{machine} is not connected').replace('{machine}', machineName(worker.connector));
    return worker.queued > 0
      ? `${off}, ${tr('home.agents.state.queued', '{n} tasks queued').replace('{n}', String(worker.queued))}`
      : off;
  }
  if (worker.active > 0) return tr('home.agents.state.working', 'working now');
  if (worker.last_at) return tr('home.agents.state.last', 'last worked {when}').replace('{when}', ago(worker.last_at));
  return tr('home.agents.state.none', 'no work yet');
}

/** One worker as a line: its name, then when it works, where, and what it last did. */
function workerLine(w) {
  const parts = [whenWords(w)];
  if (w.connector && w.has_key && w.connector.online) parts.push(machineName(w.connector));
  parts.push(stateWords(w));
  // The agent's own picture before its name, when it has set one (components/AgentAvatar.js).
  const name = agentName(w);
  return {
    id: w.name, text: parts.join(' · '), href: `/v1/home?agent=${encodeURIComponent(w.name)}`,
    name: avatarOf(w) ? html`<${AgentAvatar} agent=${w} size="small" />${name}` : name,
  };
}

/** A principal id as the word a person recognises: 'claude#alice@node' reads 'claude'. */
function handleOf(id) {
  const beforeAt = String(id ?? '').split('@')[0];
  return beforeAt.includes('#') ? beforeAt.split('#')[0] : beforeAt;
}

/** @param {{ data: any, navigate?: (path: string) => void }} props */
export function AgentsBand({ data, navigate }) {
  const [say, setSay] = useState('');
  // What became of a proposal decided on this band, by id: the sentence shown in its row until the
  // live update takes the row away.
  const [settled, setSettled] = useState({});
  const [busy, setBusy] = useState(false);
  if (!data) return null;

  async function settle(p, decision) {
    const name = p.display_name || p.name;
    setBusy(true);
    try {
      const resp = await apiPost(`/v1/agents/v2/agent-proposals/${encodeURIComponent(p.id)}/${decision}`, {});
      const d = resp?.data;
      const key = decision === 'decline' ? 'declined' : d?.attached ? 'done' : d?.waiting_for_connector ? 'madeWaiting' : 'madeNotRunning';
      setSettled((s) => ({ ...s, [p.id]: tr('profile.agents.new.' + key, '').replaceAll('{name}', name) }));
    } catch (err) {
      setSettled((s) => ({ ...s, [p.id]: err?.message || tr('profile.agents.new.failed', '') }));
    } finally {
      setBusy(false);
    }
  }
  const proposals = data.proposals ?? [];
  const workers = data.workers ?? [];
  const machines = data.connectors ?? [];
  const more = (data.worker_total ?? workers.length) - workers.length;

  const newAgentPath = (extra) => '/v1/home?new-agent=1' + (extra || '');
  const make = () => {
    const sentence = say.trim();
    navigate?.(newAgentPath(sentence ? '&say=' + encodeURIComponent(sentence) : ''));
  };

  const title = tr('home.agents.title', 'Your agents');
  return html`
    <${Band} title=${html`${title} <${HelpTip} term="concept.agent" label=${title} />`}>
      <${BandNote}>
        ${tr('home.agents.lead', 'Say in one sentence what you want. AIMEAT makes the agent, shows it to you, and starts it when you approve.')}
      <//>

      <${GoalsPart} navigate=${navigate} />

      <${NamedRow} stack label=${tr('home.agents.newLabel', 'A new agent')}>
        <${TextField}
          label=${tr('home.agents.askLabel', 'What should the agent do?')}
          placeholder=${tr('home.agents.askPlaceholder', 'For example: gather the industry news every weekday morning and write a summary')}
          value=${say} onInput=${setSay} onEnter=${make}
          actions=${html`<${Loud} control onClick=${make}>${tr('home.agents.make', 'Make the agent')}<//>`} />
        <${Note} kind="quiet">
          ${tr('home.agents.ownAi', 'Would you rather do this in your own AI? Say the same sentence to it. Its proposal comes here for you to approve.')}
        <//>
      <//>

      ${proposals.length > 0 && html`
        <${NamedRow} stack label=${tr('home.agents.waitingLabel', 'Waiting for you')}>
          ${/* Each one is decided here: Approve starts it as proposed, Decline makes nothing, and the
                name opens its own page to change it first. The rows were links only, and a buyer saw
                text with nothing to press (v31 K49). */''}
          <${List} cols="name-desc-doors">
            ${proposals.map((p) => html`
              <${Row} key=${p.id}>
                <${Name} href=${newAgentPath('&proposal=' + encodeURIComponent(p.id))}
                  onFollow=${(e) => { if (!navigate) return; e.preventDefault(); navigate(newAgentPath('&proposal=' + encodeURIComponent(p.id))); }}>
                  ${p.by_person
                    ? tr('home.agents.proposed', 'Proposed agent: {name}').replace('{name}', p.display_name)
                    : tr('home.agents.proposedBy', '{who} proposes an agent: {name}').replace('{who}', handleOf(p.proposed_by)).replace('{name}', p.display_name)}
                <//>
                <${Desc}>${settled[p.id] || p.purpose}<//>
                <${Doors}>
                  ${!settled[p.id] && html`
                    <${Loud} control disabled=${busy} onClick=${() => settle(p, 'approve')}>${tr('profile.agents.new.approve', 'Approve')}<//>
                    <${Action} small row disabled=${busy} onClick=${() => settle(p, 'decline')}>${tr('profile.agents.new.decline', 'Decline')}<//>`}
                <//>
              <//>`)}
          <//>
        <//>`}

      ${workers.length > 0 && html`
        <${NamedRow} stack label=${tr('home.agents.workingLabel', 'At work')}>
          <${LineList} rows=${workers.map(workerLine)}
            more=${html`<${Action} tone="more" href="/v1/profile?tab=agents">
              ${more > 0
                ? tr('home.agents.allN', 'All agents ({n}) →').replace('{n}', String(data.worker_total))
                : tr('home.agents.all', 'All agents →')}
            <//>`} />
        <//>`}

      ${machines.length > 0 && html`
        <${NamedRow} label=${tr('home.agents.machinesLabel', 'Computers')}>
          <${Marks}>
            ${machines.map((c) => html`
              <${Mark} key=${c.id} live=${c.online} tone=${c.online ? undefined : 'dim'}
                title=${c.online ? tr('home.agents.connected', 'Connected') : tr('home.agents.notConnected', 'Not connected, last seen {when}').replace('{when}', ago(c.last_seen))}>
                ${machineName(c)}
              <//>`)}
          <//>
          <${Action} tone="more" href="/v1/home?computers=1">
            ${tr('home.agents.machinesDoor', 'Computers and what they can do →')}
          <//>
        <//>`}

      ${machines.length === 0 && html`
        <${Note} kind="aside" size="small">
          <b>${tr('home.agents.noMachineTitle', 'An agent needs a computer to run on. You have none yet.')}</b>
          ${' '}${tr('home.agents.noMachineText', 'You can describe the agent now. It starts as soon as a computer is connected.')}
          ${' '}<${Action} tone="more" href="/v1/home?computers=1">${tr('home.agents.noMachineDoor', 'Add a computer →')}<//>
        <//>`}
    <//>`;
}

export default AgentsBand;
