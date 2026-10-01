/**
 * @file public/views/profile/agents/agent-card-autonomy.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The agent card's two lines a person decides on: where the agent runs (with what it
 *   thinks with and who pays), and whether it starts work by itself (guided journey P4, brief
 *   doc-mupor242l3cq).
 *
 *   WHY A SWITCH FOR THE MODE. The node starts a queued task without asking only for an agent whose
 *   mode is `task-runner` (services/agent-task-rules.ts). That is the most consequential setting an
 *   agent has, and it sat in a five-value mode word with a tooltip. Here it is one switch with the
 *   sentence of what it does. The five modes stay in the API; the switch moves a worker between
 *   `task-runner` and `autonomous` only, and is not shown for a chat connection (`interactive`,
 *   `workstation`) or a coordinator, whose mode means something else.
 * @structure FactsLine({ agent }) · AutonomyLine({ agent, showToast })
 * @usage <${FactsLine} agent=${agent} /> <${AutonomyLine} agent=${agent} showToast=${showToast} />
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiPatch } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { CardLine } from '/components/OpenCard.js';
import { Switch } from '/components/Switch.js';
import { agentFacts, placeOf } from './agent-facts.js';

const f = (key, vars) => t('profile.agents.facts.' + key, vars);

/** "Runs on … · thinks with … · paid by …", read from what the node knows (agent-facts.js). */
export function FactsLine({ agent }) {
  const facts = agentFacts(agent);
  const doneWeek = agent?.stats?.tasks?.doneWeek;
  return html`
    <${CardLine} label=${f('label')}>
      <span>${f('line', { runsOn: facts.runsOn, thinksWith: facts.thinksWith, paidBy: facts.paidBy })}</span>
    <//>
    ${typeof doneWeek === 'number' && html`<${CardLine} label=${f('weekLabel')}>
      <span>${doneWeek > 0 ? f('weekDone', { n: doneWeek }) : f('weekNone')}</span>
    <//>`}
  `;
}

/** The two modes the switch moves between; it never writes any other, so pressing twice returns. */
const SWITCHABLE = new Set(['task-runner', 'autonomous']);

/**
 * "Starts work by itself": on is `task-runner`, off is `autonomous`. Shown only for a worker: a chat
 * connection (`interactive`, `workstation`) answers while the person talks, and changing its mode
 * also changes its onboarding steps, which a browser check measured on 2026-10-01.
 */
export function AutonomyLine({ agent, showToast }) {
  const [mode, setMode] = useState(agent.mode || 'interactive');
  const [saving, setSaving] = useState(false);
  if (!SWITCHABLE.has(mode) || placeOf(agent) === 'chat') return null;
  const on = mode === 'task-runner';

  async function toggle() {
    if (saving) return;
    const next = on ? 'autonomous' : 'task-runner';
    const previous = mode;
    setSaving(true);
    setMode(next);
    try {
      await apiPatch(`/v1/agents/${encodeURIComponent(agent.name)}/mode`, { mode: next });
      showToast?.(next === 'task-runner' ? f('selfStartOnSaved') : f('selfStartOffSaved'), 'success');
    } catch (err) {
      // Put it back: a switch that disagrees with the node is worse than the failed write.
      setMode(previous);
      swallowed('agent-card: self-start', err);
      showToast?.(f('selfStartFailed'), 'error');
    } finally {
      setSaving(false);
    }
  }

  return html`
    <${CardLine} label=${f('selfStart')}>
      <${Switch} on=${on} onToggle=${toggle} label=${on ? f('yes') : f('no')} />
      <span>${on ? f('selfStartOn') : f('selfStartOff')}</span>
    <//>
  `;
}
