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
 *   THE WORDS FOR WHEN AN AGENT WORKS are the four the proposal page offers (whenWords), so a row
 *   here and a choice there cannot name one thing two ways.
 *
 *   Composed from library components only (Band, NamedRow, LineList, TextField, Action, Mark, Note);
 *   it has no sheet of its own.
 * @structure AgentsBand({ data, navigate }) · whenWords(worker) · machineName(connector) · stateWords(worker)
 * @usage html`<${AgentsBand} data=${homeAgents} navigate=${ctx.navigate} />`
 * @version-history
 *   v1.0.0 — 2026-10-10 — Initial (wish-agentit-home-ruudusta-kuvaile-tilaa-ja-valitse-kone).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { ago } from '/js/format.js';
import { Band, BandNote } from '/components/Band.js';
import { NamedRow } from '/components/NamedRow.js';
import { LineList } from '/components/LineList.js';
import { TextField } from '/components/TextField.js';
import { Action, Loud } from '/components/Action.js';
import { Mark, Marks } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { cronWordsIn } from '/views/profile/scheduler/cron-words.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/** A machine's name as a person reads it; one nobody named says so. */
export function machineName(connector) {
  return connector?.name || tr('home.agents.unnamedMachine', 'Unnamed machine');
}

/** When an agent works, in the words the proposal page offers. */
export function whenWords(worker) {
  if (worker.when === 'clock' && worker.schedule?.cron) {
    return tr('home.agents.when.clockAt', 'By the clock, {words}')
      .replace('{words}', cronWordsIn(worker.schedule.cron, worker.schedule.timezone));
  }
  if (worker.when === 'always') return tr('home.agents.when.always', 'Always on');
  if (worker.when === 'talk') return tr('home.agents.when.talk', 'When someone writes to it');
  if (worker.when === 'clock') return tr('home.agents.when.clock', 'By the clock');
  return tr('home.agents.when.ask', 'When I ask');
}

/** What the agent is doing or last did, in one phrase. */
export function stateWords(worker) {
  if (!worker.has_key) {
    const waits = worker.connector
      ? tr('home.agents.state.waitsFor', 'waits for {machine}').replace('{machine}', machineName(worker.connector))
      : tr('home.agents.state.waits', 'waits for a machine');
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
  return { id: w.name, name: w.display_name || w.name, text: parts.join(' · '), href: `/v1/home?agent=${encodeURIComponent(w.name)}` };
}

/** A principal id as the word a person recognises: 'claude#alice@node' reads 'claude'. */
function handleOf(id) {
  const beforeAt = String(id ?? '').split('@')[0];
  return beforeAt.includes('#') ? beforeAt.split('#')[0] : beforeAt;
}

/** @param {{ data: any, navigate?: (path: string) => void }} props */
export function AgentsBand({ data, navigate }) {
  const [say, setSay] = useState('');
  if (!data) return null;
  const proposals = data.proposals ?? [];
  const workers = data.workers ?? [];
  const machines = data.connectors ?? [];
  const more = (data.worker_total ?? workers.length) - workers.length;

  const newAgentPath = (extra) => '/v1/home?new-agent=1' + (extra || '');
  const make = () => {
    const sentence = say.trim();
    navigate?.(newAgentPath(sentence ? '&say=' + encodeURIComponent(sentence) : ''));
  };

  return html`
    <${Band} title=${tr('home.agents.title', 'Your agents')}>
      <${BandNote}>
        ${tr('home.agents.lead', 'Say in one sentence what you want. AIMEAT makes the agent, shows it to you, and starts it when you approve.')}
      <//>

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
          <${LineList} rows=${proposals.map((p) => ({
            id: p.id,
            name: p.by_person
              ? tr('home.agents.proposed', 'Proposed agent: {name}').replace('{name}', p.display_name)
              : tr('home.agents.proposedBy', '{who} proposes an agent: {name}').replace('{who}', handleOf(p.proposed_by)).replace('{name}', p.display_name),
            text: p.purpose,
            href: newAgentPath('&proposal=' + encodeURIComponent(p.id)),
          }))} />
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
        <${NamedRow} label=${tr('home.agents.machinesLabel', 'Machines')}>
          <${Marks}>
            ${machines.map((c) => html`
              <${Mark} key=${c.id} live=${c.online} tone=${c.online ? undefined : 'dim'}
                title=${c.online ? tr('home.agents.connected', 'Connected') : tr('home.agents.notConnected', 'Not connected, last seen {when}').replace('{when}', ago(c.last_seen))}>
                ${machineName(c)}
              <//>`)}
          <//>
          <${Action} tone="more" href="/v1/home?machines=1">
            ${tr('home.agents.machinesDoor', 'Machines and what they can do →')}
          <//>
        <//>`}

      ${machines.length === 0 && html`
        <${Note} kind="aside" size="small">
          <b>${tr('home.agents.noMachineTitle', 'An agent needs a machine to run on. You have no machine yet.')}</b>
          ${' '}${tr('home.agents.noMachineText', 'You can describe the agent now. It starts as soon as a machine is connected.')}
          ${' '}<${Action} tone="more" href="/v1/home?machines=1">${tr('home.agents.noMachineDoor', 'Add a machine →')}<//>
        <//>`}
    <//>`;
}

export default AgentsBand;
