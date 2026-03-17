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
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Spinner } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import * as pkgService from '/js/services/packages.js';
import { importPackageToGenerator } from '/js/services/generator-packaging.js';

export default function PackagesTab({ session, showToast, navigate, locale }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [instances, setInstances] = useState([]);
  const [packages, setPackages] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('instances');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [instRes, pkgRes, tplRes] = await Promise.all([
        pkgService.listInstances({ status: 'active' }),
        pkgService.listPackages({ status: 'published', author: session?.owner }),
        pkgService.listTemplates({ sort: 'newest' }),
      ]);
      if (instRes.ok) setInstances(instRes.data?.instances ?? []);
      if (pkgRes.ok) setPackages(pkgRes.data?.packages ?? []);
      if (tplRes.ok) setTemplates(tplRes.data?.templates ?? []);
    } catch (e) { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Live updates
  useEffect(() => {
    const handler = () => { loadData(); };
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
      const res = await pkgService.removeInstance(id, false);
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
        showToast(`${t('packages.updateAvailable')}: ${res.data.latestVersion}`);
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

  if (loading) return html`<${Spinner} />`;

  const filtered = packages.filter(p => {
    if (search && !p.name?.toLowerCase().includes(search.toLowerCase()) && !p.description?.toLowerCase().includes(search.toLowerCase())) return false;
    if (category && p.category !== category) return false;
    return true;
  });

  return html`
    <div class="pkg-tab">
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
          <h3>${t('packages.browse') || 'Available Packages'}</h3>
          <div class="pkg-filters">
            <input type="text" placeholder=${t('packages.search') || 'Search...'}
              value=${search} onInput=${e => setSearch(e.target.value)} />
            <select value=${category} onChange=${e => setCategory(e.target.value)}>
              <option value="">${t('packages.allCategories') || 'All Categories'}</option>
              <option value="signage">Signage</option>
              <option value="marketplace">Marketplace</option>
              <option value="iot">IoT</option>
              <option value="social">Social</option>
              <option value="productivity">Productivity</option>
              <option value="communication">Communication</option>
              <option value="other">Other</option>
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
                  <div class="pkg-card-footer">
                    <div class="pkg-card-actions">
                      <button class="primary" onClick=${() => handleInstall(pkg.packageGroupId)}>
                        ${t('packages.install') || 'Install'}
                      </button>
                      <button onClick=${() => handleOpenInGenerator(pkg.packageGroupId, pkg.author)}>
                        ${pkg.author === session?.owner
                          ? (t('packages.editInGenerator') || 'Edit in Generator')
                          : (t('packages.openInGenerator') || 'Open in Generator')}
                      </button>
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
                    ${tpl.featured && html`<span class="pkg-badge pkg-badge-featured">\u2B50 Featured</span>`}
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
        </div>
      `}
      <${ConfirmUI} />
    </div>
  `;
}
