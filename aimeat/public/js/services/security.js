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
 *   - totpSetup / totpVerify / totpDisable / totpRegenerateBackupCodes: two-step sign-in
 *   - listPasskeys / renamePasskey / deletePasskey: the devices that can sign in
 *   - loadAll(agents): aggregates GHII CORS + all agents' CORS in one call
 *
 * @version-history
 *   v1.3.0 — 2026-09-04 — The three passkey calls. The ceremony stays in the auth lib.
 *   v1.2.0 — 2026-09-04 — The four TOTP calls, and two_factor carried through the overview. The
 *     routes had been live since July with nothing in the SPA reaching them.
 *   v1.1.0 — 2026-08-24 — The overview carries managed_by through (BR-04): the field was served
 *     and this shaping dropped it, so the "signed in through your organisation" row never rendered.
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

// ── Two-step sign-in (TOTP) ──
// The secret, the QR image and the backup codes exist in ONE response each, and the server keeps no
// readable copy. Whatever calls these owns showing them before the state moves on.

/** Begin setup: returns { totp_secret, totp_uri, qr_data_url, backup_codes }. Not active until verified. */
export async function totpSetup() {
  const data = await api('/v1/ghii/totp/setup', { method: 'POST', body: '{}' });
  return data?.data || {};
}

/** Confirm setup with a code from the authenticator app. This is what arms the factor. */
export async function totpVerify(code) {
  return api('/v1/ghii/totp/verify', { method: 'POST', body: JSON.stringify({ code }) });
}

/**
 * Turn it off. Needs a current code or one unused backup code: pass exactly one.
 * @param {{ code?: string, backupCode?: string }} answer
 */
export async function totpDisable({ code, backupCode }) {
  return api('/v1/ghii/totp', {
    method: 'DELETE',
    body: JSON.stringify(code ? { code } : { backup_code: backupCode }),
  });
}

/** Mint a fresh set of backup codes. The old ones stop working the moment this returns. */
export async function totpRegenerateBackupCodes(code) {
  return api('/v1/ghii/totp/backup-codes', { method: 'POST', body: JSON.stringify({ code }) });
}

// ── Passkeys ──
// The ceremony itself is not here: adding a device goes through AIMEAT.auth.addPasskey(), the same
// browser code the sign-in modal runs, so the WebAuthn plumbing has one home. What is left is the
// three plain reads and writes around it.

/** The devices that can sign in as this person, and whether this node offers passkeys at all. */
export async function listPasskeys() {
  const data = await apiGet('/v1/ghii/passkeys');
  return data?.data || { passkeys: [], count: 0, available: false };
}

/** Rename one. Scoped to the caller's own account by the route. */
export async function renamePasskey(id, label) {
  return api('/v1/ghii/passkeys/' + encodeURIComponent(id), {
    method: 'PATCH', body: JSON.stringify({ label }),
  });
}

/** Take a device away. */
export async function deletePasskey(id) {
  return api('/v1/ghii/passkeys/' + encodeURIComponent(id), { method: 'DELETE' });
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
    return {
      ghii: d.ghii ?? null,
      agents: d.agents || [],
      sessions: d.sessions || [],
      managed_by: d.managed_by ?? null,
      two_factor: d.two_factor ?? null,
    };
  } catch (err) { swallowed('security: getSecurityOverview', err); return null; }
}
