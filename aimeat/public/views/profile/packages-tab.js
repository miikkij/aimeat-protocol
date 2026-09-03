/**
 * @file packages-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab: ready-made wholes that install as the owner's own. One read
 *   (GET /v1/packages/tab: installed instances, the owner's own packages, the template listings
 *   and every public package) plus the best-effort federation listings; the page joins listings and
 *   packages into one offer per group. This file is the state and the handlers (open a row, install
 *   with a name given on the row, check and apply an update, remove an instance, import and export
 *   a zip, propose to the gallery, change a publication's visibility, archive it, copy the
 *   package-builder request, sync the federation listings); the render is packages/page.js and
 *   packages/rows.js.
 * @structure PackagesTab() — state (data, remote, expanded, versions, updates, installForm, filter) + handlers → renderPage(ctx)
 * @usage registered in profile.js TABS as id 'packages'
 * @version-history
 *   v2.0.0 — 2026-09-03 — Poster face (design canvas "AIMEAT Paketit-sivu", direction A): one page
 *     instead of three sub-views; what is on offer is every author's public package joined with its
 *     gallery listing, not the owner's own; the install name is asked on the row instead of a
 *     browser prompt; the update check answers in words on the opened row; the raw locale key and
 *     the emoji are gone; the Generator, removed in July, is no longer named.
 *   2026-08-25 — The data-map strip removed: the map describes an APP, and a package is an
 *     installer rather than the thing somebody opens to work on.
 *   v1.6.0 — 2026-07-16 — Mount folds the 3 LOCAL reads into ONE GET /v1/packages/tab.
 *   v1.0.0 — 2026-03-15 — initial implementation (Phase 6)
 */
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { useConfirm } from '/components/Modal.js';
import { getNodeUrl, getSession } from '/js/services/auth.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { swallowed } from '/js/swallowed.js';
import { copyToClipboard } from '/js/utils.js';
import { apiGet } from '/js/api.js';
import * as pkgService from '/js/services/packages.js';
import { renderPage } from './packages/page.js';
import { x, joinOffers } from './packages/frame.js';

export default function PackagesTab({ session, showToast }) {
  const sess = session || getSession();
  const ownerName = sess?.owner || '';
  const isOperator = !!sess?.roles?.includes('operator');
  const { confirm, ConfirmUI } = useConfirm();
  const fileRef = useRef(null);
  const [data, setData] = useState(null);
  const [remote, setRemote] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [versions, setVersions] = useState({});
  const [updates, setUpdates] = useState({});
  const [installForm, setInstallForm] = useState(null);
  const [filter, setFilterState] = useState({ who: '', cat: '' });
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(20);
  const [busy, setBusy] = useState(false);

  const fail = (e, fallback) => showToast?.(e?.error?.message || e?.response?.error?.message || e?.message || (typeof e === 'string' ? e : '') || fallback || t('profile.error'), true);

  const load = useCallback(async () => {
    try {
      const r = await apiGet('/v1/packages/tab');
      setData(r?.data || { instances: { instances: [] }, packages: { packages: [] }, templates: { templates: [] }, available: { packages: [] } });
    } catch (e) { swallowed('packages: tab', e); setData({ instances: { instances: [] }, packages: { packages: [] }, templates: { templates: [] }, available: { packages: [] } }); }
    // The federation listings are another node's answer: best effort, never on the page's critical path.
    try {
      const fed = await pkgService.listFederationTemplates({ limit: 50 });
      setRemote(fed?.ok ? (fed.data?.templates ?? []) : []);
    } catch (e) { swallowed('packages: federation', e); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onLiveUpdate(['packages'], load), [load]);

  const instances = data?.instances?.instances ?? [];
  const own = data?.packages?.packages ?? [];
  const templates = data?.templates?.templates ?? [];
  const offers = data ? joinOffers(data.available?.packages ?? [], templates, remote) : [];
  const offerByGroup = Object.fromEntries(offers.map((o) => [o.group, o]));
  const ownByGroup = Object.fromEntries(own.map((p) => [p.packageGroupId, p]));
  const listingByGroup = Object.fromEntries(templates.map((l) => [l.packageGroupId, l]));

  const toggle = (key, item) => {
    if (expanded === key) { setExpanded(null); return; }
    setExpanded(key);
    if (key.startsWith('p:') && !versions[item.packageGroupId]) {
      pkgService.getPackageVersions(item.packageGroupId).then((r) => setVersions((m) => ({ ...m, [item.packageGroupId]: r?.data?.versions ?? [] }))).catch((e) => swallowed('packages: versions', e));
    }
    if (key.startsWith('i:') && !updates[item.id]) checkUpdate(item);
  };
  const jumpTo = (group) => {
    const key = ownByGroup[group] ? 'p:' + group : 'o:' + group;
    setExpanded(key);
    setTimeout(() => document.getElementById('pk-row-' + group.replace(/[^a-z0-9]/gi, '-'))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  /* ── Installed packages ──────────────────────────────────────────────────────────────────── */
  const checkUpdate = async (inst) => {
    setUpdates((m) => ({ ...m, [inst.id]: { checking: true } }));
    try {
      const r = await pkgService.checkUpdate(inst.id);
      if (!r?.ok) { setUpdates((m) => ({ ...m, [inst.id]: { error: r?.error?.message || x('updateFailed') } })); return; }
      setUpdates((m) => ({ ...m, [inst.id]: { updateAvailable: !!r.data?.updateAvailable, latestVersion: r.data?.latestVersion } }));
    } catch (e) { setUpdates((m) => ({ ...m, [inst.id]: { error: e?.message || x('updateFailed') } })); }
  };
  const applyUpdate = (inst, upd) => {
    confirm(x('confirmUpdate', { version: upd.latestVersion }), async () => {
      setBusy(true);
      try {
        const cur = await pkgService.getInstance(inst.id);
        const components = (cur?.data?.installedComponents || []).map((c) => ({ componentId: c.componentId, action: (c.type === 'memory' || c.type === 'translation') ? 'skip' : 'replace' }));
        const r = await pkgService.applyMigration(inst.id, { targetVersion: upd.latestVersion, components });
        if (!r?.ok) { fail(r); return; }
        showToast?.(x('updatedToast', { name: inst.label || inst.packageGroupId }));
        setUpdates((m) => ({ ...m, [inst.id]: undefined }));
        load();
      } catch (e) { fail(e); } finally { setBusy(false); }
    }, { title: x('applyUpdate') });
  };
  const removeInstance = (inst) => {
    confirm(x('confirmRemove', { name: inst.label || inst.packageGroupId, n: (inst.installedComponents || []).length }), async () => {
      try {
        const r = await pkgService.removeInstance(inst.id, true);
        if (!r?.ok) { fail(r); return; }
        showToast?.(x('removedToast', { name: inst.label || inst.packageGroupId }));
        setExpanded(null);
        load();
      } catch (e) { fail(e); }
    }, { title: x('removeInstance'), danger: true });
  };

  /* ── Offers and own publications ─────────────────────────────────────────────────────────── */
  const setInstallLabel = (key, label) => setInstallForm({ key, label });
  const install = async (o, label) => {
    const key = ownByGroup[o.group] ? 'p:' + o.group : 'o:' + o.group;
    setBusy(key);
    try {
      const r = await pkgService.installPackage(o.group, { label: (label || '').trim() });
      if (!r?.ok) { fail(r); return; }
      const n = (r.data?.instance?.installedComponents || r.data?.installedComponents || []).length;
      showToast?.(x('installedToast', { name: (label || '').trim() || o.title, n }));
      setInstallForm(null);
      setExpanded(null);
      load();
      setTimeout(() => document.getElementById('pk-installed')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const download = async (group, name) => {
    try {
      const blob = await pkgService.exportPackageZip(group);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${name}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { fail(e, x('exportFailed')); }
  };
  const setVisibility = async (p, visibility) => {
    setBusy(true);
    try {
      const r = await pkgService.updatePackage(p.packageGroupId, { visibility });
      if (!r?.ok) { fail(r); return; }
      showToast?.(visibility === 'public' ? x('madePublicToast', { name: p.name }) : x('madePrivateToast', { name: p.name }));
      load();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const propose = async (p) => {
    setBusy(true);
    try {
      const r = await pkgService.proposeAsTemplate(p.packageGroupId);
      if (!r?.ok) { fail(r); return; }
      showToast?.(x('proposedToast', { name: p.name }));
      load();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const archive = (p) => {
    confirm(x('confirmArchive', { name: p.name }), async () => {
      try {
        const r = await pkgService.archivePackageGroup(p.packageGroupId);
        if (!r?.ok) { fail(r); return; }
        showToast?.(x('archivedToast', { name: p.name }));
        setExpanded(null);
        load();
      } catch (e) { fail(e); }
    }, { title: x('archive'), danger: true });
  };

  /* ── A new package: the request, or a zip ────────────────────────────────────────────────── */
  const copyPrompt = async () => {
    setBusy('prompt');
    try {
      const r = await apiGet('/v1/prompts/package-builder');
      const content = r?.data?.content;
      if (!content) { fail(null, x('promptFailed')); return; }
      const ok = await copyToClipboard(content);
      showToast?.(ok === false ? x('copyFailed') : x('promptCopiedToast'), ok === false);
    } catch (e) { fail(e, x('promptFailed')); } finally { setBusy(false); }
  };
  const pickZip = () => fileRef.current?.click();
  const importZip = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setBusy('import');
    try {
      const r = await pkgService.importPackageZip(file);
      showToast?.(x('importedToast', { name: r?.data?.name || r?.data?.package?.name || file.name }));
      load();
    } catch (err) { fail(err, x('importFailed')); } finally { setBusy(false); }
  };
  const syncRemote = async () => {
    setBusy('sync');
    try {
      const r = await pkgService.syncFederationTemplates();
      if (!r?.ok) { fail(r); return; }
      showToast?.(x('syncedToast'));
      load();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const ctx = {
    nodeUrl: getNodeUrl(), ownerName, isOperator, showToast, ConfirmUI, fileRef,
    data, instances, own, offers, offerByGroup, ownByGroup, listingByGroup,
    expanded, versions, updates, installForm, filter, query, shown, busy,
    setFilter: (patch) => { setFilterState((f) => ({ ...f, ...patch })); setShown(20); },
    setQuery: (q) => { setQuery(q); setShown(20); },
    setShown,
    toggle, jumpTo, checkUpdate, applyUpdate, removeInstance, setInstallLabel, install, download, setVisibility, propose, archive,
    copyPrompt, pickZip, importZip, syncRemote,
  };
  return renderPage(ctx);
}
