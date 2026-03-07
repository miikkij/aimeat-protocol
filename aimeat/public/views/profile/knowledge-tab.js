import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Spinner } from './shared.js';
import * as knowledgeService from '/js/services/knowledge.js';

export default function KnowledgeTab({ session, showToast, onStats }) {
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importText, setImportText] = useState('');
  const [importPreview, setImportPreview] = useState(null);
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);

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
      setPackages(list);
      onStats?.({ knowledge: list.length });
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
              <strong>${escHtml(importPreview.pkg.name || 'Untitled')}</strong>
            </div>

            <!-- GHII Confirmation -->
            ${importPreview.ghiiMatch
              ? html`<p class="kpkg-ghii-ok">${t('knowledge.import.ghiiConfirm').replace('{ghii}', ghii)}</p>`
              : html`<p class="kpkg-ghii-warn">${t('knowledge.import.ghiiMismatch').replace('{ghii}', importPreview.targetGhii)}</p>`
            }

            <!-- Entries with visibility -->
            <div class="kpkg-preview-entries">
              ${(importPreview.pkg.entries || []).map((entry, i) => html`
                <div class="kpkg-preview-entry" key=${i}>
                  <span class="kpkg-badge kpkg-badge-${entry.visibility}">${t('knowledge.visibility.' + entry.visibility)}</span>
                  <span>${escHtml(entry.title)}</span>
                </div>
              `)}
            </div>

            <!-- References -->
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

            <!-- Catalog toggle -->
            <label class="kpkg-toggle">
              <input type="checkbox"
                checked=${importPreview.catalogListed}
                onChange=${(e) => setImportPreview({ ...importPreview, catalogListed: e.target.checked })}
              />
              ${t('knowledge.import.catalogToggle')}
            </label>

            <!-- Confirm -->
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
          return html`
            <div class="kpkg-card" key=${pkg.key}>
              <div class="kpkg-card-header">
                <strong>${escHtml(manifest.name || 'Untitled')}</strong>
                <span class="kpkg-badge kpkg-badge-type">${t('knowledge.contentTypes.' + (manifest.content_type || 'document'))}</span>
                <span class="kpkg-badge kpkg-badge-synthesis">${t('knowledge.synthesis.' + (manifest.synthesis?.level || 'original'))}</span>
                <span class="kpkg-badge kpkg-badge-${manifest.maturity || 'draft'}">${t('knowledge.maturity.' + (manifest.maturity || 'draft'))}</span>
              </div>
              <div class="kpkg-card-tags">
                ${(manifest.tags || []).map(tag => html`<span class="kpkg-tag" key=${tag}>${escHtml(tag)}</span>`)}
              </div>
              <div class="kpkg-card-stats">
                <span>${t('knowledge.myKnowledge.entries').replace('{count}', String((manifest.entries || []).length))}</span>
              </div>
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
              ${pkg.sharing?.allow_clone && html`
                <button class="kpkg-btn kpkg-btn-secondary" onClick=${() => handleClone(pkg.package_id)}>
                  ${t('knowledge.discover.cloneToMine')}
                </button>
              `}
            </div>
            <p class="kpkg-trust-advisory">${t('knowledge.discover.trustAdvisory')}</p>
          </div>
        `)}
      </div>

    </div>
  `;
}
