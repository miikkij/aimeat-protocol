/**
 * @file secretary/use-crew.js
 * @description P2-D — crew setup. A guided playbook for the Secretary to help the owner connect +
 *   configure their OTHER agents (the on-ramp to future specialist agents). It lists pending device-auth
 *   requests (GET /v1/agents/device-authorize/pending) and the owner's existing non-Secretary agents
 *   (GET /v1/agents), can APPROVE a pending request (POST /v1/agents/verify with the owner JWT) or deny
 *   it, and can set an agent's MODE (PATCH /v1/agents/:name/mode) and TAGS (PATCH /v1/agents/:name/tags).
 *   Re-fetches on the 'agents' live-update domain. See docs/plans/2026-06-24-secretary-p2-fix-prompt.md
 *   (P2-D) + §21; mirrors the approve UX in public/views/profile/agents-tab.js.
 * @structure useCrew({ showToast }) -> { pending, agents, loading, approve, deny, setMode, setTags, MODES, SCOPE_PRESETS }
 * @usage const crew = useCrew({ showToast }); crewCard(crew)
 * @version-history v0.1.0 — 2026-06-24 — P2-D: approve a pending agent + set mode/tags.
 */
import { useState, useEffect, useCallback } from 'preact/hooks';
import { apiGet, apiPost, apiPatch } from '/js/api.js';
import { t } from '/js/i18n.js';

export const MODES = ['interactive', 'autonomous', 'task-runner', 'coordinator', 'workstation'];
export const SCOPE_PRESETS = {
  readonly: ['memory:read', 'storage:read', 'catalogue:read', 'social:read'],
  standard: ['memory:read', 'memory:write', 'storage:read', 'storage:write', 'catalogue:read', 'social:read', 'work:request', 'work:read'],
};

function ownerJwt() {
  try { return (window.AIMEAT && window.AIMEAT.auth && window.AIMEAT.auth.getSession && window.AIMEAT.auth.getSession()?.jwt) || ''; }
  catch { return ''; }
}

export function useCrew({ showToast }) {
  const [pending, setPending] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [p, a] = await Promise.all([
        apiGet('/v1/agents/device-authorize/pending').catch(() => null),
        apiGet('/v1/agents').catch(() => null),
      ]);
      setPending((p && p.data && p.data.requests) || []);
      const list = (a && a.data && a.data.agents) || [];
      // Exclude the Secretary itself — this surface configures the owner's OTHER agents.
      setAgents(list.filter((ag) => !(ag.tags || []).includes('system:secretary') && ag.name !== 'secretary'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const handler = (e) => {
      const d = e.detail && e.detail.domains;
      if (!d || d.has('agents')) refresh();
    };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [refresh]);

  const approve = useCallback(async (userCode, preset) => {
    const scopes = SCOPE_PRESETS[preset] || SCOPE_PRESETS.standard;
    try {
      const r = await apiPost('/v1/agents/verify', { user_code: userCode, action: 'approve', scopes, owner_token: ownerJwt() });
      if (r && r.ok === false) throw new Error((r.error && r.error.message) || t('secretary.crew.approveError'));
      showToast(t('secretary.crew.approved'));
      await refresh();
    } catch (e) {
      showToast(`${t('secretary.crew.approveError')}: ${e.message}`, true);
    }
  }, [refresh, showToast]);

  const deny = useCallback(async (userCode) => {
    try {
      await apiPost('/v1/agents/verify', { user_code: userCode, action: 'deny', owner_token: ownerJwt() });
      showToast(t('secretary.crew.denied'));
      await refresh();
    } catch (e) {
      showToast(`${t('secretary.crew.approveError')}: ${e.message}`, true);
    }
  }, [refresh, showToast]);

  const setMode = useCallback(async (name, mode) => {
    try {
      await apiPatch(`/v1/agents/${encodeURIComponent(name)}/mode`, { mode });
      showToast(t('secretary.crew.configured'));
      await refresh();
    } catch (e) {
      showToast(`${t('secretary.crew.configError')}: ${e.message}`, true);
    }
  }, [refresh, showToast]);

  const setTags = useCallback(async (name, tagsText) => {
    const tags = String(tagsText || '').split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    try {
      await apiPatch(`/v1/agents/${encodeURIComponent(name)}/tags`, { tags });
      showToast(t('secretary.crew.configured'));
      await refresh();
    } catch (e) {
      showToast(`${t('secretary.crew.configError')}: ${e.message}`, true);
    }
  }, [refresh, showToast]);

  return { pending, agents, loading, approve, deny, setMode, setTags, MODES, SCOPE_PRESETS };
}
