/**
 * AIMEAT Agents Service
 * Agent CRUD, scope management, and chat sessions.
 */
import { apiGet, apiPost, apiDelete, api } from '/js/api.js';

/** List agents owned by the given owner. Returns array. */
export async function listAgents(owner) {
  const data = await apiGet('/v1/agents');
  const list = data?.data?.agents || data?.data || [];
  return owner ? list.filter(a => a.owner === owner) : list;
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
    method: 'PUT',
    body: JSON.stringify({ scopes }),
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
