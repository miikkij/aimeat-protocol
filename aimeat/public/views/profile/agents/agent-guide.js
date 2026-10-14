/**
 * @file public/views/profile/agents/agent-guide.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Agents page's first section, "What should an agent do?", the connector's install
 *   steps, and the examples a person with no agents starts from (guided journey P4, brief
 *   doc-mupor242l3cq).
 *
 *   WHY A CHOOSER BEFORE THE FORMS. The page offered three different things side by side (two basic
 *   agents on the person's computer, an agent of their own, and connecting the AI they already use)
 *   and nothing compared them, so the person had to know the answer before they could pick. Here the
 *   question is what the agent should do; the answer names the kind, where it runs, what it needs and
 *   who pays, and opens the one place that makes it. For a worker the second question is where it
 *   runs, because that is what decides whether anything must be installed.
 *
 *   THE CONNECTOR IS SAID, NOT ASSUMED. Until 2026-10-01 the basic agents' section said "You do not
 *   have to set anything up" and kept its button disabled until a connector ran. ConnectorSteps is the
 *   install, inline, wherever a worker on the person's computer is offered.
 *
 *   A NODE THAT TAKES NO COMPUTERS SAYS SO. With the connector tunnel off, `aimeat connect serve`
 *   is refused (an nginx 502 on innokas.aimeat.io, 2026-10-14) and no computer ever appears, so the
 *   steps ask the operator to turn it on and restart instead of showing commands that cannot work.
 * @structure AgentGuide({ session, onConnect, onNew }) · ConnectorSteps({ session, accepting? }) ·
 *   NoComputersHere({ session }) · nodeTakesComputers() · PlacesPicture() · NoAgentsYet({ onPick })
 * @usage <${AgentGuide} session=${session} onConnect=${openConnect} onNew=${openNew} first />
 * @version-history
 *   v1.1.0 — 2026-10-14 — ConnectorSteps shows NoComputersHere when the node's connector tunnel is
 *     off (GET /v1/agents/v2/connectors tunnel_enabled), with the setting for the operator (Jouni,
 *     2026-10-14: "ei saisi näyttää lisää tietokone jos 502 ja enable tunnel ei ole laitettu true:ksi").
 *   v1.0.0 — 2026-10-01 — Initial.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { getNodeUrl } from '/js/services/auth.js';
import { Section } from '/components/Section.js';
import { Note } from '/components/Note.js';
import { Choice } from '/components/Choice.js';
import { Facts } from '/components/Facts.js';
import { Code } from '/components/Mark.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { List, Row, Name, Desc, Doors } from '/components/List.js';
import { Stack } from '/components/Layout.js';
import { PLACES } from './agent-facts.js';

const g = (key, vars) => t('profile.agents.guide.' + key, vars);

let takesComputers = null;
/**
 * Whether this node takes computers at all: `tunnel_enabled` of GET /v1/agents/v2/connectors, asked
 * once per page load. A failed read answers yes, so the commands show as they did before.
 * @returns {Promise<boolean>}
 */
export function nodeTakesComputers() {
  takesComputers ??= apiGet('/v1/agents/v2/connectors')
    .then((r) => r?.data?.tunnel_enabled !== false)
    .catch((err) => { swallowed('agent-guide: tunnel state', err); return true; });
  return takesComputers;
}

/**
 * nodeTakesComputers() as a hook: null until the node answered, then true or false.
 * @returns {boolean | null}
 */
export function useTakesComputers() {
  const [takes, setTakes] = useState(/** @type {boolean | null} */ (null));
  useEffect(() => {
    let live = true;
    nodeTakesComputers().then((v) => { if (live) setTakes(v); });
    return () => { live = false; };
  }, []);
  return takes;
}

/**
 * What a person reads in place of the commands when this node takes no computers: the operator
 * must turn the tunnel on and restart, so the commands would only end in a refused connection.
 * The operator is told the setting and given the way to it.
 */
export function NoComputersHere({ session }) {
  const operator = (session?.roles || []).includes('operator');
  return html`
    <${Stack} gap="small">
      <${Note} kind="aside">${g('noTunnel')}<//>
      ${operator && html`
        <${Note} kind="lead">${g('noTunnelOperator')}<//>
        <${Actions}><${Action} small href="/v1/admin?tab=config">${g('noTunnelSettings')} →<//><//>`}
    <//>
  `;
}

/**
 * The connector's two commands, with the copy button, as section 03's developer fold shows them.
 * `accepting` is the node's answer when the caller already has it; without it the steps ask.
 */
export function ConnectorSteps({ session, accepting }) {
  const asked = useTakesComputers();
  if ((accepting ?? asked) === false) return html`<${NoComputersHere} session=${session} />`;
  const install = `npx aimeat connect --url ${getNodeUrl()} --owner ${session?.owner ?? ''}`;
  return html`
    <${Code} block>${install}<//>
    <${Code} block>npx aimeat connect serve<//>
    <${Actions}><${Loud} copy=${`${install}\nnpx aimeat connect serve`}>${t('profile.agents.copyCommand')}<//><//>
  `;
}

/** The four places an agent can run, one row each: what runs there, its model and who pays. */
export function PlacesPicture() {
  return html`<${Facts} rows=${PLACES.map(id => ({
    k: g(`places.${id}.title`), v: g(`places.${id}.what`), sub: g(`places.${id}.sub`),
  }))} />`;
}

const ANSWERS = ['ask', 'away', 'timetable', 'app'];

/** What each answer leads to: its sentence and the one door it opens. */
function Result({ answer, where, setWhere, session, onConnect, onNew }) {
  const takes = useTakesComputers();
  if (answer === 'ask') {
    return html`<${Note} kind="lead">${g('askResult')}<//>
      <${Actions}><${Loud} onClick=${onConnect}>${g('askDoor')}<//><//>`;
  }
  if (answer === 'timetable') {
    return html`<${Note} kind="lead">${g('timetableResult')}<//>
      <${Actions}><${Action} small href="/v1/profile?tab=scheduler">${g('scheduleDoor')} →<//><//>`;
  }
  if (answer === 'app') {
    return html`<${Note} kind="lead">${g('appResult')}<//>
      <${Actions}><${Action} small href="/v1/profile?tab=packages">${g('appDoor')} →<//><//>`;
  }
  return html`
    <${Choice} label=${g('whereTitle')} value=${where} onChange=${setWhere} boxed cols=${2}
      options=${['machine', 'node'].map(id => ({ value: id, label: g(`where.${id}`), hint: g(`where.${id}Hint`) }))} />
    ${where === 'machine' && html`
      ${takes !== false && html`<${Note} kind="lead">${g('machineResult')}<//>`}
      <${ConnectorSteps} session=${session} accepting=${takes ?? undefined} />
      <${Actions}><${Action} small onClick=${onNew}>${g('machineDoor')} →<//><//>`}
    ${where === 'node' && html`
      <${Note} kind="lead">${g('nodeResult')}<//>
      <${Actions}><${Action} small href="/v1/profile?tab=scheduler">${g('scheduleDoor')} →<//><//>`}
  `;
}

/** Section 01: the question, the answer, and the picture of where agents run. */
export function AgentGuide({ session, onConnect, onNew, first = false }) {
  const [answer, setAnswer] = useState(null);
  const [where, setWhere] = useState(null);
  const [placesOpen, setPlacesOpen] = useState(false);
  const pick = (v) => { setAnswer(v); setWhere(null); };
  return html`
    <${Section} id="agp-guide" num="01" title=${g('title')} first=${first}
      doors=${html`<${Action} small soft onClick=${() => setPlacesOpen(v => !v)}>${placesOpen ? t('profile.agents.page.close') : g('placesDoor')}<//>`}>
      <${Note} kind="lead">${g('lead')}<//>
      <${Stack} gap="medium">
        <${Choice} ariaLabel=${g('title')} value=${answer} onChange=${pick} boxed cols=${4}
          options=${ANSWERS.map(id => ({ value: id, label: g(id), hint: g(`${id}Hint`) }))} />
        ${answer && html`<${Stack} gap="medium"><${Result} answer=${answer} where=${where} setWhere=${setWhere}
          session=${session} onConnect=${onConnect} onNew=${onNew} /><//>`}
        ${placesOpen && html`<${PlacesPicture} />`}
      <//>
    <//>
  `;
}

/** Three things an agent can do, for a person who has none: each fills the "agent of your own" form. */
/** The example's id → the agent's name, a machine identifier, the same in every language. */
export const EXAMPLES = { watcher: 'page-watcher', inbox: 'inbox-helper', receipts: 'receipt-sorter' };

export function NoAgentsYet({ onPick }) {
  return html`
    <${Note} kind="lead">${g('empty.lead')}<//>
    <${List} cols="name-desc-doors">
      ${Object.entries(EXAMPLES).map(([id, name]) => html`
        <${Row} key=${id}>
          <${Name}>${g(`empty.${id}.title`)}<//>
          <${Desc}>${g(`empty.${id}.purpose`)}<//>
          <${Doors}><${Action} small row onClick=${() => onPick({
            name, displayName: g(`empty.${id}.title`), purpose: g(`empty.${id}.purpose`),
          })}>${g('empty.button')}<//><//>
        <//>`)}
    <//>
  `;
}
