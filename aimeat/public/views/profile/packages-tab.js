/**
 * @file packages-tab.js
 * @description Profile tab for managing package instances, browsing available packages,
 *   and exploring the template gallery. Displays three sub-views: My Instances (installed
 *   packages with status/update/remove), Browse Packages (search/filter/install), and
 *   Template Gallery (community listings with ratings).
 * @structure
 *   - PackagesTab (default export) — main tab component
 *   - InstanceCard — card for an installed package instance
 *   - PackageCard — card for a browsable package
 *   - TemplateCard — card for a template gallery listing
 * @usage
 *   import PackagesTab from './profile/packages-tab.js';
 *   <PackagesTab session={session} showToast={showToast} navigate={navigate} locale={locale} />
 * @version-history
 *   v1.0.0 — 2026-03-15 — initial implementation (Phase 6)
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import * as pkgService from '/js/services/packages.js';

export default function PackagesTab({ session, showToast, navigate, locale }) {
  const [instances, setInstances] = useState([]);
  const [packages, setPackages] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('instances'); // 'instances' | 'browse' | 'gallery'
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [instRes, pkgRes, tplRes] = await Promise.all([
        pkgService.listInstances({ status: 'active' }),
        pkgService.listPackages({ status: 'published', visibility: 'public' }),
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
    if (label === null) return; // cancelled
    const res = await pkgService.installPackage(groupId, { label: label || '' });
    if (res.ok) {
      showToast(t('packages.installed'));
      loadData();
    } else {
      showToast(res.error || 'Install failed', true);
    }
  };

  const handleRemove = async (id) => {
    if (!confirm(t('packages.confirmRemove') || 'Remove this instance?')) return;
    const res = await pkgService.removeInstance(id, false);
    if (res.ok) {
      showToast(t('packages.instanceRemoved'));
      loadData();
    } else {
      showToast(res.error || 'Remove failed', true);
    }
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

  if (loading) return html`<div class="p-loading">${t('loading') || 'Loading...'}</div>`;

  return html`
    <div class="pkg-tab">
      <div class="pkg-nav">
        <button class=${view === 'instances' ? 'active' : ''} onClick=${() => setView('instances')}>
          ${t('packages.myInstances') || 'My Instances'} (${instances.length})
        </button>
        <button class=${view === 'browse' ? 'active' : ''} onClick=${() => setView('browse')}>
          ${t('packages.browse') || 'Browse Packages'}
        </button>
        <button class=${view === 'gallery' ? 'active' : ''} onClick=${() => setView('gallery')}>
          ${t('packages.gallery') || 'Template Gallery'}
        </button>
      </div>

      ${view === 'instances' && html`
        <div class="pkg-section">
          <h3>${t('packages.myInstances') || 'My Instances'}</h3>
          ${instances.length === 0 ? html`
            <p class="pkg-empty">${t('packages.noInstances') || 'No packages installed yet.'}</p>
          ` : instances.map(inst => html`
            <div class="pkg-card" key=${inst.id}>
              <div class="pkg-card-header">
                <strong>${escHtml(inst.label || inst.packageGroupId)}</strong>
                <span class="pkg-badge pkg-badge-${inst.status}">${inst.status}</span>
              </div>
              <div class="pkg-card-meta">
                ${t('packages.version') || 'Version'}: ${escHtml(inst.packageVersion)}
                · ${inst.installedComponents?.length ?? 0} ${t('packages.components') || 'components'}
              </div>
              <div class="pkg-card-actions">
                <button onClick=${() => handleCheckUpdate(inst.id)}>${t('packages.checkUpdate') || 'Check Update'}</button>
                <button class="danger" onClick=${() => handleRemove(inst.id)}>${t('packages.remove') || 'Remove'}</button>
              </div>
            </div>
          `)}
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
          ${packages.filter(p => {
            if (search && !p.name?.toLowerCase().includes(search.toLowerCase()) && !p.description?.toLowerCase().includes(search.toLowerCase())) return false;
            if (category && p.category !== category) return false;
            return true;
          }).map(pkg => html`
            <div class="pkg-card" key=${pkg.id}>
              <div class="pkg-card-header">
                <strong>${escHtml(pkg.name)}</strong>
                <span class="pkg-tag">${pkg.category}</span>
              </div>
              <div class="pkg-card-meta">${escHtml(pkg.description || '')}</div>
              <div class="pkg-card-meta">
                ${t('packages.by') || 'by'} ${escHtml(pkg.author)} · ${pkg.version}
                · ${pkg.components?.length ?? 0} ${t('packages.components') || 'components'}
              </div>
              <div class="pkg-card-actions">
                <button onClick=${() => handleInstall(pkg.packageGroupId)}>
                  ${t('packages.install') || 'Install'}
                </button>
              </div>
            </div>
          `)}
        </div>
      `}

      ${view === 'gallery' && html`
        <div class="pkg-section">
          <h3>${t('packages.gallery') || 'Template Gallery'}</h3>
          ${templates.length === 0 ? html`
            <p class="pkg-empty">${t('packages.noTemplates') || 'No templates available yet.'}</p>
          ` : templates.map(tpl => html`
            <div class="pkg-card pkg-card-template" key=${tpl.id}>
              <div class="pkg-card-header">
                <strong>${escHtml(tpl.title)}</strong>
                ${tpl.featured && html`<span class="pkg-badge pkg-badge-featured">Featured</span>`}
              </div>
              <div class="pkg-card-meta">${escHtml(tpl.description || '')}</div>
              <div class="pkg-card-meta">
                ${t('packages.by') || 'by'} ${escHtml(tpl.packageAuthor)}
                · ${tpl.rating?.toFixed(1) ?? '0.0'} (${tpl.reviewCount ?? 0})
                · ${tpl.installCount ?? 0} ${t('packages.installs') || 'installs'}
              </div>
              <div class="pkg-card-actions">
                <button onClick=${() => handleInstall(tpl.packageGroupId)}>
                  ${t('packages.install') || 'Install'}
                </button>
              </div>
            </div>
          `)}
        </div>
      `}
    </div>
  `;
}
