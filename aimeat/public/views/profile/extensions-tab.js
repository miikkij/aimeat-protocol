/**
 * @file public/views/profile/extensions-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Extensions page: the builder's catalogue of the server extensions and cortexes
 *   on this node, what each offers an app and who uses it. This file is the state and the
 *   handlers; the render is extensions/page.js (the page) and extensions/rows.js (a row and what
 *   opens under it). Loads the two lists and the two prompts from the node, a row's detail when it
 *   is opened, the scheduler's jobs once for the last runs, and the dependency map before a delete
 *   so the confirm can name the apps that would break.
 * @structure ExtensionsTab
 * @usage <ExtensionsTab session={session} showToast={showToast} />
 * @version-history
 *   v1.x — 2026-02 → 2026-08 — Cards: cortexes with bundled installs and a maturity badge, server
 *     extensions with an inline detail view; a copied prompt built in the browser.
 *   v2.0.0 — 2026-09-03 — Poster face (design canvas "AIMEAT Laajennukset-sivu", third round):
 *     rows with what it does, who uses it (the dependency map), a green dot for active; opened in
 *     place with the actions, a test panel, the pinned address, instances, settings, schedules with
 *     their last runs, kept versions; the cortex's script tag pinned to its version; both prompts
 *     from the node; the delete confirm names the dependents.
 */
import { useState, useEffect, useCallback } from 'preact/hooks';
import { onLiveUpdate } from '/lib/live-updates.js';
import { t } from '/js/i18n.js';
import { useConfirm } from '/components/Modal.js';
import * as cortexService from '/js/services/cortex.js';
import * as v8Ext from '/js/services/extensions.js';
import { apiGet, apiPost } from '/js/api.js';
import { getNodeUrl, getSession } from '/js/services/auth.js';
import { fetchServerExtensionPrompt, fetchCortexPrompt } from './extensions-tab.prompts.js';
import { swallowed } from '/js/swallowed.js';
import { renderPage } from './extensions/page.js';
import { x, appName } from './extensions/frame.js';

const emptyForm = () => ({ open: false, kind: 'extension', manifest: '', files: [{ name: '', code: '' }] });

export default function ExtensionsTab({ session, showToast }) {
  const sess = session || getSession();
  const { confirm, ConfirmUI } = useConfirm();
  const [extensions, setExtensions] = useState(null);
  const [cortexes, setCortexes] = useState(null);
  const [extPrompt, setExtPrompt] = useState('');
  const [cortexPrompt, setCortexPrompt] = useState('');
  const [jobs, setJobs] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [details, setDetails] = useState({});
  const [instances, setInstances] = useState({});
  const [busy, setBusy] = useState(null);
  const [extFilter, setExtFilterState] = useState({ who: 'mine', state: '', kind: '', instances: false });
  const [cxFilter, setCxFilterState] = useState({ who: 'mine', part: '', pub: false });
  const [extQuery, setExtQuery] = useState('');
  const [cxQuery, setCxQuery] = useState('');
  const [extShown, setExtShown] = useState(20);
  const [cxShown, setCxShown] = useState(20);
  const [test, setTest] = useState(null);
  const [newInstanceId, setNewInstanceId] = useState('');
  const [form, setFormState] = useState(emptyForm());
  const [shown, setShown] = useState(null);

  const fail = (e, fallback) => showToast?.(e?.error?.message || e?.response?.error?.message || e?.message || fallback || t('profile.error'), true);

  const load = useCallback(async () => {
    const [extRes, cxRes] = await Promise.all([
      v8Ext.listV8Extensions().catch((e) => { swallowed('extensions: list', e); return null; }),
      cortexService.listExtensions().catch((e) => { swallowed('extensions: cortex list', e); return null; }),
    ]);
    setExtensions(Array.isArray(extRes) ? extRes : []);
    setCortexes(cxRes?.extensions || []);
  }, []);

  const owner = sess?.owner || '';
  useEffect(() => {
    load();
    fetchServerExtensionPrompt({ owner }).then((p) => setExtPrompt(p || '')).catch((e) => swallowed('extensions: prompt', e));
    fetchCortexPrompt({ owner }).then((p) => setCortexPrompt(p || '')).catch((e) => swallowed('extensions: cortex prompt', e));
    apiGet('/v1/schedules').then((r) => setJobs(r?.data?.extensions || [])).catch((e) => swallowed('extensions: schedules', e));
  }, [load, owner]);
  useEffect(() => onLiveUpdate(null, load), [load]);

  /* ── Opening a row: its detail is fetched once and kept ─────────────────────────────────── */

  const loadExtDetail = async (ext) => {
    try {
      const [r, inst] = await Promise.all([v8Ext.getV8Extension(ext.name), ext.instances?.supported ? v8Ext.listInstances(ext.name) : Promise.resolve(null)]);
      const d = r?.data?.extension || r?.data || r;
      setDetails((m) => ({ ...m, ['ext:' + ext.name]: d && !d.error ? d : { error: d?.error?.message || t('profile.error') } }));
      if (inst) setInstances((m) => ({ ...m, [ext.name]: Array.isArray(inst) ? inst : [] }));
    } catch (e) { setDetails((m) => ({ ...m, ['ext:' + ext.name]: { error: e?.message || t('profile.error') } })); }
  };
  const loadCortexDetail = async (cx) => {
    const d = await cortexService.getExtensionDetail(cx.name);
    setDetails((m) => ({ ...m, ['cx:' + cx.name]: d || { error: t('profile.error') } }));
  };
  const toggleExt = (ext) => {
    const key = 'ext:' + ext.name;
    if (expanded === key) { setExpanded(null); setTest(null); return; }
    setExpanded(key); setTest(null);
    if (!details[key]) loadExtDetail(ext);
  };
  const toggleCortex = (cx) => {
    const key = 'cx:' + cx.name;
    if (expanded === key) { setExpanded(null); return; }
    setExpanded(key);
    if (!details[key]) loadCortexDetail(cx);
  };

  /* ── Doors on a server extension ─────────────────────────────────────────────────────────── */

  const withBusy = async (key, fn, doneMsg) => {
    setBusy(key);
    try {
      const r = await fn();
      if (r && r.ok === false) { fail(r); return false; }
      if (doneMsg) showToast?.(doneMsg);
      await load();
      return true;
    } catch (e) { fail(e); return false; } finally { setBusy(null); }
  };
  const activateExt = (ext) => withBusy('ext:' + ext.name, () => v8Ext.activateV8Extension(ext.name), x('toastActivated', { name: ext.name }));
  const deactivateExt = (ext) => withBusy('ext:' + ext.name, () => v8Ext.deactivateV8Extension(ext.name), x('toastDeactivated', { name: ext.name }));

  /** Who breaks if this goes: the dependency map's answer, so the confirm can say it. */
  const dependentsOf = async (kind, name) => {
    try {
      const r = await apiGet(`/v1/dependencies?${kind}=${encodeURIComponent(name)}`);
      const u = r?.data?.used_by || {};
      const apps = (u.apps || []).map((a) => appName(`${a.owner}/${a.filename}`));
      const hidden = (u.apps_total || 0) - apps.length;
      return [...apps, ...(hidden > 0 ? [x('usedMore', { n: hidden })] : []), ...(u.cortexes || []).map((c) => `${x('cortexWord')} ${c}`)];
    } catch (e) { swallowed('extensions: dependents', e); return []; }
  };
  const removeExt = async (ext) => {
    const deps = await dependentsOf('extension', ext.name);
    const body = deps.length ? x('confirmRemoveDeps', { name: ext.name, list: deps.join(', ') }) : x('confirmRemove', { name: ext.name });
    if (!await confirm(body, { title: x('removeExt'), danger: true })) return;
    if (expanded === 'ext:' + ext.name) setExpanded(null);
    await withBusy('ext:' + ext.name, () => v8Ext.deleteV8Extension(ext.name), x('toastRemoved', { name: ext.name }));
  };
  const createInstance = async (ext) => {
    const id = newInstanceId.trim();
    if (!id) return;
    const ok = await withBusy('ext:' + ext.name, () => v8Ext.createInstance(ext.name, id), x('toastInstanceCreated', { id }));
    if (ok) { setNewInstanceId(''); loadExtDetail(ext); }
  };
  const deleteInstance = async (ext, id) => {
    if (!await confirm(x('confirmDeleteInstance', { id }), { title: x('deleteInstance', { id }), danger: true })) return;
    const ok = await withBusy('ext:' + ext.name, () => v8Ext.deleteInstance(ext.name, id), x('toastInstanceDeleted', { id }));
    if (ok) loadExtDetail(ext);
  };

  /* ── The test panel: one action, an input, the answer and the time it took ──────────────── */

  const toggleTest = (ext, action) => {
    if (test && test.ext === ext.name && test.actionId === action.id) { setTest(null); return; }
    const schema = action.inputSchema || action.input || {};
    const props = schema.properties || {};
    const sample = {};
    for (const [k, v] of Object.entries(props)) sample[k] = v?.type === 'number' || v?.type === 'integer' ? 0 : v?.type === 'boolean' ? false : v?.type === 'array' ? [] : v?.type === 'object' ? {} : '';
    setTest({ ext: ext.name, actionId: action.id, input: JSON.stringify(sample, null, 2), running: false, result: null, elapsed: 0 });
  };
  const setTestInput = (input) => setTest((s) => (s ? { ...s, input } : s));
  const runTest = async (ext) => {
    if (!test) return;
    let input;
    try { input = test.input.trim() ? JSON.parse(test.input) : {}; } catch { showToast?.(x('testBadJson'), true); return; }
    setTest((s) => ({ ...s, running: true, result: null }));
    const t0 = performance.now();
    try {
      const r = await v8Ext.executeAction(ext.name, test.actionId, input);
      const elapsed = Math.round(performance.now() - t0);
      setTest((s) => ({ ...s, running: false, elapsed, result: { ok: r?.ok !== false, text: JSON.stringify(r?.data ?? r?.error ?? r, null, 2) } }));
    } catch (e) {
      setTest((s) => ({ ...s, running: false, elapsed: Math.round(performance.now() - t0), result: { ok: false, text: e?.response?.error?.message || e?.message || String(e) } }));
    }
  };

  /* ── Doors on a cortex ───────────────────────────────────────────────────────────────────── */

  const activateCortex = (cx) => withBusy('cx:' + cx.name, () => cortexService.activateExtension(cx.name), x('toastActivated', { name: cx.name }));
  const deactivateCortex = (cx) => withBusy('cx:' + cx.name, () => cortexService.deactivateExtension(cx.name), x('toastDeactivated', { name: cx.name }));
  const toggleVisibility = (cx) => withBusy('cx:' + cx.name, () => cortexService.toggleVisibility(cx.name, cx.visibility), cx.visibility === 'public' ? x('toastPrivate', { name: cx.name }) : x('toastPublished', { name: cx.name }));
  const removeCortex = async (cx) => {
    const deps = await dependentsOf('cortex', cx.name);
    const body = deps.length ? x('confirmRemoveDeps', { name: cx.name, list: deps.join(', ') }) : x('confirmRemove', { name: cx.name });
    if (!await confirm(body, { title: x('removeCortex'), danger: true })) return;
    if (expanded === 'cx:' + cx.name) setExpanded(null);
    await withBusy('cx:' + cx.name, () => cortexService.uninstallExtension(cx.name), x('toastRemoved', { name: cx.name }));
  };

  /* ── The install form: a manifest and its files, as an extension or as a cortex ─────────── */

  const setForm = (patch) => setFormState((f) => ({ ...f, ...patch }));
  const setFormOpen = (open) => setFormState((f) => ({ ...f, open }));
  const setFormFile = (i, patch) => setFormState((f) => ({ ...f, files: f.files.map((file, j) => (j === i ? { ...file, ...patch } : file)) }));
  const addFormFile = () => setFormState((f) => ({ ...f, files: [...f.files, { name: '', code: '' }] }));
  const installFromForm = async () => {
    const manifest = form.manifest.trim();
    if (!manifest) { showToast?.(x('formNeedsManifest'), true); return; }
    const files = {};
    for (const f of form.files) if (f.name.trim() && f.code) files[f.name.trim()] = f.code;
    setBusy('install');
    try {
      let r;
      if (form.kind === 'cortex') {
        r = await cortexService.installExtension(manifest, files);
      } else {
        r = await apiPost('/v1/extensions', { manifest, scripts: files });
      }
      if (!r || r.ok === false) { fail(r, x('installFailed')); return; }
      const name = r.data?.extension?.name || r.data?.name || '';
      showToast?.(x('toastInstalled', { name }));
      setFormState(emptyForm());
      await load();
    } catch (e) { fail(e, x('installFailed')); } finally { setBusy(null); }
  };

  const ctx = {
    session: sess, nodeUrl: getNodeUrl(), showToast, ConfirmUI,
    extensions, cortexes, extPrompt, cortexPrompt, jobs,
    expanded, details, instances, busy, test, newInstanceId, form, shown,
    extFilter, cxFilter, extQuery, cxQuery, extShown, cxShown,
    setExtFilter: (patch) => { setExtFilterState((f) => ({ ...f, ...patch })); setExtShown(20); },
    setCxFilter: (patch) => { setCxFilterState((f) => ({ ...f, ...patch })); setCxShown(20); },
    setExtQuery: (q) => { setExtQuery(q); setExtShown(20); }, setCxQuery: (q) => { setCxQuery(q); setCxShown(20); },
    setExtShown, setCxShown,
    toggleExt, toggleCortex, activateExt, deactivateExt, removeExt, createInstance, deleteInstance, setNewInstanceId,
    toggleTest, setTestInput, runTest,
    activateCortex, deactivateCortex, toggleVisibility, removeCortex,
    setForm, setFormOpen, setFormFile, addFormFile, installFromForm,
    toggleShow: (which) => setShown((s) => (s === which ? null : which)),
  };
  return renderPage(ctx);
}
