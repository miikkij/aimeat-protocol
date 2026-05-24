/**
 * @file tab-services.js
 * @description Services tab -- declared services list with active/inactive status.
 *   Wraps the existing services subtab component.
 * @version-history
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 */

import { h } from 'preact';
import htm from 'htm';
import AgentServicesSubtab from '../agents-services-subtab.js';

const html = htm.bind(h);

export default function TabServices({ agentName, session, showToast }) {
  return html`<${AgentServicesSubtab} agentName=${agentName} session=${session} showToast=${showToast} />`;
}
