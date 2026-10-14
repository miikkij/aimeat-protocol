/**
 * @file public/views/home/ideas-dialog.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ideas dialog, for a person who does not yet know what to ask for. Two tabs.
 *   "Agents" shows agents made from one sentence and run for real, filed by what they help with;
 *   choosing one hands it to the caller, which puts its sentence where the person writes (the
 *   new-agent page's box, or the prompt for their own AI). "App and agent" shows apps paired with
 *   the agent that works through them: what the person does, what the agent does with the app's
 *   tools, and what the app shows of the agent's work.
 *
 *   ON AN AGENT'S PAGE (`onPickApp`) the app tab is where the dialog opens, and an app idea is
 *   chosen for the app of that agent's work: the caller writes it into "What do you want to see?".
 *
 *   The list is the node's (ideas-data.js). Composed from library components only (Modal, Chooser,
 *   Card, Facts, Action, Hint); it has no sheet of its own. Defined at module level so the home's
 *   live re-render does not remount the open dialog.
 * @structure IdeasDialog({ open, onClose, tab, onPick, onPickApp })
 * @usage html`<${IdeasDialog} open=${open} onClose=${close} tab="agents" onPick=${(idea) => setSentence(idea.say)} />`
 * @version-history
 *   v1.0.0 — 2026-10-14 — Reads the node's list; the app tab can choose an idea for an agent's app
 *     (wish-esimerkit-agenteista-ja-sovelluksista-kotiruudulle-mielikuvi).
 *   v0.1.0 — 2026-10-14 — Design draft.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { tOr } from '/js/i18n.js';
import { Modal } from '/components/Modal.js';
import { ChooserChoices, ChooserChoice } from '/components/Chooser.js';
import { Card, CardGrid } from '/components/Card.js';
import { Action } from '/components/Action.js';
import { Hint } from '/components/Hint.js';
import { Facts } from '/components/Facts.js';
import { Spinner } from '/components/Spinner.js';
import { useHomeIdeas, whenText } from './ideas-data.js';

const html = htm.bind(h);
const n = (key, fallback) => tOr('home.ideas.' + key, fallback);

/** What the person asks their own AI when an app idea has no app on this AIMEAT yet. */
function buildAppRequest(idea) {
  return [
    n('appRequestLead', 'Build me an app on my AIMEAT:'), idea.name + '.',
    n('you', 'You') + ': ' + idea.you, n('agentToApp', 'Agent → app') + ': ' + idea.agent_uses,
    n('appFromAgent', 'App ← agent') + ': ' + idea.app_shows,
    n('appRequestTail', 'Give the agent a tool that writes into the app, and show its work in the app.'),
  ].join(' ');
}

function AgentIdeas({ ideas, onPick }) {
  const [group, setGroup] = useState('all');
  const shown = ideas.agents.filter((i) => group === 'all' || i.group === group);
  const groups = [{ id: 'all', name: n('groupAll', 'All') }, ...ideas.groups.filter((g) => ideas.agents.some((a) => a.group === g.id))];
  return html`
    <${Hint}>${n('agentsLead', 'Agents made from one sentence and run for real. Choose one: its sentence goes into the box, and you change it before anything is made.')}<//>
    <${ChooserChoices} label=${n('groups', 'What it helps with')}>
      ${groups.map((g) => html`<${ChooserChoice} key=${g.id} on=${group === g.id} onClick=${() => setGroup(g.id)}>${g.name}<//>`)}
    <//>
    <${CardGrid} cols="two">
      ${shown.map((idea) => html`<${Card} key=${idea.id} tone="framed"
        kicker=${idea.app ? n('uses', 'Uses') + ' ' + idea.app : n('noApp', 'Needs no app')}
        name=${idea.name} text=${idea.gets}
        lines=${[{ label: n('when', 'Works'), count: whenText(idea.when) }]}
        meta=${'"' + idea.say + '"'}
        doors=${html`<${Action} small onClick=${() => onPick(idea)}>${n('useThis', 'Use this')} →<//>`} />`)}
    <//>`;
}

function AppIdeas({ ideas, onPick, onPickApp }) {
  return html`
    <${Hint}>${n('appsLead', 'An app and an agent do the work together: the agent uses the app\'s tools, and the app shows what the agent did. A ready app is on this AIMEAT; an idea is one your AI builds for you.')}<//>
    <${CardGrid} cols="two">
      ${ideas.apps.map((idea) => {
        const agent = ideas.agents.find((a) => a.id === idea.agent);
        const doors = onPickApp
          ? html`<${Action} small onClick=${() => onPickApp(idea)}>${n('useForApp', 'Use this for the app')} →<//>`
          : html`
            ${agent && html`<${Action} small onClick=${() => onPick(agent)}>${n('makeAgent', 'Make its agent')} →<//>`}
            ${!idea.ready_app && html`<${Action} small copy=${buildAppRequest(idea)} copiedLabel=${n('copied', 'Copied: paste it to your AI')}>${n('copyAppRequest', 'Copy the request for your AI')}<//>`}`;
        return html`<${Card} key=${idea.id} tone="framed"
          kicker=${idea.ready_app ? n('ready', 'Ready') + ': ' + idea.ready_app : n('idea', 'Idea')}
          name=${idea.name} doors=${doors}>
          <${Facts} rows=${[
            { k: n('you', 'You'), v: idea.you },
            { k: n('agentToApp', 'Agent → app'), v: idea.agent_uses },
            { k: n('appFromAgent', 'App ← agent'), v: idea.app_shows },
          ]} />
        <//>`;
      })}
    <//>`;
}

/**
 * The dialog. `tab` is the tab it opens on ('agents' or 'apps'); `onPick(agentIdea)` and
 * `onPickApp(appIdea)` are called before the dialog closes. With `onPickApp` the dialog chooses
 * for an agent's app and shows the app tab alone.
 */
export function IdeasDialog({ open, onClose, tab = 'agents', onPick, onPickApp }) {
  const ideas = useHomeIdeas();
  const [shown, setShown] = useState(tab);
  const forApp = !!onPickApp;
  useEffect(() => { if (open) setShown(forApp ? 'apps' : tab); }, [open, tab, forApp]);
  const pick = (idea) => { onPick?.(idea); onClose(); };
  const pickApp = onPickApp ? (idea) => { onPickApp(idea); onClose(); } : null;
  if (!open) return null;
  return html`
    <${Modal} open=${open} onClose=${onClose} size="xl" title=${n('title', 'Ideas to start from')}>
      ${!onPickApp && html`<${ChooserChoices} label=${n('title', 'Ideas to start from')}>
        <${ChooserChoice} on=${shown === 'agents'} onClick=${() => setShown('agents')}>${n('tabAgents', 'Agents')}<//>
        <${ChooserChoice} on=${shown === 'apps'} onClick=${() => setShown('apps')}>${n('tabApps', 'App and agent')}<//>
      <//>`}
      ${!ideas ? html`<${Spinner} />`
        : shown === 'agents' ? html`<${AgentIdeas} ideas=${ideas} onPick=${pick} />`
          : html`<${AppIdeas} ideas=${ideas} onPick=${pick} onPickApp=${pickApp} />`}
    <//>`;
}
