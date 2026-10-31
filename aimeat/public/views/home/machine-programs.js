/**
 * @file public/views/home/machine-programs.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The programs one computer may start for its agents, on the Your computers page, and
 *   the person's decision on each: allow a program that waits, stop one that runs, allow one again
 *   (wish-koneen-ohjelmaluettelo-nodeen-sallitut-ja-hyv-ksynt-odottava; the design Jouni approved
 *   on 2026-10-30 at https://claude.ai/artifact/AXHWuhXrXGvi3oHg1QVNCt).
 *
 *   ONE DECISION PER AGENT. An agent's runner and its wake command are held under one hash on the
 *   computer, so they are allowed or stopped together, and the page shows them in one row.
 *
 *   EVERY CHOICE SAYS WHAT IT DOES, on its own line, because a button that starts a program on a
 *   computer is not a button to guess about.
 *
 *   THE SAME DECISION IN CHAT. programsPrompt() is the text a person copies into their own AI, which
 *   reads the list with aimeat_connector_list and decides with aimeat_connector_program_set.
 *
 *   Composed from library components only; it has no sheet of its own.
 * @structure MachinePrograms({ c, onChanged }) · programsPrompt()
 * @usage html`<${MachinePrograms} c=${connector} onChanged=${load} />`
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (wish-koneen-ohjelmaluettelo-nodeen-sallitut-ja-hyv-ksynt-odottava).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiPut } from '/js/api.js';
import { ago } from '/js/format.js';
import { Facts, FactLine } from '/components/Facts.js';
import { Note } from '/components/Note.js';
import { Action, Loud } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Stack } from '/components/Layout.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const p = (key, fallback) => tr('home.machines.programs.' + key, fallback);

const HOME = '/v1/home';

/** What a program is for, in the words the person reads. */
const purposeWords = (use) => use === 'wake'
  ? p('useWake', 'Wakes the agent when new work arrives')
  : p('useRunner', 'Runs the agent for each task');

/** How the computer came to allow it, or that it waits. */
function originWords(row) {
  if (row.status === 'waiting') return p('foundAt', 'The computer found it {when}. It does not start until you allow it.').replace('{when}', ago(row.reported_at));
  if (row.status === 'declined') return p('declinedNow', 'You did not allow it. It does not start.');
  if (row.source === 'connected') return p('fromConnect', 'You connected it on this computer {when}.').replace('{when}', row.since ? ago(row.since) : '');
  if (row.source === 'adopted') return p('fromInstall', 'It was on the computer already and was taken into use at the first start.');
  if (row.source === 'approved') return p('fromYou', 'You allowed it here {when}.').replace('{when}', row.since ? ago(row.since) : '');
  return p('allowedPlain', 'The computer starts it.');
}

/** The status mark: allowed, waiting for the person, or not allowed. */
function statusMark(row) {
  if (row.status === 'waiting') return html`<${Mark} kind="status" tone="attention">${p('waiting', 'Waits for your approval')}<//>`;
  if (row.status === 'declined') return html`<${Mark} kind="status" tone="off">${p('declined', 'Not allowed')}<//>`;
  return html`<${Mark} kind="status" tone="fine">${p('allowed', 'Allowed')}<//>`;
}

/** The text a person copies into their own AI to manage the programs there. */
export function programsPrompt() {
  return p('prompt', 'Read my computers with aimeat_connector_list. For each computer, tell me which programs it may start for my agents and which wait for my approval: the command, the agent, and what it is for. Change nothing before I say so. When I decide, call aimeat_connector_program_set with the computer, the program\'s hash and allow or deny.');
}

/** @param {{ c: any, onChanged: () => void }} props */
export function MachinePrograms({ c, onChanged }) {
  const [busy, setBusy] = useState('');
  const [said, setSaid] = useState(null);

  if (!c.programs) {
    return c.online
      ? html`<${Note} kind="quiet">${p('neverReported', 'This computer has not said which programs it may start. Its AIMEAT connector is older than this list; updating it shows them here.')}<//>`
      : null;
  }
  if (!c.programs.length) return null;

  const decide = async (hash, decision) => {
    if (busy) return;
    setBusy(hash); setSaid(null);
    try {
      await apiPut(`/v1/agents/v2/connectors/${encodeURIComponent(c.id)}/programs/${encodeURIComponent(hash)}`, { decision });
      onChanged();
    } catch (err) { setSaid(err?.message || String(err)); }
    finally { setBusy(''); }
  };

  // One row per agent: its runner and wake command share one hash and one decision.
  const groups = [];
  for (const row of c.programs) {
    const g = groups.find((x) => x.agent === row.agent && x.hash === row.hash);
    if (g) g.rows.push(row); else groups.push({ agent: row.agent, hash: row.hash, rows: [row] });
  }

  const rows = groups.map(({ agent, hash, rows: list }) => {
    const first = list[0];
    // Each choice is its button with what it does under it, one choice per line.
    const allow = html`
      <${FactLine} sub=${p('allowDoes', 'The computer takes the program into use at its next connection, usually within a minute. {agent} starts working with it.').replace('{agent}', agent)}>
        <${Loud} small control disabled=${!!busy} onClick=${() => decide(hash, 'allow')}>${p('allow', 'Allow')}<//>
      <//>`;
    const deny = html`
      <${FactLine} sub=${first.status === 'allowed'
        ? p('stopDoes', 'The computer stops using the program at its next connection. {agent} does no work that needs it until you allow it here again.').replace('{agent}', agent)
        : p('denyDoes', 'The program does not start. {agent} waits until you allow it later.').replace('{agent}', agent)}>
        <${Action} small control disabled=${!!busy} onClick=${() => decide(hash, 'deny')}>${first.status === 'allowed' ? p('stop', 'Stop allowing it') : p('deny', "Don't allow")}<//>
      <//>`;
    return {
      key: `${agent}:${hash}`,
      k: html`<a href=${`${HOME}?agent=${encodeURIComponent(agent)}`}>${agent}</a>`,
      state: first.status === 'waiting' ? 'attention' : undefined,
      v: html`
        <${Stack} gap="small">
          ${list.map((row) => html`<${FactLine} key=${row.use} sub=${purposeWords(row.use)}><code class="code-inline">${row.command}</code><//>`)}
          <div>${statusMark(first)}</div>
          <span>${originWords(first)}${first.applied ? '' : ' ' + p('notYet', 'The computer takes your decision into use at its next connection.')}</span>
          ${first.status === 'waiting' && html`${allow}${deny}`}
          ${first.status === 'allowed' && deny}
          ${first.status === 'declined' && allow}
        <//>`,
    };
  });

  return html`
    <${Stack} gap="small">
      <${Facts} wide rows=${[{ k: p('title', 'Programs it may start'), v: p('lede', 'The computer starts a program for an agent only when you or the connection on the computer allowed it. Your agents and your AI read this list when they plan work.') }, ...rows]} />
      ${c.programs_reported_at && html`<${Note} kind="quiet">${p('age', 'The list is from {when}. The computer updates it each time it connects.').replace('{when}', ago(c.programs_reported_at))}<//>`}
      ${said && html`<${Note} kind="message" error=${true}>${said}<//>`}
    <//>`;
}
