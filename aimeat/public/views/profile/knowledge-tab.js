import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { apiGet } from '/js/api.js';
import { Spinner } from './shared.js';
import * as knowledgeService from '/js/services/knowledge.js';

export default function KnowledgeTab({ session, showToast, onStats }) {
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importText, setImportText] = useState('');
  const [importPreview, setImportPreview] = useState(null);
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);

  /* ── UI state ── */
  const [expandedPkg, setExpandedPkg] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [savingSharing, setSavingSharing] = useState(null);

  /* ── Discovery state ── */
  const [discovered, setDiscovered] = useState([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);

  /* ── Organism state ── */
  const [organismPackages, setOrganismPackages] = useState([]);
  const [organismLoading, setOrganismLoading] = useState(false);

  const ghii = session?.ghii || session?.owner || '';
  const nodeUrl = window.location.origin;
  const nodeId = session?.nodeId || '';

  const loadPackages = useCallback(async () => {
    try {
      setLoading(true);
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
    } catch { setPackages([]); }
    finally { setLoading(false); }
  }, [onStats]);

  useEffect(() => { loadPackages(); }, [loadPackages]);

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
        await navigator.clipboard.writeText(text);
        showToast(t('knowledge.actionBar.copy' + (type === 'human' ? 'HumanPrompt' : 'AgentPrompt')) + ' \u2713');
      } else {
        showToast('Prompt template not available yet');
      }
    } catch (err) {
      showToast('Failed to copy prompt');
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
      const codeBlockMatch = text.match(/\`\`\`(?:json)?\s*\n?([\s\S]*?)\n?\`\`\`/);
      if (codeBlockMatch) jsonStr = codeBlockMatch[1];

      const parsed = JSON.parse(jsonStr.trim());

      if (!parsed.aimeat_knowledge_package && !parsed.package) {
        setImportError('This doesn\'t look like an AIMEAT knowledge package. Make sure you paste the complete JSON output.');
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
      setImportError('Could not parse the pasted content as JSON. Make sure you copy the complete output from your AI chat.');
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
      const result = await knowledgeService.importPackage(importPreview.pkg, overrides);
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
    if (!confirm(t('knowledge.myKnowledge.confirmDelete')?.replace('{name}', name)
        || `Delete "${name}"? This cannot be undone.`)) return;
    setDeleting(pkg.key);
    try {
      await knowledgeService.deletePackage(ghii, manifest?.id || pkg.key.split('/')[1] || pkg.key);
      showToast(t('knowledge.myKnowledge.deleted') || 'Package deleted');
      setExpandedPkg(null);
      loadPackages();
    } catch {
      showToast(t('knowledge.myKnowledge.deleteError') || 'Failed to delete package');
    } finally { setDeleting(null); }
  }, [ghii, showToast, loadPackages]);

  /* ── Export ── */
  const handleExport = useCallback(async (pkg) => {
    const manifest = pkg.value;
    const packageId = manifest?.id || pkg.key.split('/')[1] || pkg.key;
    try {
      const resp = await knowledgeService.exportPackage(packageId);
      const json = JSON.stringify(resp?.data || manifest, null, 2);
      await navigator.clipboard.writeText(json);
      showToast(t('knowledge.myKnowledge.exportCopied') || 'Package JSON copied to clipboard');
    } catch {
      // Fallback: export the manifest we already have
      try {
        await navigator.clipboard.writeText(JSON.stringify(manifest, null, 2));
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
        showToast('Package cloned successfully!');
        loadPackages();
      } else {
        showToast('Clone failed');
      }
    } catch { showToast('Clone failed'); }
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
    try {
      const result = await knowledgeService.updateEntryVisibility(packageId, entryKey, newVis);
      if (result?.data?.visibility) {
        showToast(t('knowledge.myKnowledge.saved') || 'Saved');
        loadPackages();
      } else {
        showToast(result?.error?.message || (t('knowledge.myKnowledge.saveError') || 'Failed'));
      }
    } catch {
      showToast(t('knowledge.myKnowledge.saveError') || 'Failed');
    }
  }, [showToast, loadPackages]);

  /* ── Toggle expand ── */
  const toggleExpand = useCallback((key) => {
    setExpandedPkg(prev => prev === key ? null : key);
  }, []);

  /* ── Render entry row ── */
  const renderEntry = (entry, i, pkg) => {
    const label = entry.title || entry.key || `Entry ${i + 1}`;
    const val = typeof entry.value === 'string' ? entry.value : (entry.value ? JSON.stringify(entry.value, null, 2) : '');
    const vis = entry.visibility || 'private';
    const visOptions = ['private', 'owner', 'public'];
    return html`
      <div class="kpkg-detail-entry" key=${i}>
        <div class="kpkg-detail-entry-header">
          <select class="kpkg-vis-select" value=${vis}
            onChange=${(e) => handleEntryVisibility(pkg, entry, e.target.value)}
            style="font-size:.7rem;padding:1px 4px;border-radius:4px;border:1px solid rgba(255,107,157,.3);cursor:pointer;font-weight:600;
              background:${vis === 'public' ? 'rgba(0,200,100,.15)' : vis === 'owner' ? 'rgba(100,150,255,.15)' : 'rgba(150,100,200,.15)'};
              color:${vis === 'public' ? '#4ade80' : vis === 'owner' ? '#60a5fa' : '#c084fc'}">
            ${visOptions.map(v => html`<option value=${v} key=${v}>${t('knowledge.visibility.' + v)}</option>`)}
          </select>
          <strong>${escHtml(label)}</strong>
          ${entry.key && entry.key !== label ? html`<span class="kpkg-detail-key">${escHtml(entry.key)}</span>` : null}
        </div>
        ${val && html`<pre class="kpkg-detail-value">${escHtml(val)}</pre>`}
      </div>
    `;
  };

  /* ── Render ── */
  return html`
    <div class="kpkg-tab">

      <!-- ACTION BAR -->
      <div class="kpkg-action-bar">
        <div class="kpkg-action-buttons">
          <button class="kpkg-btn kpkg-btn-primary" onClick=${() => copyPrompt('human')}>
            ${t('knowledge.actionBar.copyHumanPrompt')}
          </button>
          <button class="kpkg-btn kpkg-btn-secondary" onClick=${() => copyPrompt('agent')}>
            ${t('knowledge.actionBar.copyAgentPrompt')}
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
              <span class="kpkg-badge kpkg-badge-type">${t('knowledge.contentTypes.' + (importPreview.pkg.content_type || 'document'))}</span>
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
                const val = typeof entry.value === 'string' ? entry.value : (entry.value ? JSON.stringify(entry.value) : '');
                const truncVal = val.length > 120 ? val.slice(0, 120) + '\u2026' : val;
                return html`
                  <div class="kpkg-preview-entry" key=${i}>
                    <span class="kpkg-badge kpkg-badge-${entry.visibility || 'private'}">${t('knowledge.visibility.' + (entry.visibility || 'private'))}</span>
                    <strong class="kpkg-entry-key">${escHtml(label)}</strong>
                    ${truncVal && html`<p class="kpkg-entry-value">${escHtml(truncVal)}</p>`}
                  </div>
                `;
              })}
            </div>

            ${(importPreview.pkg.references || []).length > 0 && html`
              <div class="kpkg-preview-refs">
                <strong>References:</strong>
                ${importPreview.pkg.references.map((ref, i) => html`
                  <div key=${i} class="kpkg-ref ${ref.verified ? 'kpkg-ref-verified' : 'kpkg-ref-unverified'}">
                    ${ref.verified ? '\u2713' : '?'} ${escHtml(ref.title)}
                  </div>
                `)}
              </div>
            `}

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
              class="kpkg-btn kpkg-btn-primary"
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
        ${loading && html`<${Spinner} text="Loading..." />`}
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
                <span class="kpkg-badge kpkg-badge-type">${t('knowledge.contentTypes.' + (manifest.content_type || 'document'))}</span>
                <span class="kpkg-badge kpkg-badge-synthesis">${t('knowledge.synthesis.' + (manifest.synthesis?.level || 'original'))}</span>
                <span class="kpkg-badge kpkg-badge-${manifest.maturity || 'draft'}">${t('knowledge.maturity.' + (manifest.maturity || 'draft'))}</span>
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
                <button class="kpkg-btn kpkg-btn-secondary kpkg-btn-sm" onClick=${(e) => { e.stopPropagation(); handleExport(pkg); }}>
                  ${t('knowledge.myKnowledge.export')}
                </button>
                <button class="kpkg-btn kpkg-btn-danger kpkg-btn-sm" onClick=${(e) => { e.stopPropagation(); handleDelete(pkg); }}
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
                  <div class="kpkg-sharing-settings" style="margin-bottom:.75rem;padding:.5rem .75rem;border:1px solid rgba(255,107,157,.15);border-radius:8px;background:rgba(255,107,157,.03)">
                    <h4 style="margin:0 0 .5rem;font-size:.8rem">${t('knowledge.myKnowledge.shareSettings')}</h4>
                    <label class="kpkg-toggle" style="display:flex;align-items:center;gap:.5rem;margin-bottom:.35rem;font-size:.8rem;cursor:pointer">
                      <input type="checkbox"
                        checked=${manifest.sharing?.catalog_listed}
                        disabled=${savingSharing === pkg.key}
                        onChange=${(e) => handleSharingChange(pkg, 'catalog_listed', e.target.checked)}
                      />
                      ${t('knowledge.myKnowledge.catalogListed')}
                    </label>
                    <label class="kpkg-toggle" style="display:flex;align-items:center;gap:.5rem;font-size:.8rem;cursor:pointer">
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

                  ${(manifest.references || []).length > 0 && html`
                    <div class="kpkg-detail-refs">
                      <h4>${t('knowledge.myKnowledge.references') || 'References'}</h4>
                      ${manifest.references.map((ref, i) => html`
                        <div key=${i} class="kpkg-ref ${ref.verified ? 'kpkg-ref-verified' : 'kpkg-ref-unverified'}" style="display:flex;align-items:center;gap:.5rem;padding:.25rem 0">
                          <span>${ref.verified ? '\u2705' : '\u2753'}</span>
                          ${ref.url ? html`
                            <a href=${ref.url} target="_blank" rel="noopener" class="kpkg-ref-link" style="color:var(--love1,#ff6b9d);text-decoration:none">
                              ${escHtml(ref.title || ref.url)}
                              <span style="font-size:.7rem;opacity:.6"> \u2197</span>
                            </a>
                          ` : html`<span>${escHtml(ref.title || 'Untitled')}</span>`}
                          ${ref.type ? html`<span class="kpkg-badge" style="font-size:.6rem">${escHtml(ref.type)}</span>` : null}
                        </div>
                      `)}
                    </div>
                  `}

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
        ${organismLoading && html`<${Spinner} text="Loading..." />`}
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
        ${discoverLoading && html`<${Spinner} text="Loading..." />`}
        ${!discoverLoading && discovered.length === 0 && html`
          <p class="kpkg-empty">${t('knowledge.discover.empty')}</p>
        `}
        ${!discoverLoading && discovered.map(pkg => html`
          <div class="kpkg-card" key=${pkg.package_id}>
            <div class="kpkg-card-header">
              <strong>${escHtml(pkg.name || 'Untitled')}</strong>
              <span class="kpkg-badge kpkg-badge-type">${t('knowledge.contentTypes.' + (pkg.content_type || 'document'))}</span>
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
              ${pkg.sharing?.allow_clone !== false ? html`
                <button class="kpkg-btn kpkg-btn-secondary kpkg-btn-sm" onClick=${() => handleClone(pkg.package_id)}>
                  ${t('knowledge.discover.cloneToMine')}
                </button>
              ` : html`
                <span class="kpkg-clone-disabled">${t('knowledge.discover.cloneDisabled') || 'Cloning not available'}</span>
              `}
            </div>
            <p class="kpkg-trust-advisory">${t('knowledge.discover.trustAdvisory')}</p>
          </div>
        `)}
      </div>

    </div>
  `;
}
