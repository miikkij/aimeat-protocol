/**
 * @file knowledge-tab.js
 * @description Knowledge packages tab for the profile view. Manages importing,
 *   exporting, cloning, and sharing knowledge packages. Displays owned packages,
 *   organism-shared packages, and discoverable packages from the catalog.
 * @structure
 *   - KnowledgeTab (default export) — main tab component
 *   - renderEntry — renders a single knowledge entry with visibility pill
 *   - renderEntryRefs — renders per-entry reference links
 *   - renderRelatedEntries — renders related-entry chip buttons
 *   - formatEntryValue — formats structured entry data for display
 * @usage
 *   import KnowledgeTab from './knowledge-tab.js';
 *   html`<${KnowledgeTab} session=${session} showToast=${showToast} onStats=${onStats} />`
 * @version-history
 *   v1.0.0 — 2026-03-17 — Refactor: remove all inline style="" attributes, use CSS
 *     classes (pf-ref-row, pf-ref-icon, pf-external-icon, pf-ref-title, pf-badge-xs,
 *     pf-sharing-box, pf-sharing-heading, kpkg-detail-loading). Replace inline
 *     visibility pill with shared VisibilityPill component. Replace hardcoded English
 *     strings with i18n t() calls.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, copyToClipboard } from '/js/utils.js';
import { apiGet, apiPost, apiDelete } from '/js/api.js';
import { listConsents, grantConsent, revokeConsent } from '/js/services/consent.js';
import { Spinner } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import * as knowledgeService from '/js/services/knowledge.js';

export default function KnowledgeTab({ session, showToast, onStats }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importText, setImportText] = useState('');
  const [importPreview, setImportPreview] = useState(null);
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);

  /* ── UI state ── */
  const [expandedPkg, setExpandedPkg] = useState(null);
  const [entryData, setEntryData] = useState({});   // { entryKey: value }
  const [loadingEntries, setLoadingEntries] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [savingSharing, setSavingSharing] = useState(null);

  /* ── Federation consent state ── */
  const [fedConsents, setFedConsents] = useState({});   // { packageName: consentId }
  const [togglingFed, setTogglingFed] = useState(null);

  /* ── Discovery state ── */
  const [discovered, setDiscovered] = useState([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);

  /* ── Organism state ── */
  const [organismPackages, setOrganismPackages] = useState([]);
  const [organismLoading, setOrganismLoading] = useState(false);

  const ghii = session?.ghii || session?.owner || '';
  const nodeUrl = window.location.origin;
  const nodeId = session?.nodeId || '';

  const loadPackages = useCallback(async ({ showSpinner = true } = {}) => {
    try {
      if (showSpinner) setLoading(true);
      const list = await knowledgeService.listMyPackages();
      const hydrated = await Promise.all(list.map(async (pkg) => {
        if (pkg.value) return pkg;
        try {
          const resp = await apiGet('/v1/memory/' + encodeURIComponent(pkg.key));
          return { ...pkg, value: resp?.data?.value };
        } catch { return pkg; }
      }));
      setPackages(hydrated);
      onStats?.({ knowledge: hydrated.length });
    } catch { if (showSpinner) setPackages([]); } // keep old list on a transient live-update refetch
    finally { setLoading(false); }
  }, [onStats]);

  useEffect(() => { loadPackages(); }, [loadPackages]);

  /* ── Load federation consents for knowledge packages ── */
  const loadFedConsents = useCallback(async () => {
    try {
      const allConsents = await listConsents();
      const map = {};
      for (const c of allConsents) {
        if (c.scope === 'federation' && (c.data_pattern || c.pattern || '').startsWith('packages/')) {
          const pat = c.data_pattern || c.pattern || '';
          // Extract package name from pattern like "packages/{name}/*"
          const match = pat.match(/^packages\/([^/]+)\//);
          if (match) {
            map[match[1]] = c.id || c.consent_id;
          }
        }
      }
      setFedConsents(map);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadFedConsents(); }, [loadFedConsents]);

  /* ── Toggle federation consent for a package ── */
  const toggleFederation = useCallback(async (pkg) => {
    const manifest = pkg.value;
    const packageId = manifest?.id || pkg.key.split('/')[1] || pkg.key;
    setTogglingFed(pkg.key);
    try {
      if (fedConsents[packageId]) {
        // Revoke existing federation consent
        await revokeConsent(fedConsents[packageId]);
        showToast(t('knowledge.unfederateSuccess'));
      } else {
        // Grant federation consent
        await grantConsent({
          data_pattern: `packages/${packageId}/*`,
          recipient: '*',
          scope: 'federation',
          purpose: 'knowledge_sharing',
        });
        showToast(t('knowledge.federateSuccess'));
      }
      await loadFedConsents();
    } catch (err) {
      showToast(err.message || t('profile.error'), true);
    } finally { setTogglingFed(null); }
  }, [fedConsents, showToast, loadFedConsents]);

  // Live update listener
  const loadRef = useRef(loadPackages);
  loadRef.current = loadPackages;
  useEffect(() => {
    const handler = () => { loadRef.current({ showSpinner: false }); loadFedConsents(); }; // silent
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  /* ── Load Discover ── */
  const loadDiscover = useCallback(async () => {
    setDiscoverLoading(true);
    try {
      const resp = await knowledgeService.discoverPackages({ sort: 'recent', limit: 10 });
      setDiscovered(resp?.data?.packages || []);
    } catch { setDiscovered([]); }
    finally { setDiscoverLoading(false); }
  }, []);

  useEffect(() => { loadDiscover(); }, [loadDiscover]);

  /* ── Load Organism Packages ── */
  const loadOrganismPackages = useCallback(async () => {
    if (!session?.organisms || session.organisms.length === 0) return;
    setOrganismLoading(true);
    try {
      const all = [];
      for (const org of session.organisms) {
        try {
          const resp = await knowledgeService.listOrganismPackages(org.id || org.organismId);
          const pkgs = resp?.data?.packages || [];
          all.push(...pkgs.map(p => ({ ...p, organismName: org.name || org.id })));
        } catch { /* skip */ }
      }
      setOrganismPackages(all);
    } catch { setOrganismPackages([]); }
    finally { setOrganismLoading(false); }
  }, [session?.organisms]);

  useEffect(() => { loadOrganismPackages(); }, [loadOrganismPackages]);

  /* ── Copy Prompt to Clipboard ── */
  const copyPrompt = useCallback(async (type) => {
    try {
      const resp = type === 'human'
        ? await knowledgeService.getHumanPrompt()
        : await knowledgeService.getAgentPrompt();
      const text = resp?.data?.prompt;
      if (text) {
        await copyToClipboard(text);
        showToast(t('knowledge.actionBar.copy' + (type === 'human' ? 'HumanPrompt' : 'AgentPrompt')) + ' \u2713');
      } else {
        showToast('Prompt template not available yet');
      }
    } catch (err) {
      showToast(t('profile.knowledge.copyFailed'));
    }
  }, [showToast]);

  /* ── Import: Parse pasted text ── */
  const handleImportPaste = useCallback((text) => {
    setImportText(text);
    setImportError('');
    setImportPreview(null);

    if (!text.trim()) return;

    try {
      let jsonStr = text;
      const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (codeBlockMatch) jsonStr = codeBlockMatch[1];

      const parsed = JSON.parse(jsonStr.trim());

      if (!parsed.aimeat_knowledge_package && !parsed.package) {
        setImportError(t('profile.knowledge.notKnowledgePackage'));
        return;
      }

      const pkg = parsed.package || parsed;
      const targetGhii = parsed.target_ghii || pkg.author || '';

      setImportPreview({
        raw: parsed,
        pkg,
        targetGhii,
        targetNode: parsed.target_node || '',
        ghiiMatch: !targetGhii || targetGhii === ghii,
        entryOverrides: {},
        catalogListed: pkg.sharing?.catalog_listed ?? true,
        organismShare: '',
      });
    } catch (e) {
      setImportError(t('profile.knowledge.parseError'));
    }
  }, [ghii]);

  /* ── Import: Confirm ── */
  const confirmImport = useCallback(async () => {
    if (!importPreview) return;
    setImporting(true);
    try {
      const overrides = {
        entries: importPreview.entryOverrides,
        catalog_listed: importPreview.catalogListed,
        organism_share: importPreview.organismShare || undefined,
      };
      const entryData = importPreview.raw?.entry_data || null;
      const result = await knowledgeService.importPackage(importPreview.pkg, overrides, entryData);
      if (result?.data?.package_id) {
        showToast(t('knowledge.import.success'));
        setImportText('');
        setImportPreview(null);
        loadPackages();
      } else {
        showToast(t('knowledge.import.error'));
      }
    } catch (err) {
      showToast(t('knowledge.import.error'));
    } finally { setImporting(false); }
  }, [importPreview, showToast, loadPackages]);

  /* ── Delete ── */
  const handleDelete = useCallback(async (pkg) => {
    const manifest = pkg.value;
    const name = manifest?.name || 'Untitled';
    confirm(t('knowledge.myKnowledge.confirmDelete')?.replace('{name}', name)
        || `Delete "${name}"? This cannot be undone.`, async () => {
      setDeleting(pkg.key);
      try {
        await knowledgeService.deletePackage(ghii, manifest?.id || pkg.key.split('/')[1] || pkg.key);
        showToast(t('knowledge.myKnowledge.deleted') || 'Package deleted');
        setExpandedPkg(null);
        loadPackages();
      } catch {
        showToast(t('knowledge.myKnowledge.deleteError') || 'Failed to delete package');
      } finally { setDeleting(null); }
    }, { danger: true });
  }, [ghii, showToast, loadPackages]);

  /* ── Export ── */
  const handleExport = useCallback(async (pkg) => {
    const manifest = pkg.value;
    const packageId = manifest?.id || pkg.key.split('/')[1] || pkg.key;
    try {
      const resp = await knowledgeService.exportPackage(packageId);
      const json = JSON.stringify(resp?.data || manifest, null, 2);
      await copyToClipboard(json);
      showToast(t('knowledge.myKnowledge.exportCopied') || 'Package JSON copied to clipboard');
    } catch {
      // Fallback: export the manifest we already have
      try {
        await copyToClipboard(JSON.stringify(manifest, null, 2));
        showToast(t('knowledge.myKnowledge.exportCopied') || 'Package JSON copied to clipboard');
      } catch {
        showToast('Failed to export package');
      }
    }
  }, [showToast]);

  /* ── Clone ── */
  const handleClone = useCallback(async (packageId) => {
    try {
      const result = await knowledgeService.clonePackage(packageId, 'cloned');
      if (result?.data?.cloned_package_id) {
        showToast(t('profile.knowledge.cloned'));
        loadPackages();
      } else {
        showToast(t('profile.knowledge.cloneFailed'));
      }
    } catch { showToast(t('profile.knowledge.cloneFailed')); }
  }, [showToast, loadPackages]);

  /* ── Update sharing settings ── */
  const handleSharingChange = useCallback(async (pkg, field, value) => {
    const manifest = pkg.value;
    const packageId = manifest?.id || pkg.key.split('/')[1] || pkg.key;
    setSavingSharing(pkg.key);
    try {
      const update = { [field]: value };
      // If enabling catalog_listed, also enable allow_clone
      if (field === 'catalog_listed' && value && !manifest.sharing?.allow_clone) {
        update.allow_clone = true;
      }
      const result = await knowledgeService.updateSharing(packageId, update);
      if (result?.data?.sharing) {
        showToast(t('knowledge.myKnowledge.saved') || 'Settings saved');
        loadPackages();
      } else {
        showToast(t('knowledge.myKnowledge.saveError') || 'Failed to save settings');
      }
    } catch {
      showToast(t('knowledge.myKnowledge.saveError') || 'Failed to save settings');
    } finally { setSavingSharing(null); }
  }, [showToast, loadPackages]);

  /* ── Change entry visibility ── */
  const handleEntryVisibility = useCallback(async (pkg, entry, newVis) => {
    const manifest = pkg.value;
    const packageId = manifest?.id || pkg.key.split('/')[1] || pkg.key;
    const entryKey = entry.key;
    // Optimistic update — change locally first
    setPackages(prev => prev.map(p => {
      if (p.key !== pkg.key) return p;
      const updatedEntries = (p.value?.entries || []).map(e =>
        e.key === entryKey ? { ...e, visibility: newVis } : e
      );
      return { ...p, value: { ...p.value, entries: updatedEntries } };
    }));
    try {
      const result = await knowledgeService.updateEntryVisibility(packageId, entryKey, newVis);
      if (!result?.data?.visibility) {
        showToast(result?.error?.message || (t('knowledge.myKnowledge.saveError') || 'Failed'));
        loadPackages(); // Revert on error
      }
    } catch {
      showToast(t('knowledge.myKnowledge.saveError') || 'Failed');
      loadPackages(); // Revert on error
    }
  }, [showToast, loadPackages]);

  /* ── Toggle expand + lazy-load entry data via list endpoint ── */
  const toggleExpand = useCallback(async (key) => {
    if (expandedPkg === key) { setExpandedPkg(null); return; }
    setExpandedPkg(key);

    // Fetch all entry values for this package in one call
    const pkg = packages.find(p => p.key === key);
    const manifest = pkg?.value;
    if (!manifest?.entries?.length) return;
    const hasUncached = manifest.entries.some(e => e.key && !(e.key in entryData));
    if (!hasUncached) return;

    // Extract package UUID from key: packages/{uuid}/manifest
    const pkgId = key.split('/')[1];
    if (!pkgId) return;

    setLoadingEntries(key);
    try {
      const resp = await apiGet('/v1/memory?prefix=' + encodeURIComponent(`packages/${pkgId}/`));
      const items = resp?.data?.items || [];
      setEntryData(prev => {
        const next = { ...prev };
        for (const item of items) {
          if (item.key && item.key !== key) next[item.key] = item.value;
        }
        return next;
      });
    } catch { /* ignore */ }
    finally { setLoadingEntries(null); }
  }, [expandedPkg, packages, entryData]);

  /* ── Cycle visibility: private → owner → group → public → private ── */
  const cycleVis = ['private', 'owner', 'group', 'public'];
  const visColor = { private: '#c084fc', owner: '#60a5fa', group: '#10b981', public: '#4ade80' };
  const visBg = { private: 'rgba(150,100,200,.2)', owner: 'rgba(100,150,255,.2)', group: 'rgba(16,185,129,.2)', public: 'rgba(0,200,100,.2)' };

  /* ── Scroll to entry by key (matches full or short key) ── */
  const scrollToEntry = useCallback((entryKey) => {
    // Try exact match first, then suffix match for short keys
    let el = document.querySelector(`[data-entry-key="${CSS.escape(entryKey)}"]`);
    if (!el) {
      const all = document.querySelectorAll('[data-entry-key]');
      for (const candidate of all) {
        if (candidate.dataset.entryKey.endsWith('/' + entryKey)) { el = candidate; break; }
      }
    }
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('kpkg-entry-highlight'); setTimeout(() => el.classList.remove('kpkg-entry-highlight'), 1500); }
  }, []);

  /* ── Render per-entry references ── */
  const renderEntryRefs = (refs) => {
    if (!refs || refs.length === 0) return null;
    return html`
      <div class="kpkg-entry-refs">
        ${refs.map((ref, i) => html`
          <div key=${i} class="kpkg-ref pf-ref-row ${ref.verified ? 'kpkg-ref-verified' : 'kpkg-ref-unverified'}">
            <span class="pf-ref-icon">${ref.verified ? '\u2713' : '?'}</span>
            ${ref.url ? html`
              <a href=${ref.url} target="_blank" rel="noopener" class="kpkg-ref-link">
                ${escHtml(ref.title || ref.url)}
                <span class="pf-external-icon"> \u2197</span>
              </a>
            ` : html`<span class="pf-ref-title">${escHtml(ref.title || 'Untitled')}</span>`}
            ${ref.type ? html`<span class="kpkg-badge pf-badge-xs">${escHtml(ref.type)}</span>` : null}
          </div>
        `)}
      </div>
    `;
  };

  /* ── Render related entries chips ── */
  const relationLabels = { 'related-to': 'related', 'extends': 'extends', 'derived-from': 'from', 'contradicts': 'contradicts', 'supersedes': 'supersedes', 'references': 'refs' };
  const renderRelatedEntries = (rels, allEntries) => {
    if (!rels || rels.length === 0) return null;
    return html`
      <div class="kpkg-entry-relations">
        ${rels.map((rel, i) => {
          const targetEntry = allEntries.find(e => e.key === rel.key || e.key.endsWith('/' + rel.key));
          const targetLabel = targetEntry ? (targetEntry.title || rel.key) : rel.key;
          const shortKey = rel.key.includes('/') ? rel.key.split('/').pop() : rel.key;
          return html`
            <button key=${i} class="kpkg-relation-chip" onClick=${(e) => { e.stopPropagation(); scrollToEntry(rel.key); }}
              title="${relationLabels[rel.relation] || rel.relation}: ${targetLabel}">
              <span class="kpkg-relation-type">${relationLabels[rel.relation] || rel.relation}</span>
              ${escHtml(targetLabel)}
            </button>
          `;
        })}
      </div>
    `;
  };

  /* ── Format entry value for display ── */
  const formatEntryValue = (data) => {
    if (!data) return '';
    if (typeof data === 'string') return data;
    // Show structured content nicely: body/summary first, then other fields
    const parts = [];
    if (data.summary) parts.push(data.summary);
    if (data.body) parts.push(data.body);
    if (data.description) parts.push(data.description);
    if (data.findings?.length) parts.push('Findings:\n' + data.findings.map(f => '  - ' + f).join('\n'));
    if (data.steps?.length) parts.push('Steps:\n' + data.steps.map((s, i) => `  ${i + 1}. ${typeof s === 'string' ? s : JSON.stringify(s)}`).join('\n'));
    if (data.items?.length) parts.push('Items:\n' + data.items.map(it => '  - ' + (it.title || JSON.stringify(it))).join('\n'));
    if (data.open_questions?.length) parts.push('Open Questions:\n' + data.open_questions.map(q => '  - ' + q).join('\n'));
    if (parts.length > 0) return parts.join('\n\n');
    return JSON.stringify(data, null, 2);
  };

  /* ── Render entry row ── */
  const renderEntry = (entry, i, pkg) => {
    const manifest = pkg.value;
    const allEntries = manifest?.entries || [];
    const label = entry.title || entry.key || `Entry ${i + 1}`;
    // Look up actual entry data from fetched entryData, fall back to inline value
    const rawData = entryData[entry.key] ?? entry.value;
    const val = formatEntryValue(rawData);
    const vis = entry.visibility || 'private';
    const nextVis = cycleVis[(cycleVis.indexOf(vis) + 1) % cycleVis.length];
    const entryKey = entry.key || '';
    return html`
      <div class="kpkg-detail-entry" key=${i} data-entry-key=${entryKey}>
        <div class="kpkg-detail-entry-header">
          <button class="kpkg-vis-pill"
            onClick=${(e) => { e.stopPropagation(); handleEntryVisibility(pkg, entry, nextVis); }}
            title="${t('knowledge.visibility.' + vis)} → ${t('knowledge.visibility.' + nextVis)}"
            style="background:${visBg[vis]};color:${visColor[vis]};border-color:${visColor[vis]}"
          >${t('knowledge.visibility.' + vis)} ▾</button>
          <strong>${escHtml(label)}</strong>
          ${entry.key && entry.key !== label ? html`<span class="kpkg-detail-key">${escHtml(entry.key)}</span>` : null}
        </div>
        ${loadingEntries === pkg.key && !rawData ? html`<p class="kpkg-detail-loading">${t('common.loading')}</p>` : null}
        ${val && html`<pre class="kpkg-detail-value">${val}</pre>`}
        ${renderEntryRefs(entry.references)}
        ${renderRelatedEntries(entry.related_entries, allEntries)}
      </div>
    `;
  };

  /* ── Render ── */
  return html`
    <div class="kpkg-tab">

      <!-- ACTION BAR -->
      <div class="kpkg-action-bar">
        <div class="kpkg-action-buttons">
          <button class="btn-primary" onClick=${() => copyPrompt('human')}>
            ${t('knowledge.actionBar.copyHumanPrompt')}
          </button>
          <button class="btn-outline" onClick=${() => copyPrompt('agent')}>
            ${t('knowledge.actionBar.copyAgentPrompt')}
          </button>
          <button class="btn-outline" onClick=${() => window.open('/v1/publicknowledgeviewer', '_blank')}>
            ${t('knowledge.actionBar.publicViewer')} ↗
          </button>
        </div>
        <p class="kpkg-action-desc">${t('knowledge.actionBar.description')}</p>
      </div>

      <!-- IMPORT BOX -->
      <div class="kpkg-import-box">
        <h3>${t('knowledge.import.title')}</h3>
        <textarea
          class="kpkg-import-textarea"
          placeholder=${t('knowledge.import.placeholder')}
          value=${importText}
          onInput=${(e) => handleImportPaste(e.target.value)}
          rows="4"
        />
        <p class="kpkg-import-note">${t('knowledge.import.agentNote')}</p>

        ${importError && html`<div class="kpkg-error">${importError}</div>`}

        ${importPreview && html`
          <div class="kpkg-preview">
            <h4>${t('knowledge.import.preview')}</h4>
            <div class="kpkg-preview-meta">
              <span class="kpkg-badge kpkg-badge-type">${t('knowledge.contentTypes.' + (importPreview.pkg.content_type || 'document')) || (importPreview.pkg.content_type || 'document').toUpperCase()}</span>
              <span class="kpkg-badge kpkg-badge-synthesis">${t('knowledge.synthesis.' + (importPreview.pkg.synthesis?.level || 'original'))}</span>
              <strong>${escHtml(importPreview.pkg.name || importPreview.pkg.title || importPreview.pkg.id || 'Untitled')}</strong>
            </div>

            ${importPreview.ghiiMatch
              ? html`<p class="kpkg-ghii-ok">${t('knowledge.import.ghiiConfirm').replace('{ghii}', ghii)}</p>`
              : html`<p class="kpkg-ghii-warn">${t('knowledge.import.ghiiMismatch').replace('{ghii}', importPreview.targetGhii)}</p>`
            }

            <div class="kpkg-preview-entries">
              ${(importPreview.pkg.entries || []).map((entry, i) => {
                const label = entry.title || entry.key || `Entry ${i + 1}`;
                const eData = importPreview.raw?.entry_data?.[entry.key] || entry.value;
                const val = typeof eData === 'string' ? eData : (eData?.body || eData?.summary || eData?.description || (eData ? JSON.stringify(eData) : ''));
                const truncVal = val.length > 120 ? val.slice(0, 120) + '\u2026' : val;
                const entryRefs = entry.references || [];
                const entryRels = entry.related_entries || [];
                return html`
                  <div class="kpkg-preview-entry" key=${i}>
                    <span class="kpkg-badge kpkg-badge-${(entry.visibility === 'shared' ? 'owner' : entry.visibility) || 'private'}">${t('knowledge.visibility.' + ((entry.visibility === 'shared' ? 'owner' : entry.visibility) || 'private'))}</span>
                    <strong class="kpkg-entry-key">${escHtml(label)}</strong>
                    ${truncVal && html`<p class="kpkg-entry-value">${escHtml(truncVal)}</p>`}
                    ${entryRefs.length > 0 && html`
                      <div class="kpkg-preview-entry-refs">
                        ${entryRefs.map((ref, ri) => html`
                          <span key=${ri} class="kpkg-ref-chip ${ref.verified ? 'kpkg-ref-verified' : 'kpkg-ref-unverified'}">
                            ${ref.verified ? '\u2713' : '?'} ${escHtml(ref.title || ref.url || 'ref')}
                          </span>
                        `)}
                      </div>
                    `}
                    ${entryRels.length > 0 && html`
                      <div class="kpkg-preview-entry-rels">
                        ${entryRels.map((rel, ri) => html`
                          <span key=${ri} class="kpkg-relation-chip kpkg-relation-chip-preview">
                            <span class="kpkg-relation-type">${relationLabels[rel.relation] || rel.relation}</span>
                            ${escHtml(rel.key)}
                          </span>
                        `)}
                      </div>
                    `}
                  </div>
                `;
              })}
            </div>

            ${(() => {
              // Legacy: show package-level refs only if entries don't have their own
              const entries = importPreview.pkg.entries || [];
              const hasPerEntryRefs = entries.some(e => e.references && e.references.length > 0);
              const pkgRefs = importPreview.pkg.references || [];
              if (pkgRefs.length > 0 && !hasPerEntryRefs) return html`
                <div class="kpkg-preview-refs">
                  <strong>${t('profile.knowledge.referencesPackageLevel')}</strong>
                  ${pkgRefs.map((ref, i) => html`
                    <div key=${i} class="kpkg-ref ${ref.verified ? 'kpkg-ref-verified' : 'kpkg-ref-unverified'}">
                      ${ref.verified ? '\u2713' : '?'} ${escHtml(ref.title)}
                    </div>
                  `)}
                </div>
              `;
              return null;
            })()}

            <label class="kpkg-toggle">
              <input type="checkbox"
                checked=${importPreview.catalogListed}
                onChange=${(e) => setImportPreview({ ...importPreview, catalogListed: e.target.checked })}
              />
              ${t('knowledge.import.catalogToggle')}
            </label>

            <div class="kpkg-preview-summary">
              ${t('knowledge.import.willCreate')
                .replace('{entries}', String((importPreview.pkg.entries || []).length))
                .replace('{consents}', importPreview.organismShare ? '1' : '0')}
            </div>
            <button
              class="btn-primary"
              onClick=${confirmImport}
              disabled=${importing}
            >
              ${importing ? '...' : t('knowledge.import.confirmImport')}
            </button>
          </div>
        `}
      </div>

      <!-- MY KNOWLEDGE -->
      <div class="kpkg-section">
        <h3>${t('knowledge.myKnowledge.title')}</h3>
        ${loading && html`<${Spinner} text=${t('common.loading')} />`}
        ${!loading && packages.length === 0 && html`
          <p class="kpkg-empty">${t('knowledge.myKnowledge.empty')}</p>
        `}
        ${!loading && packages.map(pkg => {
          const manifest = pkg.value;
          if (!manifest || manifest.type !== 'knowledge-package') return null;
          const isExpanded = expandedPkg === pkg.key;
          const entries = manifest.entries || [];
          return html`
            <div class="kpkg-card ${isExpanded ? 'kpkg-card-expanded' : ''}" key=${pkg.key}>
              <div class="kpkg-card-header kpkg-card-clickable" onClick=${() => toggleExpand(pkg.key)}>
                <span class="kpkg-expand-icon">${isExpanded ? '\u25BC' : '\u25B6'}</span>
                <strong>${escHtml(manifest.name || 'Untitled')}</strong>
                <span class="kpkg-badge kpkg-badge-type">${t('knowledge.contentTypes.' + (manifest.content_type || 'document')) || (manifest.content_type || 'document').toUpperCase()}</span>
                <span class="kpkg-badge kpkg-badge-synthesis">${t('knowledge.synthesis.' + (manifest.synthesis?.level || 'original'))}</span>
                <span class="kpkg-badge kpkg-badge-${manifest.maturity || 'draft'}">${t('knowledge.maturity.' + (manifest.maturity || 'draft'))}</span>
                ${(() => {
                  const pkgId = manifest?.id || pkg.key.split('/')[1] || pkg.key;
                  const isFed = !!fedConsents[pkgId];
                  return html`<button
                    class="badge ${isFed ? 'badge-success' : 'badge-muted'} kpkg-fed-toggle"
                    title=${t('profile.federateTooltip')}
                    disabled=${togglingFed === pkg.key}
                    onClick=${(e) => { e.stopPropagation(); toggleFederation(pkg); }}
                  >${togglingFed === pkg.key ? '...' : isFed ? t('knowledge.federated') : t('knowledge.notFederated')}</button>`;
                })()}
              </div>
              <div class="kpkg-card-tags">
                ${(manifest.tags || []).map(tag => html`<span class="kpkg-tag" key=${tag}>${escHtml(tag)}</span>`)}
              </div>
              <div class="kpkg-card-info">
                <span>${t('knowledge.myKnowledge.entries').replace('{count}', String(entries.length))}</span>
                ${manifest.version ? html`<span>v${escHtml(manifest.version)}</span>` : null}
                ${manifest.language ? html`<span>${escHtml(manifest.language.toUpperCase())}</span>` : null}
              </div>

              <!-- Action buttons -->
              <div class="kpkg-card-actions">
                <button class="btn-outline btn-sm" onClick=${(e) => { e.stopPropagation(); handleExport(pkg); }}>
                  ${t('knowledge.myKnowledge.export')}
                </button>
                <button class="btn-danger-solid btn-sm" onClick=${(e) => { e.stopPropagation(); handleDelete(pkg); }}
                  disabled=${deleting === pkg.key}>
                  ${deleting === pkg.key ? '...' : t('profile.delete')}
                </button>
              </div>

              <!-- Expanded detail view -->
              ${isExpanded && html`
                <div class="kpkg-detail">
                  ${manifest.synthesis?.description ? html`
                    <p class="kpkg-detail-synthesis">${escHtml(manifest.synthesis.description)}</p>
                  ` : null}

                  <!-- Sharing settings -->
                  <div class="kpkg-sharing-settings pf-sharing-box">
                    <h4 class="pf-sharing-heading">${t('knowledge.myKnowledge.shareSettings')}</h4>
                    <label class="kpkg-toggle mb-half">
                      <input type="checkbox"
                        checked=${manifest.sharing?.catalog_listed}
                        disabled=${savingSharing === pkg.key}
                        onChange=${(e) => handleSharingChange(pkg, 'catalog_listed', e.target.checked)}
                      />
                      ${t('knowledge.myKnowledge.catalogListed')}
                    </label>
                    <label class="kpkg-toggle">
                      <input type="checkbox"
                        checked=${manifest.sharing?.allow_clone}
                        disabled=${savingSharing === pkg.key}
                        onChange=${(e) => handleSharingChange(pkg, 'allow_clone', e.target.checked)}
                      />
                      ${t('knowledge.myKnowledge.allowClone')}
                    </label>
                  </div>

                  <div class="kpkg-detail-entries">
                    <h4>${t('knowledge.myKnowledge.entries').replace('{count}', String(entries.length))}</h4>
                    ${entries.map((entry, i) => renderEntry(entry, i, pkg))}
                    ${entries.length === 0 && html`<p class="kpkg-empty">No entries</p>`}
                  </div>

                  ${(() => {
                    // Show package-level refs only for legacy packages where entries lack per-entry refs
                    const hasPerEntryRefs = entries.some(e => e.references && e.references.length > 0);
                    const pkgRefs = manifest.references || [];
                    if (pkgRefs.length > 0 && !hasPerEntryRefs) return html`
                      <div class="kpkg-detail-refs">
                        <h4>${t('knowledge.myKnowledge.references') || 'References'} (${t('knowledge.myKnowledge.packageLevel') || 'package-level'})</h4>
                        ${pkgRefs.map((ref, i) => html`
                          <div key=${i} class="kpkg-ref pf-ref-row ${ref.verified ? 'kpkg-ref-verified' : 'kpkg-ref-unverified'}">
                            <span class="pf-ref-icon">${ref.verified ? '\u2705' : '\u2753'}</span>
                            ${ref.url ? html`
                              <a href=${ref.url} target="_blank" rel="noopener" class="kpkg-ref-link">
                                ${escHtml(ref.title || ref.url)}
                                <span class="pf-external-icon"> \u2197</span>
                              </a>
                            ` : html`<span>${escHtml(ref.title || 'Untitled')}</span>`}
                            ${ref.type ? html`<span class="kpkg-badge pf-badge-xs">${escHtml(ref.type)}</span>` : null}
                          </div>
                        `)}
                      </div>
                    `;
                    return null;
                  })()}

                  <div class="kpkg-detail-meta">
                    <span>ID: ${escHtml(manifest.id || pkg.key)}</span>
                    ${manifest.author ? html`<span>Author: ${escHtml(manifest.author)}</span>` : null}
                  </div>
                </div>
              `}
            </div>
          `;
        })}
      </div>

      <!-- SHARED WITH ME -->
      <div class="kpkg-section">
        <h3>${t('knowledge.sharedWithMe.title')}</h3>
        <p class="kpkg-empty">${t('knowledge.sharedWithMe.empty')}</p>
      </div>

      <!-- KNOWLEDGE ORGANISMS -->
      <div class="kpkg-section">
        <h3>${t('knowledge.organisms.title')}</h3>
        ${organismLoading && html`<${Spinner} text=${t('common.loading')} />`}
        ${!organismLoading && organismPackages.length === 0 && html`
          <p class="kpkg-empty">${t('knowledge.organisms.empty')}</p>
        `}
        ${!organismLoading && organismPackages.map((pkg, i) => html`
          <div class="kpkg-card" key=${i}>
            <div class="kpkg-card-header">
              <strong>${escHtml(pkg.manifest?.name || 'Untitled')}</strong>
              <span class="kpkg-badge kpkg-badge-type">${escHtml(pkg.organismName || '')}</span>
            </div>
            <div class="kpkg-card-stats">
              <span>Contributed ${pkg.contributed_at ? pkg.contributed_at.slice(0, 10) : ''}</span>
            </div>
          </div>
        `)}
      </div>

      <!-- DISCOVER -->
      <div class="kpkg-section">
        <h3>${t('knowledge.discover.title')}</h3>
        ${discoverLoading && html`<${Spinner} text=${t('common.loading')} />`}
        ${!discoverLoading && discovered.filter(p => p.sharing?.allow_clone !== false).length === 0 && html`
          <p class="kpkg-empty">${t('knowledge.discover.empty')}</p>
        `}
        ${!discoverLoading && discovered.filter(pkg => pkg.sharing?.allow_clone !== false).map(pkg => html`
          <div class="kpkg-card" key=${pkg.package_id}>
            <div class="kpkg-card-header">
              <strong>${escHtml(pkg.name || 'Untitled')}</strong>
              <span class="kpkg-badge kpkg-badge-type">${t('knowledge.contentTypes.' + (pkg.content_type || 'document')) || (pkg.content_type || 'document').toUpperCase()}</span>
              <span class="kpkg-badge kpkg-badge-synthesis">${t('knowledge.synthesis.' + (pkg.synthesis?.level || 'original'))}</span>
              <span class="kpkg-badge kpkg-badge-${pkg.maturity || 'draft'}">${t('knowledge.maturity.' + (pkg.maturity || 'draft'))}</span>
            </div>
            <div class="kpkg-card-meta">
              <span class="kpkg-card-author">by ${escHtml(pkg.author || 'unknown')}</span>
              <span>${t('knowledge.myKnowledge.entries').replace('{count}', String(pkg.entries_count || 0))}</span>
            </div>
            <div class="kpkg-card-tags">
              ${(pkg.tags || []).map(tag => html`<span class="kpkg-tag" key=${tag}>${escHtml(tag)}</span>`)}
            </div>
            <div class="kpkg-card-actions">
              <button class="btn-outline btn-sm" onClick=${() => handleClone(pkg.package_id)}>
                ${t('knowledge.discover.cloneToMine')}
              </button>
            </div>
            <p class="kpkg-trust-advisory">${t('knowledge.discover.trustAdvisory')}</p>
          </div>
        `)}
      </div>

      <${ConfirmUI} />
    </div>
  `;
}
