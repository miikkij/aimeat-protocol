/**
 * @file public/views/profile/agents/gaii-chip.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The agent's GAII as a control, for an agent record: the control itself is the
 *   component GaiiChip (components/GaiiChip.js); this module reads the GAII off the agent, as the
 *   agent list and the design lab call it.
 * @structure GaiiChip({ agent })
 * @usage import { GaiiChip } from './gaii-chip.js';
 *   html`<${GaiiChip} agent=${agent} />`
 * @version-history
 *   v1.1.0 — 2026-09-26 — The control moved to components/GaiiChip.js; this is the agent's door to
 *     it and takes no class any more (page group G1a).
 *   v1.0.0 — 2026-09-06 — Initial: the copy control the board's ID card already carried, in a form
 *     the agent list rows can wear.
 */
import { h } from 'preact';
import htm from 'htm';
import { GaiiChip as Chip } from '/components/GaiiChip.js';
import { agentGaii } from './tab-helpers.js';

const html = htm.bind(h);

/** GaiiChip — the agent's full GAII, click to copy. @param {{ agent: object }} props */
export function GaiiChip({ agent }) {
  return html`<${Chip} gaii=${agentGaii(agent)} />`;
}
