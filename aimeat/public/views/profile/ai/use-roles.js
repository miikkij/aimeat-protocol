/**
 * @file public/views/profile/ai/use-roles.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The state and handlers behind the AI page's roles section (wish-tekoalyn-roolit): the
 *   read (GET /v1/ai/roles: the owner's roles and the roles apps declare, with the bindings) and the
 *   writes (add or change a role: its title, purpose, and for each capability the providers and models
 *   to try in order; remove a role; bind an app's role to one of the owner's, or unbind it). Every write
 *   is the owner's and applies at once. The render is ai/roles-section.js.
 * @structure useRoles() → rl (state + handlers) · MAX_PLACES
 * @usage const rl = useRoles({ confirm, toast }); … secRoles(ctx) reads ctx.rl
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial.
 */
import { useState, useEffect, useCallback } from 'preact/hooks';
import { apiGet, apiPut } from '/js/api.js';
import { x } from './frame.js';
import { slug } from './use-providers.js';

/** The places a role's order shows per capability. The server takes up to five. */
export const MAX_PLACES = 3;

const flashFor = (setter) => (text, error = false) => { setter({ text, error }); setTimeout(() => setter(null), 6000); };
const errText = (e, fallback) => e?.error?.message || e?.response?.error?.message || e?.message || fallback;

/** A role as the editor holds it: capability → places of { provider, model }. */
function draftOf(role) {
  const caps = {};
  for (const [c, list] of Object.entries(role?.capabilities || {})) caps[c] = (list || []).map((e) => ({ provider: e.provider, model: e.model || '' }));
  return {
    id: role?.id || '', title: role?.title || '', purpose: role?.purpose || '', caps,
    local: !!role?.local, maxCost: role?.maxCostPerCallUsd != null ? String(role.maxCostPerCallUsd) : '', isNew: !role,
  };
}

export function useRoles({ confirm, toast, reloadProviders }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [draft, setDraftState] = useState(null);
  const [bindDraft, setBindDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [appMsg, setAppMsg] = useState(null);

  const load = useCallback(async () => {
    const r = await apiGet('/v1/ai/roles').catch((e) => ({ ok: false, error: { message: e?.message } }));
    if (r && r.ok !== false && r.data) { setView(r.data); setError(null); } else setError(errText(r, x('rl.loadFailed')));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  const roles = view?.roles || [];
  const apps = view?.apps || [];
  const waiting = apps.flatMap((a) => a.roles).filter((r) => !r.boundTo).length;

  const open = (id) => {
    if (openId === id) { setOpenId(null); setDraftState(null); return; }
    setOpenId(id);
    setDraftState(draftOf(id === '__new' ? null : roles.find((r) => r.id === id)));
  };
  const setDraft = (patch) => setDraftState((d) => ({ ...d, ...patch }));
  /** Put a provider (or '' to drop the place and those after it) at a place of one capability. */
  const setPlace = (c, i, patch) => setDraftState((d) => {
    const list = [...(d.caps[c] || [])];
    if (patch.provider === '') return { ...d, caps: { ...d.caps, [c]: list.slice(0, i) } };
    list[i] = { ...(list[i] || { provider: '', model: '' }), ...patch };
    return { ...d, caps: { ...d.caps, [c]: list } };
  });
  const addCapability = (c) => setDraftState((d) => (c && !d.caps[c] ? { ...d, caps: { ...d.caps, [c]: [] } } : d));
  const dropCapability = (c) => setDraftState((d) => { const caps = { ...d.caps }; delete caps[c]; return { ...d, caps }; });

  const save = async () => {
    const flash = flashFor(setMsg);
    const id = draft.isNew ? slug(draft.title) : draft.id;
    if (!id) { flash(x('rl.nameNeeded'), true); return; }
    if (draft.isNew && roles.some((r) => r.id === id)) { flash(x('rl.nameTaken', { id }), true); return; }
    const cost = draft.maxCost.trim();
    if (cost !== '' && !(Number(cost) >= 0)) { flash(x('rt.costRange'), true); return; }
    const capabilities = Object.fromEntries(Object.entries(draft.caps).map(([c, list]) => [c, list.filter((e) => e.provider).map((e) => ({ provider: e.provider, ...(e.model.trim() ? { model: e.model.trim() } : {}) }))]));
    const role = {
      title: draft.title.trim() || id, ...(draft.purpose.trim() ? { purpose: draft.purpose.trim() } : {}),
      capabilities, ...(draft.local ? { local: true } : {}), maxCostPerCallUsd: cost === '' ? null : Number(cost),
    };
    setBusy('role');
    try {
      const r = await apiPut('/v1/ai/roles', { roles: { [id]: role } });
      if (r?.ok === false) throw r;
      flash(x('rl.saved', { name: role.title }));
      setOpenId(null); setDraftState(null);
      await load();
    } catch (e) { flash(errText(e, x('saveFailed')), true); }
    setBusy(false);
  };

  const remove = (role) => {
    confirm(x('rl.confirmDelete', { name: role.title }), async () => {
      try {
        const r = await apiPut('/v1/ai/roles', { roles: { [role.id]: null } });
        if (r?.ok === false) throw r;
        setOpenId(null); setDraftState(null);
        toast(x('rl.deleted', { name: role.title }));
        await load();
      } catch (e) { toast(errText(e, x('saveFailed')), true); }
    }, { danger: true });
  };

  /** Bind an app's role to one of the owner's (their approval), or unbind it with ''. */
  const bind = async (binding, roleId) => {
    const flash = flashFor(setAppMsg);
    setBusy('bind');
    try {
      const r = await apiPut('/v1/ai/roles', { bindings: { [binding]: roleId || null } });
      if (r?.ok === false) throw r;
      flash(roleId ? x('rl.bound', { role: roles.find((q) => q.id === roleId)?.title || roleId }) : x('rl.unbound'));
      setBindDraft((d) => { const n = { ...d }; delete n[binding]; return n; });
      await load();
    } catch (e) { flash(errText(e, x('saveFailed')), true); }
    setBusy(false);
  };

  return {
    view, error, roles, apps, waiting, openId, draft, bindDraft, busy, msg, appMsg,
    load, open, setDraft, setPlace, addCapability, dropCapability, save, remove, bind,
    setBindDraft: (k, v) => setBindDraft((d) => ({ ...d, [k]: v })), reloadProviders,
  };
}
