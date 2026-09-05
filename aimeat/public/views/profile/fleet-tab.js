/**
 * @file fleet-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description "Your agents" in Settings & Controls: everything the Agent v2 work produced, in the
 *   one place a person already goes to change things.
 *
 *   IT WAS IN THREE PLACES. The fleet was its own page behind a sidebar link that sat above the
 *   menu rather than in it; the button that makes the basic agents was inside the OLD Agents tab,
 *   which is about one agent at a time; and the two had nothing to do with each other on screen. A
 *   capability a person has to be TOLD the address of is not finished.
 *
 *   IT IS NOT A FOURTH SURFACE. Both halves are the components that already existed, mounted here:
 *   FleetView with `embedded` (the list, the credential health, the run mode, the migration) and
 *   BasicAgentsPanel (the button). /v1/fleet still resolves, so an existing link or bookmark is not
 *   broken; this is where the menu now takes you.
 *
 *   THE OLD AGENTS TAB IS UNTOUCHED. It answers "what about this one" — tags, trust, tasks, the
 *   connect flow — and every row here links into it. This one answers "which one should I look at",
 *   which is the question that had no surface at all.
 *
 * @structure FleetTab (default) — section header, the button, then the fleet
 * @usage registered in views/profile.js TABS as `fleet`, listed in the Automation group of
 *   SIDEBAR_GROUPS (landing-page.cards.js).
 * @version-history
 *   v1.1.0 — 2026-09-05 — The agent defaults (the rules every agent carries, the token budget) sit
 *     at the foot of this page. They lived on the Access page, which is about who holds a key to
 *     the account; a rule that says "always answer in Finnish" is about the agents, and this is
 *     where the agents are (design canvas "AIMEAT Pääsy-sivu", decision 9).
 *   v1.0.0 — 2026-09-03 — Initial: the Agents v2 section moves into Settings & Controls.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import FleetView from '/views/fleet.js';
import BasicAgentsPanel from '/views/profile/agents/basic-agents-panel.js';
import { AgentDefaultsSection } from './agents/agent-defaults-section.js';

export default function FleetTab({ session, showToast }) {
  return html`
    <div class="pf-fleet-tab">
      <h2 class="section-title">${t('profile.tabs.fleet')}</h2>
      <p class="section-desc">${t('fleet.desc')}</p>

      ${/* THE STARTER CARD IS A SLOT, NOT A HEADER. It sat above the fleet at first, and on a
            1280x460 screen the whole first view was an invitation to create MORE agents while
            eighteen were locked out. FleetView places it under the alarm when there is one and at
            the top when there is not, which is the right order in both cases.

            `emphasis="secondary"`: two .btn-primary buttons, both disabled because the connector is
            down, made the page's two loudest controls the two that do nothing. The fix is which one
            leads, not what either says. The old Agents tab passes nothing and keeps its primary. */''}
      ${/* `embedded`: the section header above is this view's heading, so it does not bring its own. */''}
      <${FleetView} embedded starter=${html`<${BasicAgentsPanel} session=${session} showToast=${showToast} emphasis="secondary" />`} />
      ${/* The rules every agent carries unless its own directives say otherwise, and the token budget.
            At the foot: a person comes here for the agents first, and the defaults are the one thing
            on this page that is about all of them at once. */''}
      <${AgentDefaultsSection} showToast=${showToast} />
    </div>
  `;
}
