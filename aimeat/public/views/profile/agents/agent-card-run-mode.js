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
 * @structure RunModeSwitch({ agent, showToast })
 * @usage import { RunModeSwitch } from './agent-card-run-mode.js';
 * @version-history
 *   v1.5.0 — 2026-09-26 — The three choices are the Choice (components/Choice.js: the tabs, the chosen
 *     one on the sun, the arrow keys, its hint under it); the page writes no class (page group G1a).
 *   v1.4.0 — 2026-09-26 — renderRunModeBadge goes: nothing called it (Jouni: "saat poistaa jos ne on oikeasti käyttämättömiä").
 *   v1.3.0 — 2026-09-25 — Every row label is the Row label (.poster-label), a unification: Jouni's decision Row label.
 *   v1.2.0 — 2026-09-25 — A grey help note is the Hint (poster-hint, components/Hint.js), as every other Settings hint (UI consolidation phase 5, a unification).
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   v1.1.0 — 2026-09-14 — The three buttons are the shared choice group (og-choice), the pressed one on
 *     the sun, so the switch looks like the same control everywhere on the poster face.
 *   v1.0.0 — 2026-09-01 — Extracted with the switch (Agent v2, post-audit item 5).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiPatch } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { Choice } from '/components/Choice.js';

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

  // The row label is the card's line this switch opens under (agent-card.js CardLine), so the switch
  // names itself only to a screen reader; on main the page hid its own label for the same reason.
  //
  // THREE CHOICES, NOT TWO, AND EVERY ONE OF THEM REACHABLE FROM EVERY OTHER. `unset` is on
  // screen because it is a real state and the one an agent starts in: nobody has said, so a
  // spawner leaves it alone. With two buttons a person could enter a decision and never
  // leave it — a mistaken `spawn` put an agent on the roster for good, and the only way back
  // was an API call nobody would find. crewaimeat-dev hit exactly that on 2026-09-03 and
  // could not undo a test agent. `null` on the wire; the button is the third choice here.
  return html`
    <${Choice} ariaLabel=${t('profile.agents.runMode.label')} value=${runMode} disabled=${saving}
      options=${[['spawn', 'spawn'], ['resident', 'resident'], [null, 'unset']].map(([value, key]) => ({ value, label: t(`profile.agents.runMode.${key}`) }))}
      onChange=${choose}
      hint=${t('profile.agents.runMode.tooltip')} />
  `;
}
