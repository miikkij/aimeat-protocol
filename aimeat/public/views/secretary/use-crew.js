/**
 * @file secretary/use-crew.js
 * @description P2-D — crew setup. A guided playbook for the Secretary to help the owner connect +
 *   configure their OTHER agents (the on-ramp to future specialist agents). It lists pending device-auth
 *   requests (GET /v1/agents/device-authorize/pending) and the owner's existing non-Secretary agents
 *   (GET /v1/agents), can APPROVE a pending request (POST /v1/agents/verify with the owner JWT) or deny
 *   it, and can set an agent's MODE (PATCH /v1/agents/:name/mode) and TAGS (PATCH /v1/agents/:name/tags).
 *   Re-fetches on the 'agents' live-update domain. See docs/plans/2026-06-24-secretary-p2-fix-prompt.md
 *   (P2-D) + §21; mirrors the approve UX in public/views/profile/agents-tab.js.
 * @structure useCrew({ showToast }) -> { pending, agents, loading, approve, deny, setMode, setTags,
 *   newSpec, setNewSpec, createSpec, consent, toggleExtra, grantExtras, dismissConsent,
 *   MODES, SCOPE_PRESETS, SPECIALIST_ROLES }
 * @usage const crew = useCrew({ showToast }); crewCard(crew)
 * @version-history
 *   v0.2.0 — 2026-06-25 — Scope-consent: provision a SPECIALIST (POST /v1/specialists) and, when the chosen
 *     role has requestable extras, present an owner-consent checklist → grant a subset (a second POST with
 *     approved_scopes). Conservative by default; nothing granted without consent.
 *   v0.1.0 — 2026-06-24 — P2-D: approve a pending agent + set mode/tags.
 */
import { useState, useEffect, useCallback } from 'preact/hooks';
import { apiGet, apiPost, apiPatch } from '/js/api.js';
import { createSpecialist } from '/js/services/agents.js';
import { t } from '/js/i18n.js';

export const MODES = ['interactive', 'autonomous', 'task-runner', 'coordinator', 'workstation'];
/** The specialist roles the owner can provision (mirrors src/mcp/catalog/scopes.ts SPECIALIST_ROLES). */
export const SPECIALIST_ROLES = ['specialist', 'sdr', 'prep', 'finance', 'recruiter'];
export const SCOPE_PRESETS = {
  readonly: ['memory:read', 'storage:read', 'catalogue:read', 'social:read'],
  standard: ['memory:read', 'memory:write', 'storage:read', 'storage:write', 'catalogue:read', 'social:read', 'work:request', 'work:read'],
};

function ownerJwt() {
  try { return (window.AIMEAT && window.AIMEAT.auth && window.AIMEAT.auth.getSession && window.AIMEAT.auth.getSession()?.jwt) || ''; }
  catch { return ''; }
}

const EMPTY_SPEC = { name: '', role: 'sdr', displayName: '', creating: false };

export function useCrew({ showToast }) {
  const [pending, setPending] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  // Add-a-specialist form + the owner-consent step (set after a create surfaces requestable extras).
  const [newSpec, setNewSpec] = useState(EMPTY_SPEC);
  const [consent, setConsent] = useState(null); // { name, role, extras:[{scope,description}], checked:[], granting }

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

  // ── Provision a specialist (declare → consent → grant) ──
  // Step 1: create CONSERVATIVELY (no approved_scopes). If the role surfaces requestable extras, open the
  // consent checklist; otherwise we're done. Nothing beyond the safe default is ever granted here.
  const createSpec = useCallback(async () => {
    const name = String(newSpec.name || '').trim().toLowerCase();
    if (!name) return;
    setNewSpec((s) => ({ ...s, creating: true }));
    try {
      const r = await createSpecialist({ name, role: newSpec.role, displayName: newSpec.displayName });
      if (r && r.ok === false) throw new Error((r.error && r.error.message) || t('secretary.crew.specError'));
      const spec = (r && r.data && r.data.specialist) || {};
      const extras = spec.requestable_extras || [];
      showToast(t('secretary.crew.specCreated'));
      if (extras.length) {
        setConsent({ name: spec.name || name, role: newSpec.role, extras, checked: [], granting: false });
      }
      setNewSpec(EMPTY_SPEC);
      await refresh();
    } catch (e) {
      showToast(`${t('secretary.crew.specError')}: ${e.message}`, true);
      setNewSpec((s) => ({ ...s, creating: false }));
    }
  }, [newSpec, refresh, showToast]);

  const toggleExtra = useCallback((scope) => {
    setConsent((c) => {
      if (!c) return c;
      const checked = c.checked.includes(scope) ? c.checked.filter((s) => s !== scope) : [...c.checked, scope];
      return { ...c, checked };
    });
  }, []);

  // Step 2: grant the owner-approved subset (a second POST with approved_scopes — idempotent re-provision
  // applies the extras). The server filters approved ⊆ requestable, so this can never widen the grant.
  const grantExtras = useCallback(async () => {
    if (!consent || !consent.checked.length) { setConsent(null); return; }
    setConsent((c) => ({ ...c, granting: true }));
    try {
      const r = await createSpecialist({ name: consent.name, role: consent.role, approvedScopes: consent.checked });
      if (r && r.ok === false) throw new Error((r.error && r.error.message) || t('secretary.crew.specError'));
      showToast(t('secretary.crew.extrasGranted'));
      setConsent(null);
      await refresh();
    } catch (e) {
      showToast(`${t('secretary.crew.specError')}: ${e.message}`, true);
      setConsent((c) => (c ? { ...c, granting: false } : c));
    }
  }, [consent, refresh, showToast]);

  const dismissConsent = useCallback(() => setConsent(null), []);

  return {
    pending, agents, loading, approve, deny, setMode, setTags,
    newSpec, setNewSpec, createSpec, consent, toggleExtra, grantExtras, dismissConsent,
    MODES, SCOPE_PRESETS, SPECIALIST_ROLES,
  };
}
