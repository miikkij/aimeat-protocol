/**
 * @file tab-services.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Services tab -- declared services list with active/inactive status.
 *   Wraps the existing services subtab component.
 * @version-history
 *   2026-10-15 — Passes the agent's GAII to the services list, which asks the server by exact identity (feature-list audit #80).
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 */

import { h } from 'preact';
import htm from 'htm';
import AgentServicesSubtab from '../agents-services-subtab.js';

const html = htm.bind(h);

export default function TabServices({ agent, agentName, session, showToast }) {
  return html`<${AgentServicesSubtab} agentName=${agentName} agentGaii=${agent?.gaii} session=${session} showToast=${showToast} />`;
}
