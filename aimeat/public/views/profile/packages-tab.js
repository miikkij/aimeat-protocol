/**
 * @file packages-tab.js
 * @description Profile tab for managing package instances, browsing available packages,
 *   and exploring the template gallery. Displays three sub-views: My Instances (installed
 *   packages with status/update/remove), Browse Packages (search/filter/install), and
 *   Template Gallery (community listings with ratings).
 * @structure
 *   - PackagesTab (default export) — main tab component with sub-view navigation
 * @usage
 *   import PackagesTab from './profile/packages-tab.js';
 *   <PackagesTab session={session} showToast={showToast} navigate={navigate} locale={locale} />
 * @version-history
 *   v1.0.0 — 2026-03-15 — initial implementation (Phase 6)
 *   v1.1.0 — 2026-03-16 — restyle to match extensions-tab pattern (grid cards, consistent CSS)
 *   v1.2.0 — 2026-03-17 — add "Open in Generator" / "Edit in Generator" buttons for
 *     importing packages into generator projects (fork vs edit detection)
 *   v1.3.0 — 2026-03-20 — add ZIP upload/download and template proposal buttons
 *   v1.4.0 — 2026-03-20 — add remote templates section with federation sync
 *   v1.5.0 — 2026-05-05 — add intro section, i18n for categories/featured, fix status badge label
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, copyToClipboard } from '/js/utils.js';
import { Spinner } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import * as pkgService from '/js/services/packages.js';
import { importPackageToGenerator } from '/js/services/generator-packaging.js';

export default function PackagesTab({ session, showToast, navigate, locale }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [instances, setInstances] = useState([]);
  const [packages, setPackages] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [remoteTemplates, setRemoteTemplates] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('instances');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');

  const loadData = useCallback(async ({ showSpinner = true } = {}) => {
    if (showSpinner) setLoading(true);
    try {
      const [instRes, pkgRes, tplRes] = await Promise.all([
        pkgService.listInstances({ status: 'installed' }),
        pkgService.listPackages({ author: session?.owner }),
        pkgService.listTemplates({ sort: 'newest' }),
      ]);
      if (instRes.ok) setInstances(instRes.data?.instances ?? []);
      if (pkgRes.ok) setPackages(pkgRes.data?.packages ?? []);
      if (tplRes.ok) setTemplates(tplRes.data?.templates ?? []);
      // Load remote/federated templates (best-effort)
      try {
        const fedRes = await pkgService.listFederationTemplates({ limit: 50 });
        if (fedRes.ok) setRemoteTemplates(fedRes.data?.templates ?? []);
      } catch (_) { /* federation may not be available */ }
    } catch (e) { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Live updates
  useEffect(() => {
    const handler = () => { loadData({ showSpinner: false }); }; // silent: don't flash blank
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [loadData]);

  const handleInstall = async (groupId) => {
    const label = prompt(t('packages.labelPrompt') || 'Instance label (optional):');
    if (label === null) return;
    const res = await pkgService.installPackage(groupId, { label: label || '' });
    if (res.ok) {
      showToast(t('packages.installed'));
      loadData();
    } else {
      showToast(res.error || 'Install failed', true);
    }
  };

  const handleRemove = async (id) => {
    confirm(t('packages.confirmRemove') || 'Remove this instance?', async () => {
      const res = await pkgService.removeInstance(id, true);
      if (res.ok) {
        showToast(t('packages.instanceRemoved'));
        loadData();
      } else {
        showToast(res.error || 'Remove failed', true);
      }
    }, { danger: true });
  };

  const handleCheckUpdate = async (id) => {
    const res = await pkgService.checkUpdate(id);
    if (res.ok && res.data) {
      if (res.data.updateAvailable) {
        confirm(
          `${t('packages.updateAvailable')}: ${res.data.latestVersion}\n\n${t('packages.applyUpdateConfirm') || 'Apply update? Your data (memory, settings) will be preserved. Apps, extensions, and schemas will be updated to the latest version.'}`,
          async () => {
            const instRes = await pkgService.getInstance(id);
            const installed = instRes.data?.installedComponents || [];
            const components = installed.map(c => ({
              componentId: c.componentId,
              action: (c.type === 'memory' || c.type === 'translation') ? 'skip' : 'replace',
            }));
            const applyRes = await pkgService.applyMigration(id, {
              targetVersion: res.data.latestVersion,
              components,
            });
            if (applyRes.ok) {
              showToast(t('packages.updateApplied') || 'Update applied successfully');
              loadData();
            } else {
              showToast(applyRes.error?.message || 'Update failed', true);
            }
          },
        );
      } else {
        showToast(t('packages.noUpdateAvailable'));
      }
    } else {
      showToast(res.error || 'Check failed', true);
    }
  };

  const handleOpenInGenerator = async (groupId, author) => {
    const currentUser = session?.owner || '';
    const isOwn = author === currentUser;
    if (!isOwn) {
      const ok = window.confirm(t('profile.generator.forkConfirm') || 'This will create your own copy of this package for editing. Continue?');
      if (!ok) return;
    }
    try {
      const newProjectId = await importPackageToGenerator(groupId, null, currentUser);
      showToast(t('profile.packages.importSuccess') || 'Package imported as generator project');
      navigate('generator');
    } catch (e) {
      showToast(e.message, true);
    }
  };

  const handleDownloadZip = async (groupId, name) => {
    try {
      const blob = await pkgService.exportPackageZip(groupId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      showToast(t('packages.exportFailed') || e.message, true);
    }
  };

  const handleUploadZip = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      await pkgService.importPackageZip(file);
      showToast(t('packages.importSuccess') || 'Package imported');
      loadData();
    } catch (err) {
      showToast(err.message || t('packages.importFailed'), true);
    }
  };

  const handleProposeAsTemplate = async (groupId) => {
    try {
      const res = await pkgService.proposeAsTemplate(groupId);
      if (res.ok) {
        showToast(t('packages.proposePending'));
        loadData();
      } else {
        showToast(res.error || 'Proposal failed', true);
      }
    } catch (e) {
      showToast(e.message, true);
    }
  };

  const handleSyncFederation = async () => {
    setSyncing(true);
    try {
      const res = await pkgService.syncFederationTemplates();
      if (res.ok) {
        showToast(t('packages.federation.syncSuccess') || 'Federation sync complete');
        loadData();
      } else {
        showToast(res.error?.message || 'Sync failed', true);
      }
    } catch (e) {
      showToast(e.message, true);
    }
    setSyncing(false);
  };

  const isOperator = session?.roles?.includes('operator');

  const copyPackagePrompt = async () => {
    try {
      const res = await fetch('/v1/prompts/package-builder');
      const json = await res.json();
      if (json.ok && json.data?.content) {
        copyToClipboard(json.data.content);
        showToast(t('packages.promptCopied') || 'Prompt copied! Paste it into AI Chat.');
      } else {
        showToast('Failed to load prompt', true);
      }
    } catch (e) {
      showToast('Failed to load prompt', true);
    }
  };

  if (loading) return html`<${Spinner} />`;

  const filtered = packages.filter(p => {
    if (search && !p.name?.toLowerCase().includes(search.toLowerCase()) && !p.description?.toLowerCase().includes(search.toLowerCase())) return false;
    if (category && p.category !== category) return false;
    return true;
  });

  return html`
    <div class="pkg-tab">
      <div class="section-title">${t('packages.title')}</div>
      <div class="section-desc">${t('packages.desc')}</div>
      <div style="display:flex;gap:.75rem;flex-wrap:wrap;margin-bottom:1.25rem;align-items:center">
        <button class="btn-primary" onClick=${copyPackagePrompt}>
          ${'\u{1F916}'} ${t('packages.createWithAi') || 'Create Package with AI'}
        </button>
        <span style="font-size:.8rem;color:var(--text-dim,#6B7280);max-width:420px">${t('packages.createWithAiDesc') || 'Copy this prompt and paste it into any AI. Describe what you want to build and the AI will create an installable package.'}</span>
      </div>
      <div class="pkg-nav">
        <button class=${view === 'instances' ? 'active' : ''} onClick=${() => setView('instances')}>
          \u{1F4E6} ${t('packages.myInstances') || 'My Instances'} (${instances.length})
        </button>
        <button class=${view === 'browse' ? 'active' : ''} onClick=${() => setView('browse')}>
          \u{1F50D} ${t('packages.browse') || 'Browse Packages'}
        </button>
        <button class=${view === 'gallery' ? 'active' : ''} onClick=${() => setView('gallery')}>
          \u{2B50} ${t('packages.gallery') || 'Template Gallery'}
        </button>
      </div>

      ${view === 'instances' && html`
        <div class="pkg-section">
          <h3>${t('packages.myInstances') || 'My Instances'}</h3>
          ${instances.length === 0 ? html`
            <p class="pkg-empty">${t('packages.noInstances') || 'No packages installed yet.'}</p>
          ` : html`
            <div class="pkg-grid">
              ${instances.map(inst => html`
                <div class="pkg-card" key=${inst.id}>
                  <div class="pkg-card-header">
                    <span class="pkg-card-name">${escHtml(inst.label || inst.packageGroupId)}</span>
                    <span class="pkg-badge pkg-badge-${inst.status}">${inst.status}</span>
                  </div>
                  <div class="pkg-card-meta">
                    <span class="pkg-card-version">${escHtml(inst.packageVersion)}</span>
                    <span>\u00B7 ${inst.installedComponents?.length ?? 0} ${t('packages.components') || 'components'}</span>
                  </div>
                  <div class="pkg-card-footer">
                    <div class="pkg-card-actions">
                      <button onClick=${() => handleCheckUpdate(inst.id)}>${t('packages.checkUpdate') || 'Check Update'}</button>
                      <button class="danger" onClick=${() => handleRemove(inst.id)}>${t('packages.remove') || 'Remove'}</button>
                    </div>
                  </div>
                </div>
              `)}
            </div>
          `}
        </div>
      `}

      ${view === 'browse' && html`
        <div class="pkg-section">
          <div class="pkg-section-header">
            <h3>${t('packages.browse') || 'Available Packages'}</h3>
            <input type="file" id="pkg-zip-file" accept=".zip" style="display:none" onChange=${handleUploadZip} />
            <button class="btn-outline" onClick=${() => document.getElementById('pkg-zip-file')?.click()}>
              ${t('packages.uploadZip') || 'Upload ZIP'}
            </button>
          </div>
          <div class="pkg-filters">
            <input type="text" placeholder=${t('packages.search') || 'Search...'}
              value=${search} onInput=${e => setSearch(e.target.value)} />
            <select value=${category} onChange=${e => setCategory(e.target.value)}>
              <option value="">${t('packages.allCategories') || 'All Categories'}</option>
              <option value="signage">${t('packages.categories.signage') || 'Signage'}</option>
              <option value="marketplace">${t('packages.categories.marketplace') || 'Marketplace'}</option>
              <option value="iot">${t('packages.categories.iot') || 'IoT'}</option>
              <option value="social">${t('packages.categories.social') || 'Social'}</option>
              <option value="productivity">${t('packages.categories.productivity') || 'Productivity'}</option>
              <option value="communication">${t('packages.categories.communication') || 'Communication'}</option>
              <option value="other">${t('packages.categories.other') || 'Other'}</option>
            </select>
          </div>
          ${filtered.length === 0 ? html`
            <p class="pkg-empty">${t('packages.noPackages') || 'No packages available.'}</p>
          ` : html`
            <div class="pkg-grid">
              ${filtered.map(pkg => html`
                <div class="pkg-card" key=${pkg.id}>
                  <div class="pkg-card-header">
                    <span class="pkg-card-name">${escHtml(pkg.name)}</span>
                    ${pkg.category && html`<span class="pkg-tag">${pkg.category}</span>`}
                  </div>
                  <div class="pkg-card-desc">${escHtml(pkg.description || '')}</div>
                  <div class="pkg-card-meta">
                    <span class="pkg-card-version">${pkg.version}</span>
                    <span>${t('packages.by') || 'by'} ${escHtml(pkg.author)}</span>
                    <span>\u00B7 ${pkg.components?.length ?? 0} ${t('packages.components') || 'components'}</span>
                  </div>
                  ${pkg.templateStatus === 'rejected' && pkg.rejectionReason && html`
                    <div class="pkg-rejection">
                      ${t('packages.moderation.rejectionReason')}: ${escHtml(pkg.rejectionReason)}
                    </div>
                  `}
                  <div class="pkg-card-footer">
                    <div class="pkg-card-actions">
                      <button class="primary" onClick=${() => handleInstall(pkg.packageGroupId)}>
                        ${t('packages.install') || 'Install'}
                      </button>
                      <button onClick=${() => handleDownloadZip(pkg.packageGroupId, pkg.name)}>
                        ${t('packages.downloadZip') || 'Download ZIP'}
                      </button>
                      <button onClick=${() => handleOpenInGenerator(pkg.packageGroupId, pkg.author)}>
                        ${pkg.author === session?.owner
                          ? (t('packages.editInGenerator') || 'Edit in Generator')
                          : (t('packages.openInGenerator') || 'Open in Generator')}
                      </button>
                      ${pkg.status === 'published' && !pkg.templateStatus && pkg.author === session?.owner && html`
                        <button class="btn-outline" onClick=${() => handleProposeAsTemplate(pkg.packageGroupId)}>
                          ${t('packages.proposeAsTemplate') || 'Propose as Template'}
                        </button>
                      `}
                    </div>
                  </div>
                </div>
              `)}
            </div>
          `}
        </div>
      `}

      ${view === 'gallery' && html`
        <div class="pkg-section">
          <h3>${t('packages.gallery') || 'Template Gallery'}</h3>
          ${templates.length === 0 ? html`
            <p class="pkg-empty">${t('packages.noTemplates') || 'No templates available yet.'}</p>
          ` : html`
            <div class="pkg-grid">
              ${templates.map(tpl => html`
                <div class="pkg-card" key=${tpl.id}>
                  <div class="pkg-card-header">
                    <span class="pkg-card-name">${escHtml(tpl.title)}</span>
                    ${tpl.featured && html`<span class="pkg-badge pkg-badge-featured">\u2B50 ${t('packages.featured') || 'Featured'}</span>`}
                  </div>
                  <div class="pkg-card-desc">${escHtml(tpl.description || '')}</div>
                  <div class="pkg-card-meta">
                    <span>${t('packages.by') || 'by'} ${escHtml(tpl.packageAuthor)}</span>
                    <span>\u00B7 \u2B50 ${tpl.rating?.toFixed(1) ?? '0.0'} (${tpl.reviewCount ?? 0})</span>
                    <span>\u00B7 ${tpl.installCount ?? 0} ${t('packages.installs') || 'installs'}</span>
                  </div>
                  <div class="pkg-card-footer">
                    <div class="pkg-card-actions">
                      <button class="primary" onClick=${() => handleInstall(tpl.packageGroupId)}>
                        ${t('packages.install') || 'Install'}
                      </button>
                      <button onClick=${() => handleDownloadZip(tpl.packageGroupId, tpl.title)}>
                        ${t('packages.downloadZip') || 'Download ZIP'}
                      </button>
                      <button onClick=${() => handleOpenInGenerator(tpl.packageGroupId, tpl.packageAuthor)}>
                        ${tpl.packageAuthor === session?.owner
                          ? (t('packages.editInGenerator') || 'Edit in Generator')
                          : (t('packages.openInGenerator') || 'Open in Generator')}
                      </button>
                    </div>
                  </div>
                </div>
              `)}
            </div>
          `}

          ${remoteTemplates.length > 0 && html`
            <div class="pkg-section-header pkg-remote-header">
              <h3>${t('packages.federation.remoteTemplates') || 'Remote Templates'}</h3>
              ${isOperator && html`
                <button class="btn-outline" onClick=${handleSyncFederation} disabled=${syncing}>
                  ${syncing
                    ? (t('dashboard.loading') || 'Loading...')
                    : (t('packages.federation.syncFromFederation') || 'Sync from Federation')}
                </button>
              `}
            </div>
            <div class="pkg-grid">
              ${remoteTemplates.map(rt => html`
                <div class="pkg-card" key=${rt.id || rt.title}>
                  <div class="pkg-card-header">
                    <span class="pkg-card-name">${escHtml(rt.title || rt.name || '')}</span>
                    <span class="pkg-tag">${escHtml(rt.sourceNode || t('packages.federation.sourceNode') || 'Remote')}</span>
                  </div>
                  <div class="pkg-card-desc">${escHtml(rt.description || '')}</div>
                  <div class="pkg-card-meta">
                    ${rt.author ? html`<span>${t('packages.by') || 'by'} ${escHtml(rt.author)}</span>` : null}
                    ${rt.category ? html`<span>\u00B7 ${escHtml(rt.category)}</span>` : null}
                    ${rt.installCount != null ? html`<span>\u00B7 ${rt.installCount} ${t('packages.installs') || 'installs'}</span>` : null}
                  </div>
                  <div class="pkg-card-footer">
                    <div class="pkg-card-actions">
                      ${rt.packageGroupId ? html`
                        <button class="primary" onClick=${() => handleInstall(rt.packageGroupId)}>
                          ${t('packages.federation.installFromRemote') || 'Install'}
                        </button>
                        <button onClick=${() => handleDownloadZip(rt.packageGroupId, rt.title || rt.name)}>
                          ${t('packages.downloadZip') || 'Download ZIP'}
                        </button>
                      ` : null}
                    </div>
                  </div>
                </div>
              `)}
            </div>
          `}
        </div>
      `}
      <${ConfirmUI} />
    </div>
  `;
}
