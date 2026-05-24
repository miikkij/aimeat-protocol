/**
 * @file tab-tasks.js
 * @description Tasks tab wrapper for agent detail tab-view.
 *   Delegates to the existing AgentTasksSubtab component.
 * @version-history
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 */

import { h } from 'preact';
import htm from 'htm';
import AgentTasksSubtab from '../agents-tasks-subtab.js';

const html = htm.bind(h);

export default function TabTasks({ agentName, session, showToast }) {
  return html`<${AgentTasksSubtab} agentName=${agentName} session=${session} showToast=${showToast} />`;
}
