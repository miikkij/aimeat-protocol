/**
 * @file agent-card-run-mode.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How an agent is meant to be RUN: the badge that says what it is, and the switch that
 *   changes it.
 *
 *   PURE EXTRACTION from agent-card.js, which passed the 800-line cap when the switch was added.
 *   The badge came with it because they are one concern read two ways, and leaving them apart would
 *   mean the label and the control drifting on separate schedules.
 *
 * @structure renderRunModeBadge(agent) · RunModeSwitch({ agent, showToast })
 * @usage import { RunModeSwitch, renderRunModeBadge } from './agent-card-run-mode.js';
 * @version-history
 *   v1.0.0 — 2026-09-01 — Extracted with the switch (Agent v2, post-audit item 5).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiPatch } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

/**
 * How the agent is meant to be RUN, when anyone has said. Absent on every agent that predates the
 * field, and absence is not 'spawn' — an agent nobody has decided about should not be shown as
 * though somebody had, so there is no badge at all rather than a guessed one.
 */
export function renderRunModeBadge(agent) {
  const runMode = agent.run_mode;
  if (!runMode) return '';
  return html`<span class="pf-agd-badge pf-agd-badge--run pf-agd-badge--run-${runMode}" title=${t('profile.agents.runMode.tooltip') || ''}>${t(`profile.agents.runMode.${runMode}`) || runMode}</span>`;
}

/**
 * The run mode, as a control rather than a label.
 *
 * IT WAS READ-ONLY, which made the node's own answer unactionable: the fleet and the card both said
 * how an agent is meant to be run and there was nowhere to say otherwise except an API call. Two
 * buttons, because there are two values and a dropdown for two values is a click to find out what
 * the choices are.
 *
 * THE NODE STORES AND SHOWS THIS, AND NEVER ENFORCES IT — the runtime is the only party that can
 * honour it, the same rule maxConcurrentTasks follows. So the sentence under the buttons says what
 * pressing one actually does, rather than implying the node will start or stop anything.
 *
 * An agent nobody has decided about shows neither button pressed. Absence is not `spawn`, and
 * pre-selecting one would be the node deciding on the owner's behalf and then showing them their
 * own supposed choice.
 */
export function RunModeSwitch({ agent, showToast }) {
  const [runMode, setRunMode] = useState(agent.run_mode ?? null);
  const [saving, setSaving] = useState(false);

  async function choose(next) {
    if (saving || next === runMode) return;
    const previous = runMode;
    setSaving(true);
    setRunMode(next);
    try {
      await apiPatch(`/v1/agents/${encodeURIComponent(agent.name)}/run-mode`, { run_mode: next });
      showToast?.(next === null
        ? t('profile.agents.runMode.cleared')
        : t('profile.agents.runMode.saved').replace('{mode}', t(`profile.agents.runMode.${next}`)), 'success');
    } catch (err) {
      // Put it back: a switch that stays where the person moved it after the write failed is a
      // screen that disagrees with the node, which is worse than the failure.
      setRunMode(previous);
      swallowed('agent-card: run mode', err);
      showToast?.(t('profile.agents.runMode.failed'), 'error');
    } finally {
      setSaving(false);
    }
  }

  return html`
    <div class="pf-agd-runmode">
      <span class="pf-agd-runmode-label">${t('profile.agents.runMode.label')}</span>
      ${/* THREE CHOICES, NOT TWO, AND EVERY ONE OF THEM REACHABLE FROM EVERY OTHER. `unset` is on
            screen because it is a real state and the one an agent starts in: nobody has said, so a
            spawner leaves it alone. With two buttons a person could enter a decision and never
            leave it — a mistaken `spawn` put an agent on the roster for good, and the only way back
            was an API call nobody would find. crewaimeat-dev hit exactly that on 2026-09-03 and
            could not undo a test agent. `null` on the wire; the button is the third choice here. */''}
      <div class="pf-agd-runmode-choice" role="group" aria-label=${t('profile.agents.runMode.label')}>
        ${[['spawn', 'spawn'], ['resident', 'resident'], [null, 'unset']].map(([value, key]) => html`
          <button
            class="btn-outline btn-sm ${runMode === value ? 'is-on' : ''}"
            aria-pressed=${runMode === value ? 'true' : 'false'}
            disabled=${saving}
            onClick=${() => choose(value)}>
            ${t(`profile.agents.runMode.${key}`)}
          </button>
        `)}
      </div>
      <p class="pf-agd-runmode-note">${t('profile.agents.runMode.tooltip')}</p>
    </div>
  `;
}
