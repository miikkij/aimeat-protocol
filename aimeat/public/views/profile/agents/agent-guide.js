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
 * @structure AgentGuide({ session, onConnect, onNew }) · ConnectorSteps({ session }) ·
 *   PlacesPicture() · NoAgentsYet({ onPick })
 * @usage <${AgentGuide} session=${session} onConnect=${openConnect} onNew=${openNew} first />
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
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

/** The connector's two commands, with the copy button, as section 03's developer fold shows them. */
export function ConnectorSteps({ session }) {
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
      <${Note} kind="lead">${g('machineResult')}<//>
      <${ConnectorSteps} session=${session} />
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
