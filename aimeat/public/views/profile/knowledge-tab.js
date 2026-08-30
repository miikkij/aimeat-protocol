/**
 * @file knowledge-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile › Knowledge: refined knowledge a person brought and owns, as packages of
 *   entries with sources and relations. Loads the packages and their federation consents, the
 *   organisms' packages and the public catalogue; holds the import flow (a pasted package is parsed,
 *   previewed and confirmed), and the handlers a package's page calls: export, delete, clone, the
 *   sharing switches, an entry's visibility, federation, contributing to an organism, and the two
 *   prompts (a chat, an agent over MCP). Renders the poster face (knowledge/cover.js).
 * @structure KnowledgeTab (default) — state, loads, handlers, the ctx bag, render
 * @usage
 *   import KnowledgeTab from './knowledge-tab.js';
 *   html`<${KnowledgeTab} session=${session} showToast=${showToast} onStats=${onStats} />`
 * @version-history
 *   v2.0.0 — 2026-08-30 — The poster face (design canvas "AIMEAT Tietopankin sivu", direction A). The
 *     action bar, the always-open import box and the wall of expandable cards are replaced by the
 *     cover and the package page; the OpenClaw prompt gives way to the prompt for an agent over MCP.
 *     Every service call is unchanged.
 *   v1.x — 2026-05 to 2026-08 — the card list: import preview, sharing, per-entry visibility,
 *     federation, per-entry references and relations, the composite mount (getKnowledgeTab).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { onLiveUpdate } from '/lib/live-updates.js';
import { t } from '/js/i18n.js';
import { copyToClipboard } from '/js/utils.js';
import { apiGet } from '/js/api.js';
import { listConsents, grantConsent, revokeConsent } from '/js/services/consent.js';
import { useConfirm } from '/components/Modal.js';
import * as knowledgeService from '/js/services/knowledge.js';
import { extractFedConsents } from './knowledge-tab.helpers.js';
import { swallowed } from '/js/swallowed.js';
import { pkgId } from './knowledge/frame.js';
import { renderKnowledgeView } from './knowledge/cover.js';

export default function KnowledgeTab({ session, showToast, onStats }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importText, setImportText] = useState('');
  const [importPreview, setImportPreview] = useState(null);
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);
  const [entryData, setEntryData] = useState({});   // entry key → value
  const [loadingEntries, setLoadingEntries] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [savingSharing, setSavingSharing] = useState(null);
  const [fedConsents, setFedConsents] = useState({});
  const [togglingFed, setTogglingFed] = useState(null);
  const [discovered, setDiscovered] = useState([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [organismPackages, setOrganismPackages] = useState([]);
  const [organismLoading, setOrganismLoading] = useState(false);
  // The poster face
  const [view, setView] = useState({ kind: 'cover' });
  const [sort, setSort] = useState('state');
  const [road, setRoad] = useState('mcp');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [openEntries, setOpenEntries] = useState(() => new Set());
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [shareOrg, setShareOrg] = useState('');

  const ghii = session?.ghii || session?.owner || '';
  const organisms = session?.organisms || [];

  const loadPackages = useCallback(async ({ showSpinner = true } = {}) => {
    try {
      if (showSpinner) setLoading(true);
      const list = await knowledgeService.listMyPackages();
      setPackages(list);
      onStats?.({ knowledge: list.length });
    } catch (err) { swallowed('knowledge-tab', err); if (showSpinner) setPackages([]); }
    finally { setLoading(false); }
  }, [onStats]);
  const loadFedConsents = useCallback(async () => {
    try { setFedConsents(extractFedConsents(await listConsents())); }
    catch (err) { swallowed('knowledge-tab: consents', err); }
  }, []);
  // Mount fold: one composite for the owner's data (packages + consents); the individual loaders on failure.
  useEffect(() => {
    (async () => {
      const ov = await knowledgeService.getKnowledgeTab();
      if (!ov) { loadPackages(); loadFedConsents(); return; }
      setPackages(ov.packages);
      onStats?.({ knowledge: ov.packages.length });
      setFedConsents(extractFedConsents(ov.consents));
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the mount fold runs once
  }, []);
  const loadRef = useRef(loadPackages);
  loadRef.current = loadPackages;
  useEffect(() => onLiveUpdate(['knowledge', 'federation'], () => { loadRef.current({ showSpinner: false }); loadFedConsents(); }), [loadFedConsents]);

  const loadDiscover = useCallback(async () => {
    setDiscoverLoading(true);
    try { const resp = await knowledgeService.discoverPackages({ sort: 'recent', limit: 20 }); setDiscovered(resp?.data?.packages || []); }
    catch (err) { swallowed('knowledge-tab', err); setDiscovered([]); }
    finally { setDiscoverLoading(false); }
  }, []);
  useEffect(() => { loadDiscover(); }, [loadDiscover]);

  const loadOrganismPackages = useCallback(async () => {
    if (!organisms.length) return;
    setOrganismLoading(true);
    try {
      const all = [];
      for (const org of organisms) {
        try {
          const resp = await knowledgeService.listOrganismPackages(org.id || org.organismId);
          all.push(...(resp?.data?.packages || []).map(p => ({ ...p, organismName: org.name || org.id })));
        } catch (err) { swallowed('knowledge-tab: organism', err); }
      }
      setOrganismPackages(all);
    } finally { setOrganismLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the organisms list is the session's; its identity changes on every render
  }, [session?.organisms]);
  useEffect(() => { loadOrganismPackages(); }, [loadOrganismPackages]);

  /* ── The two prompts: a chat, an agent over MCP ── */
  const copyPrompt = useCallback(async (type) => {
    try {
      const resp = type === 'human' ? await knowledgeService.getHumanPrompt() : await knowledgeService.getMcpPrompt();
      const text = resp?.data?.prompt;
      if (text) { await copyToClipboard(text); showToast(t(type === 'human' ? 'knowledge.cover.copiedChat' : 'knowledge.cover.copiedMcp')); }
      else showToast(t('knowledge.cover.promptMissing'), true);
    } catch (err) { swallowed('knowledge-tab: prompt', err); showToast(t('profile.knowledge.copyFailed'), true); }
  }, [showToast]);

  /* ── Import: parse the pasted text ── */
  const handleImportPaste = useCallback((text) => {
    setImportText(text); setImportError(''); setImportPreview(null);
    if (!text.trim()) return;
    try {
      let jsonStr = text;
      const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (codeBlockMatch) jsonStr = codeBlockMatch[1];
      const parsed = JSON.parse(jsonStr.trim());
      if (!parsed.aimeat_knowledge_package && !parsed.package) { setImportError(t('profile.knowledge.notKnowledgePackage')); return; }
      const pkg = parsed.package || parsed;
      const targetGhii = parsed.target_ghii || pkg.author || '';
      setImportPreview({ raw: parsed, pkg, targetGhii, targetNode: parsed.target_node || '', ghiiMatch: !targetGhii || targetGhii === ghii, entryOverrides: {}, catalogListed: pkg.sharing?.catalog_listed ?? true, organismShare: '' });
    // eslint-disable-next-line aimeat/no-silent-catch -- text that does not parse IS the answer: the preview says so
    } catch { setImportError(t('profile.knowledge.parseError')); }
  }, [ghii]);
  const confirmImport = useCallback(async () => {
    if (!importPreview) return;
    setImporting(true);
    try {
      const overrides = { entries: importPreview.entryOverrides, catalog_listed: importPreview.catalogListed, organism_share: importPreview.organismShare || undefined };
      const result = await knowledgeService.importPackage(importPreview.pkg, overrides, importPreview.raw?.entry_data || null);
      if (result?.data?.package_id) { showToast(t('knowledge.import.success')); setImportText(''); setImportPreview(null); setPasteOpen(false); loadPackages(); }
      else showToast(t('knowledge.import.error'), true);
    } catch (err) { swallowed('knowledge-tab', err); showToast(t('knowledge.import.error'), true); }
    finally { setImporting(false); }
  }, [importPreview, showToast, loadPackages]);

  /* ── A package's actions ── */
  const handleDelete = useCallback((pkg) => {
    const name = pkg.value?.name || t('knowledge.cover.untitled');
    confirm(t('knowledge.myKnowledge.confirmDelete').replace('{name}', name), async () => {
      setDeleting(pkg.key);
      try { await knowledgeService.deletePackage(ghii, pkgId(pkg)); showToast(t('knowledge.myKnowledge.deleted')); setView({ kind: 'cover' }); loadPackages(); }
      catch (err) { swallowed('knowledge-tab', err); showToast(t('knowledge.myKnowledge.deleteError'), true); }
      finally { setDeleting(null); }
    }, { danger: true });
  }, [ghii, showToast, loadPackages, confirm]);
  const handleExport = useCallback(async (pkg) => {
    try { const resp = await knowledgeService.exportPackage(pkgId(pkg)); await copyToClipboard(JSON.stringify(resp?.data || pkg.value, null, 2)); showToast(t('knowledge.myKnowledge.exportCopied')); }
    catch (err) {
      swallowed('knowledge-tab: export', err);
      try { await copyToClipboard(JSON.stringify(pkg.value, null, 2)); showToast(t('knowledge.myKnowledge.exportCopied')); }
      catch (err2) { swallowed('knowledge-tab: export copy', err2); showToast(t('profile.knowledge.copyFailed'), true); }
    }
  }, [showToast]);
  const handleClone = useCallback(async (packageId) => {
    try {
      const result = await knowledgeService.clonePackage(packageId, 'cloned');
      if (result?.data?.cloned_package_id) { showToast(t('profile.knowledge.cloned')); loadPackages(); }
      else showToast(t('profile.knowledge.cloneFailed'), true);
    } catch (err) { swallowed('knowledge-tab', err); showToast(t('profile.knowledge.cloneFailed'), true); }
  }, [showToast, loadPackages]);
  const handleSharingChange = useCallback(async (pkg, field, value) => {
    setSavingSharing(pkg.key);
    try {
      const update = { [field]: value };
      if (field === 'catalog_listed' && value && !pkg.value?.sharing?.allow_clone) update.allow_clone = true;
      const result = await knowledgeService.updateSharing(pkgId(pkg), update);
      if (result?.data?.sharing) { showToast(t('knowledge.myKnowledge.saved')); loadPackages({ showSpinner: false }); }
      else showToast(t('knowledge.myKnowledge.saveError'), true);
    } catch (err) { swallowed('knowledge-tab', err); showToast(t('knowledge.myKnowledge.saveError'), true); }
    finally { setSavingSharing(null); }
  }, [showToast, loadPackages]);
  const handleEntryVisibility = useCallback(async (pkg, entry, newVis) => {
    setPackages(prev => prev.map(p => (p.key !== pkg.key ? p : { ...p, value: { ...p.value, entries: (p.value?.entries || []).map(e => (e.key === entry.key ? { ...e, visibility: newVis } : e)) } })));
    try {
      const result = await knowledgeService.updateEntryVisibility(pkgId(pkg), entry.key, newVis);
      if (!result?.data?.visibility) { showToast(result?.error?.message || t('knowledge.myKnowledge.saveError'), true); loadPackages({ showSpinner: false }); }
    } catch (err) { swallowed('knowledge-tab: visibility', err); showToast(t('knowledge.myKnowledge.saveError'), true); loadPackages({ showSpinner: false }); }
  }, [showToast, loadPackages]);
  const toggleFederation = useCallback(async (pkg) => {
    const id = pkgId(pkg);
    setTogglingFed(pkg.key);
    try {
      if (fedConsents[id]) { await revokeConsent(fedConsents[id]); showToast(t('knowledge.unfederateSuccess')); }
      else { await grantConsent({ data_pattern: `packages/${id}/*`, recipient: '*', scope: 'federation', purpose: 'knowledge_sharing' }); showToast(t('knowledge.federateSuccess')); }
      await loadFedConsents();
    } catch (err) { showToast(err.message || t('profile.error'), true); }
    finally { setTogglingFed(null); }
  }, [fedConsents, showToast, loadFedConsents]);
  const contributeToOrganism = useCallback(async (pkg) => {
    if (!shareOrg) return;
    try { await knowledgeService.contributeToOrganism(pkgId(pkg), shareOrg); showToast(t('knowledge.cover.contributed')); setShareOrg(''); loadOrganismPackages(); }
    catch (err) { showToast(err.message || t('profile.error'), true); }
  }, [shareOrg, showToast, loadOrganismPackages]);

  /* ── A package's entries are fetched when its page opens ── */
  // A cloned package's manifest can name entries under the source package's prefix, so the
  // prefixes come from the entry keys themselves, the package's own prefix among them.
  const ensureEntries = useCallback(async (pkg) => {
    const entries = pkg?.value?.entries || [];
    if (!entries.some(e => e.key && !(e.key in entryData))) return;
    const id = String(pkg.key || '').split('/')[1];
    const prefixes = new Set(id ? [`packages/${id}/`] : []);
    for (const e of entries) { const m = /^(packages\/[^/]+\/)/.exec(String(e.key || '')); if (m) prefixes.add(m[1]); }
    if (!prefixes.size) return;
    setLoadingEntries(pkg.key);
    try {
      const lists = await Promise.all([...prefixes].map(p => apiGet('/v1/memory?prefix=' + encodeURIComponent(p)).catch(err => { swallowed('knowledge-tab: entries', err); return null; })));
      setEntryData(prev => { const next = { ...prev }; for (const resp of lists) for (const item of resp?.data?.items || []) if (item.key && !item.key.endsWith('/manifest')) next[item.key] = item.value; return next; });
    } finally { setLoadingEntries(null); }
  }, [entryData]);

  const pickView = (v) => {
    setView(v); setDetailsOpen(false); setShareOrg('');
    if (v.kind === 'package') {
      const pkg = packages.find(p => pkgId(p) === v.id);
      const first = pkg?.value?.entries?.[0];
      setOpenEntries(new Set(first ? [first.key || '0'] : []));
      if (pkg) ensureEntries(pkg);
    }
  };
  const toggleEntry = (key) => setOpenEntries(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const openEntry = (key) => setOpenEntries(prev => new Set([...prev, key]));
  const setAllEntries = (entries, open) => setOpenEntries(open ? new Set(entries.map((e, i) => e.key || String(i))) : new Set());

  const ctx = {
    ghii, organisms, showToast, packages, loading, fedConsents, togglingFed, deleting, savingSharing, entryData, loadingEntries,
    discovered, discoverLoading, organismPackages, organismLoading,
    view, pickView, sort, setSort, road, setRoad, pasteOpen, setPasteOpen, openEntries, toggleEntry, openEntry, setAllEntries, detailsOpen, setDetailsOpen, shareOrg, setShareOrg,
    importText, importPreview, setImportPreview, importError, importing, handleImportPaste, confirmImport,
    copyPrompt, handleDelete, handleExport, handleClone, handleSharingChange, handleEntryVisibility, toggleFederation, contributeToOrganism,
  };
  return html`${renderKnowledgeView(ctx)}<${ConfirmUI} />`;
}
