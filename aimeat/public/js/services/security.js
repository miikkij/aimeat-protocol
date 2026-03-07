/**
 * AIMEAT Security Service
 * GHII CORS and per-agent CORS management.
 */
import { apiGet, api } from '/js/api.js';

/** Load GHII CORS settings. */
export async function getGhiiCors() {
  const data = await apiGet('/v1/ghii/cors');
  return data?.data || {};
}

/** Update GHII CORS allowed origins. Pass null to allow all. */
export async function setGhiiCors(origins) {
  return api('/v1/ghii/cors', {
    method: 'PUT',
    body: JSON.stringify({ allowed_origins: origins }),
  });
}

/** Load CORS settings for a specific agent. */
export async function getAgentCors(agentName) {
  const data = await apiGet('/v1/agents/' + encodeURIComponent(agentName) + '/cors');
  return data?.data || {};
}

/** Update CORS settings for a specific agent. Pass null to allow all. */
export async function setAgentCors(agentName, origins) {
  return api('/v1/agents/' + encodeURIComponent(agentName) + '/cors', {
    method: 'PUT',
    body: JSON.stringify({ allowed_origins: origins }),
  });
}

/** Revoke all active JWT sessions for the authenticated owner. */
export async function revokeAllSessions() {
  return api('/v1/auth/sessions', { method: 'DELETE' });
}

/**
 * Load full security data: GHII CORS + all agent CORS settings.
 * @param {Array} agents - List of agent objects (must have .name)
 */
export async function loadAll(agents) {
  const ghii = await getGhiiCors();
  const agentsCors = [];
  if (agents) {
    for (const ag of agents) {
      try {
        const cors = await getAgentCors(ag.name);
        agentsCors.push(cors);
      } catch { /* skip */ }
    }
  }
  return { ghii, agents: agentsCors };
}
