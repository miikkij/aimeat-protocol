/**
 * @file public/js/services/security.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Frontend service for the profile Security tab — manages GHII (owner-wide) and
 *   per-agent CORS allow-lists and lists/revokes active owner JWT sessions.
 *
 * @structure
 *   - getGhiiCors / setGhiiCors: owner-wide CORS allowed origins (null = allow all)
 *   - getAgentCors / setAgentCors: per-agent CORS allowed origins
 *   - listSessions / revokeSession / revokeAllSessions: active session management
 *   - loadAll(agents): aggregates GHII CORS + all agents' CORS in one call
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { apiGet, api } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

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

/** List active sessions for the authenticated owner. */
export async function listSessions() {
  const data = await apiGet('/v1/auth/sessions');
  return data?.data?.sessions || [];
}

/** Revoke a specific session by ID. */
export async function revokeSession(sessionId) {
  return api('/v1/auth/sessions/' + encodeURIComponent(sessionId), { method: 'DELETE' });
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
      } catch (err) { swallowed('security: loadAll', err); }
    }
  }
  return { ghii, agents: agentsCors };
}

/**
 * Composite mount for the Security tab: GHII CORS + per-agent CORS (resolved server-side, no per-agent
 * fan-out) + active sessions in ONE call. Returns { ghii, agents, sessions } or null on error so the
 * caller can fall back to the individual listAgents + loadAll + listSessions reads.
 */
export async function getSecurityOverview() {
  try {
    const data = await apiGet('/v1/security/overview');
    const d = data?.data;
    if (!d) return null;
    return { ghii: d.ghii ?? null, agents: d.agents || [], sessions: d.sessions || [] };
  } catch (err) { swallowed('security: getSecurityOverview', err); return null; }
}
