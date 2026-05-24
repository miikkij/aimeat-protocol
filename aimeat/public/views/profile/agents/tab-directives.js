/**
 * @file tab-directives.js
 * @description Simplified Directives tab -- behavioral instructions only.
 *   Memory areas and config files have moved to Data Access and Agent Config tabs.
 *   Wraps the existing directives subtab component.
 * @version-history
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 */

import { h } from 'preact';
import htm from 'htm';
import AgentDirectivesSubtab from '../agents-directives-subtab.js';

const html = htm.bind(h);

export default function TabDirectives({ agentName, session, showToast }) {
  return html`<${AgentDirectivesSubtab} agentName=${agentName} session=${session} showToast=${showToast} />`;
}
