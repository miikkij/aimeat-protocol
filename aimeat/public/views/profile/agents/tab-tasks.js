/**
 * @file tab-tasks.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Tasks tab wrapper for agent detail tab-view.
 *   Delegates to the existing AgentTasksSubtab component.
 * @version-history
 *   v1.2.0 -- 2026-06-03 -- Forward openTaskId + openTaskNonce so the fleet
 *     "running now" panel can deep-link straight to a specific task.
 *   v1.1.0 -- 2026-06-01 -- Forward the `agent` object so the subtab can show the
 *     max_concurrent_tasks runner config.
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 */

import { h } from 'preact';
import htm from 'htm';
import AgentTasksSubtab from '../agents-tasks-subtab.js';

const html = htm.bind(h);

export default function TabTasks({ agent, agentName, session, showToast, openTaskId, openTaskNonce }) {
  return html`<${AgentTasksSubtab} agent=${agent} agentName=${agentName} session=${session} showToast=${showToast}
    openTaskId=${openTaskId} openTaskNonce=${openTaskNonce} />`;
}
