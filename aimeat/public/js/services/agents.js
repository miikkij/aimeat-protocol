/**
 * @file public/js/services/agents.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Frontend service layer for agent management — lists/deletes agents, edits scopes,
 *   CORS, and concurrency; agent groups; chat sessions/instances; and workspace-contract tagging +
 *   one-click contract adoption tasks.
 *
 * @structure
 *   - listAgents / deleteAgent / updateAgentScopes / setMaxConcurrentTasks: agent CRUD + config
 *   - getAgentCors / setAgentCors: per-agent CORS origins
 *   - offersWorkspaceContract / contractNamesOf / adoptContractTask / getAgentEngagements: workspace-contract tags
 *   - getAgentGroups / saveAgentGroups: owner-scoped custom agent grouping (memory `agents.groups`)
 *   - listChatSessions / listChatInstances / deleteChatInstance: chat/MCP session management
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { apiGet, apiPost, apiDelete, api } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

/**
 * List agents owned by the given owner. Returns array.
 * @param {string} [owner] filter to this owner
 * @param {{ include?: string }} [opts] `include:'stats'` attaches a per-agent `stats` projection
 *   (task/message counts + latest timestamps + active_tasks + onboarding) in ONE request,
 *   replacing the old N+1 per-agent fan-out.
 */
export async function listAgents(owner, opts = {}) {
  const qs = opts.include ? `?include=${encodeURIComponent(opts.include)}` : '';
  const data = await apiGet(`/v1/agents${qs}`);
  const list = data?.data?.agents || data?.data || [];
  return owner ? list.filter(a => a.owner === owner) : list;
}

/** Workspace-contract advertising via agent tags (this convention is dot-based so 'contract.<name>'
 *  parses by prefix; the server tag pattern is [a-z0-9._:-], colons allowed, no '@'): the tag
 *  'workspace-contract' marks an agent as a contract provider, and 'contract.<name>' tags name the
 *  contract(s) it serves. Convention documented in
 *  docs/agent-workspace-contracts.md; agents set tags via aimeat_agent_tags_set / PATCH tags. */
export const offersWorkspaceContract = (a) => (a?.tags || []).includes('workspace-contract');

/** The contract names an agent advertises ('contract.<name>' tags, prefix stripped). */
export const contractNamesOf = (a) => (a?.tags || [])
  .filter(tg => String(tg).startsWith('contract.'))
  .map(tg => String(tg).slice('contract.'.length));

/** One-click contract adoption: queue the agreed adopt-contract TASK for one of the owner's
 *  agents. The agent recognises it from scope[kind]='adopt-contract' (NOT the title), joins the
 *  organism if needed, provisions its contract's spaces itself (workspace_update add_spaces from
 *  its OWN contract declaration — §2 of the guide), and completes the task with what was added.
 *  Convention: docs/agent-workspace-contracts.md §7c — agreed with the crewaimeat side 2026-06-10. */
export async function adoptContractTask(agentName, { organismId, ws, contract }) {
  const { createTask } = await import('/js/services/agent-tasks.js');
  return createTask(agentName, {
    title: `adopt-contract: ${contract || 'workspace-contract'} → ${ws}`,
    description: `Adopt your '${contract || ''}' contract into workspace ${ws} of organism ${organismId}: join the organism if needed, provision the contract's spaces (workspace_update add_spaces from your own contract declaration), then complete this task with what was added.`,
    // 'queued' is REQUIRED: without it the task is created as a draft and never auto-activates.
    // A task-runner-mode agent flips queued → active immediately (push over the tunnel); other
    // modes keep the standard queued → owner-start gate. (crewaimeat live-test finding 2026-06-10.)
    status: 'queued',
    scope: [
      { name: 'kind', value: 'adopt-contract', type: 'text' },
      { name: 'organism_id', value: organismId, type: 'text' },
      { name: 'ws', value: ws, type: 'text' },
      ...(contract ? [{ name: 'contract', value: contract, type: 'text' }] : []),
    ],
  });
}

/** The agent's contract engagements across every organism/workspace (active + retired), enriched
 *  with organism + workspace display names. Powers the agent-detail Contracts tab. Returns array. */
export async function getAgentEngagements(agentName) {
  try {
    const data = await apiGet(`/v1/agents/${encodeURIComponent(agentName)}/engagements`);
    return Array.isArray(data?.data?.engagements) ? data.data.engagements : [];
  } catch (err) { swallowed('agents: getAgentEngagements', err); return []; }
}

/** List chat session agents (name starts with 'session-'). */
export async function listChatSessions(owner) {
  const agents = await listAgents(owner);
  return agents.filter(a => a.name?.startsWith('session-'));
}

/** Delete an agent by name. */
export async function deleteAgent(name) {
  return apiDelete(`/v1/agents/${encodeURIComponent(name)}`);
}

/** Update agent scopes. */
export async function updateAgentScopes(name, scopes) {
  return api(`/v1/agents/${encodeURIComponent(name)}/scopes`, {
    method: 'PATCH',
    body: JSON.stringify({ scopes }),
  });
}

/** Set how many tasks the agent's runner may process concurrently (1–20). */
export async function setMaxConcurrentTasks(name, max) {
  return api(`/v1/agents/${encodeURIComponent(name)}/max-concurrent-tasks`, {
    method: 'PATCH',
    body: JSON.stringify({ max_concurrent_tasks: max }),
  });
}

/** Get agent CORS origins. */
export async function getAgentCors(name) {
  const data = await apiGet(`/v1/agents/${encodeURIComponent(name)}/cors`);
  return data?.data || {};
}

/** Set agent CORS origins. */
export async function setAgentCors(name, origins) {
  return api(`/v1/agents/${encodeURIComponent(name)}/cors`, {
    method: 'PUT',
    body: JSON.stringify({ allowed_origins: origins }),
  });
}

/** Custom agent groups (sections) for the Agents tab. Stored server-side in the
 *  owner's memory at `agents.groups` so the grouping follows the owner across
 *  devices/browsers. A group is { id, name, agents: [agentName] }; an agent
 *  belongs to at most one group, and any agent not listed in a group renders
 *  under "Ungrouped". The per-browser collapsed/expanded state is NOT stored
 *  here — it lives in localStorage (see agents-tab.js). */
export async function getAgentGroups() {
  try {
    const resp = await apiGet('/v1/memory?prefix=agents.groups');
    const item = (resp?.data?.items || []).find(i => i.key === 'agents.groups');
    return Array.isArray(item?.value?.groups) ? item.value.groups : [];
  } catch (err) { swallowed('agents: item', err); return []; }
}

/** Persist the owner's custom agent groups. */
export async function saveAgentGroups(groups) {
  return apiPost('/v1/memory', { key: 'agents.groups', value: { groups }, visibility: 'private' });
}

/** List chat instances (includes MCP sessions). Returns array. */
export async function listChatInstances() {
  const data = await apiGet('/v1/chat-instances');
  const list = data?.data?.chat_instances || [];
  return Array.isArray(list) ? list : [];
}

/** Delete a chat instance. */
export async function deleteChatInstance(id) {
  return apiDelete(`/v1/chat-instances/${encodeURIComponent(id)}`);
}
