/**
 * @file capabilities-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab: the agent's view of this node. Everything an agent can find here by name
 *   and call or commission, from GET /v1/capabilities, grouped by whoever provides it: an extension
 *   with its actions, an app with its tools, an agent with its offers, a hand-added webhook. This
 *   file is the state and the handlers (open a provider, try an action through the invoke proxy,
 *   copy the agent's text, vouch, hide from agents, add or remove a hand-added one); the render is
 *   capabilities/page.js and capabilities/rows.js.
 * @structure CapabilitiesTab() — state (caps, policy, details, filters, queries, expanded, test, form) + handlers → renderPage(ctx)
 * @usage registered in profile.js TABS as id 'capabilities'.
 * @version-history
 *   v3.0.0 — 2026-09-03 — Poster face (design canvas "AIMEAT Kyvykkyydet-sivu", direction A):
 *     rows grouped by provider instead of one flat list of every action; app tools and agent offers
 *     now in the registry; cortexes left to the Libraries page; the try, vouch, hide and remove doors
 *     the API had and the page lacked; the policy said in sentences; the agent's rule copied.
 *   v2.1.0 — 2026-07-17 — Replace the native alert()/confirm() with the themed useToast +
 *     useConfirm (delete now a proper danger dialog, errors a toast).
 *   v2.0.0 — 2026-05-02 — Redesigned: node capabilities listing, policy display, source filter
 *   v1.0.0 — 2026-05-02 — Initial capability tab (CRUD form)
 */
import { useState, useEffect, useCallback } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { useConfirm } from '/components/Modal.js';
import { apiGet, apiPost, apiPut, apiDelete } from '/js/api.js';
import { getNodeUrl, getNodeId, getSession } from '/js/services/auth.js';
import { copyToClipboard } from '/js/utils.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { swallowed } from '/js/swallowed.js';
import { renderPage } from './capabilities/page.js';
import { x, groupCapabilities, agentTextFor, schemaProps } from './capabilities/frame.js';

const emptyFilter = () => ({ who: '', use: '', priced: false, vouched: false });
const emptyForm = () => ({ open: false, name: '', summary: '', webhookUrl: '', tags: '', visibility: 'public' });

export default function CapabilitiesTab({ session, showToast }) {
  const sess = session || getSession();
  const { confirm, ConfirmUI } = useConfirm();
  const [caps, setCaps] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [details, setDetails] = useState({});
  const [expanded, setExpanded] = useState(null);
  const [test, setTest] = useState(null);
  const [vouched, setVouched] = useState({});
  const [busy, setBusy] = useState(null);
  const [filters, setFilters] = useState({ ext: emptyFilter(), app: emptyFilter(), agent: emptyFilter() });
  const [queries, setQueries] = useState({ ext: '', app: '', agent: '' });
  const [shown, setShownState] = useState({ ext: 20, app: 20, agent: 20 });
  const [form, setFormState] = useState(emptyForm());

  const fail = (e, fallback) => showToast?.(e?.error?.message || e?.response?.error?.message || e?.message || fallback || t('profile.error'), true);
  // The session's own GHII, or the owner name on this node's id when the session carries none.
  const ownerGhii = sess?.ghii || (sess?.owner ? `${sess.owner}@${getNodeId()}` : '');

  const load = useCallback(async () => {
    try {
      // Every page at once: the registry is a few hundred rows of a kilobyte each, and the grouping
      // by provider needs all of them to count right.
      const first = await apiGet('/v1/capabilities?per_page=500');
      let rows = first?.data?.capabilities || [];
      const total = first?.data?.total || rows.length;
      for (let page = 2; rows.length < total && page < 20; page++) {
        const more = await apiGet(`/v1/capabilities?per_page=500&page=${page}`);
        const batch = more?.data?.capabilities || [];
        if (!batch.length) break;
        rows = rows.concat(batch);
      }
      setCaps(rows);
      if (first?.data?.policy) setPolicy(first.data.policy);
    } catch (e) { swallowed('capabilities: list', e); setCaps([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onLiveUpdate(null, load), [load]);

  const loadDetail = async (c) => {
    try {
      const r = await apiGet(`/v1/capabilities/${encodeURIComponent(c.id)}`);
      const d = r?.data;
      if (d) setDetails((m) => ({ ...m, [c.id]: d }));
      return d || null;
    } catch (e) { swallowed('capabilities: detail', e); return null; }
  };
  const toggle = (g) => {
    if (expanded === g.key) { setExpanded(null); setTest(null); return; }
    setExpanded(g.key); setTest(null);
    for (const c of g.members) if (!details[c.id]) loadDetail(c);
  };

  /* ── The try panel: one member through the invoke proxy, in the owner's own name ─────────── */
  const toggleTest = (g, c) => {
    if (test && test.id === c.id) { setTest(null); return; }
    const { props } = schemaProps(details[c.id]?.inputSchema || c.inputSchema);
    const sample = {};
    for (const [k, v] of Object.entries(props)) sample[k] = v?.type === 'number' || v?.type === 'integer' ? 0 : v?.type === 'boolean' ? false : v?.type === 'array' ? [] : v?.type === 'object' ? {} : '';
    setTest({ key: g.key, id: c.id, input: JSON.stringify(sample, null, 2), running: false, result: null, elapsed: 0 });
  };
  const setTestInput = (input) => setTest((s) => (s ? { ...s, input } : s));
  const runTest = async () => {
    if (!test) return;
    let input;
    try { input = test.input.trim() ? JSON.parse(test.input) : {}; } catch { showToast?.(x('tryBadJson'), true); return; }
    setTest((s) => ({ ...s, running: true, result: null }));
    const t0 = performance.now();
    try {
      const r = await apiPost(`/v1/capabilities/${encodeURIComponent(test.id)}/invoke`, { input });
      setTest((s) => ({ ...s, running: false, elapsed: Math.round(performance.now() - t0), result: { ok: r?.ok !== false, text: JSON.stringify(r?.data ?? r?.error ?? r, null, 2) } }));
      load();
    } catch (e) {
      setTest((s) => ({ ...s, running: false, elapsed: Math.round(performance.now() - t0), result: { ok: false, text: e?.response?.error?.message || e?.message || String(e) } }));
    }
  };

  /* ── Doors ───────────────────────────────────────────────────────────────────────────────── */
  const copyForAgent = async (g) => {
    for (const c of g.members) if (!details[c.id]) await loadDetail(c);
    const ok = await copyToClipboard(agentTextFor(g, details));
    showToast?.(ok === false ? x('copyFailed') : x('copiedToast', { name: g.name }), ok === false);
  };
  const vouch = async (g) => {
    const already = g.members.some((c) => vouched[c.id]);
    setBusy(g.key);
    try {
      for (const c of g.members) {
        const r = already ? await apiDelete(`/v1/capabilities/${encodeURIComponent(c.id)}/vouch`) : await apiPost(`/v1/capabilities/${encodeURIComponent(c.id)}/vouch`, {});
        if (r && r.ok === false) { fail(r); return; }
        setVouched((m) => ({ ...m, [c.id]: !already }));
      }
      showToast?.(already ? x('unvouchedToast', { name: g.name }) : x('vouchedToast', { name: g.name }));
      load();
    } catch (e) { fail(e); } finally { setBusy(null); }
  };
  const setVisibility = async (g, visibility) => {
    setBusy(g.key);
    try {
      for (const c of g.members) {
        const r = await apiPut(`/v1/capabilities/${encodeURIComponent(c.id)}`, { visibility });
        if (r && r.ok === false) { fail(r); return; }
      }
      showToast?.(visibility === 'public' ? x('shownToast', { name: g.name }) : x('hiddenToast', { name: g.name }));
      load();
    } catch (e) { fail(e); } finally { setBusy(null); }
  };
  const remove = async (g) => {
    if (!await confirm(x('confirmRemove', { name: g.name }), { title: x('remove'), danger: true })) return;
    setBusy(g.key);
    try {
      for (const c of g.members) {
        const r = await apiDelete(`/v1/capabilities/${encodeURIComponent(c.id)}`);
        if (r && r.ok === false) { fail(r); return; }
      }
      setExpanded(null);
      showToast?.(x('removedToast', { name: g.name }));
      load();
    } catch (e) { fail(e); } finally { setBusy(null); }
  };
  const setForm = (patch) => setFormState((f) => ({ ...f, ...patch }));
  const createManual = async () => {
    setBusy('create');
    try {
      const r = await apiPost('/v1/capabilities', {
        name: form.name.trim(), summary: form.summary.trim(), callable: !!form.webhookUrl.trim(),
        visibility: form.visibility, webhookUrl: form.webhookUrl.trim() || undefined,
        source: { type: 'manual', ref: 'manual', version: '1.0.0' },
        tags: form.tags.split(',').map((s) => s.trim()).filter(Boolean),
      });
      if (r && r.ok === false) { fail(r); return; }
      showToast?.(x('createdToast', { name: form.name.trim() }));
      setFormState(emptyForm());
      load();
    } catch (e) { fail(e); } finally { setBusy(null); }
  };

  const groups = caps ? groupCapabilities(caps, ownerGhii) : null;
  const ctx = {
    nodeUrl: getNodeUrl(), showToast, ConfirmUI,
    groups, policy, details, expanded, test, vouched, busy, filters, queries, shown, form,
    setFilter: (key, patch) => { setFilters((f) => ({ ...f, [key]: { ...f[key], ...patch } })); setShownState((s) => ({ ...s, [key]: 20 })); },
    setQuery: (key, q) => { setQueries((m) => ({ ...m, [key]: q })); setShownState((s) => ({ ...s, [key]: 20 })); },
    setShown: (key, n) => setShownState((s) => ({ ...s, [key]: n })),
    toggle, toggleTest, setTestInput, runTest, copyForAgent, vouch, setVisibility, remove, setForm, createManual,
  };
  return renderPage(ctx);
}
