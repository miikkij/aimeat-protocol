/**
 * @file packages-tab.js
 * @description Admin dashboard tab for managing packages, template listings, and instances.
 *   Shows overview stats, recent packages, and instance distribution.
 * @structure
 *   - PackagesAdminTab — main tab component with subtabs for packages/templates/instances
 * @usage
 *   Loaded by admin.js as a nav item component.
 * @version-history
 *   v1.0.0 — 2026-03-15 — initial implementation (Phase 6)
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { StatsGrid, Empty, Spinner, Badge, dt } from './shared.js';
import * as pkgService from '/js/services/packages.js';
import { seedExamples } from '/js/services/admin.js';

export default function PackagesAdminTab({ data, reload, session }) {
  const [packages, setPackages] = useState([]);
  const [instances, setInstances] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState('');
  const [subtab, setSubtab] = useState('packages');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [pkgRes, instRes, tplRes] = await Promise.all([
        pkgService.listPackages({ limit: 50 }),
        pkgService.listInstances({ limit: 50 }),
        pkgService.listTemplates({ limit: 50 }),
      ]);
      if (pkgRes.ok !== false) setPackages(pkgRes.data?.packages ?? []);
      if (instRes.ok !== false) setInstances(instRes.data?.instances ?? []);
      if (tplRes.ok !== false) setTemplates(tplRes.data?.listings ?? tplRes.data?.templates ?? []);
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

  if (loading) return html`<${Spinner} text=${t('dashboard.loading')} />`;

  const published = packages.filter(p => p.status === 'published').length;
  const stats = [
    { label: t('dashboard.pkgTotalPackages') || 'Total Packages', value: packages.length, color: 'var(--accent, #60a5fa)' },
    { label: t('dashboard.pkgTotalInstances') || 'Total Instances', value: instances.length, color: 'var(--green, #34d399)' },
    { label: t('dashboard.pkgTotalTemplates') || 'Template Listings', value: templates.length, color: 'var(--purple, #a78bfa)' },
    { label: t('dashboard.pkgPublished') || 'Published', value: published, color: 'var(--amber, #fbbf24)' },
  ];

  const handleSeed = async () => {
    setSeeding(true);
    setSeedMsg('');
    try {
      const res = await seedExamples();
      if (res.ok !== false) {
        const names = (res.data?.seeded ?? []).map(s => s.name).join(', ');
        setSeedMsg(names ? `Seeded: ${names}` : 'Done');
        loadData();
      } else {
        setSeedMsg(res.error?.message ?? 'Failed');
      }
    } catch (e) { setSeedMsg('Error: ' + e.message); }
    setSeeding(false);
  };

  return html`
    <div>
      <${StatsGrid} items=${stats} />

      <div class="adm-card" style="margin-bottom:16px;text-align:center;padding:24px">
        ${packages.length === 0 && templates.length === 0
          ? html`<p style="margin-bottom:12px">${t('dashboard.pkgNoPackages') || 'No packages yet. Seed example packages to get started.'}</p>`
          : html`<p style="margin-bottom:12px">${t('dashboard.pkgReseedHint') || 'Re-seed to update example packages to latest version.'}</p>`
        }
        <button class="adm-btn adm-btn-active" onClick=${handleSeed} disabled=${seeding}>
          ${seeding ? (t('dashboard.loading') || 'Loading...') : (t('dashboard.pkgSeedExamples') || 'Seed Example Packages')}
        </button>
        ${seedMsg && html`<p style="margin-top:8px;font-size:0.85rem;color:var(--green,#34d399)">${seedMsg}</p>`}
      </div>

      <div class="adm-subtabs" style="display:flex;gap:8px;margin:16px 0">
        <button class=${'adm-btn' + (subtab === 'packages' ? ' adm-btn-active' : '')} onClick=${() => setSubtab('packages')}>
          ${t('dashboard.pkgPackagesTab') || 'Packages'} (${packages.length})
        </button>
        <button class=${'adm-btn' + (subtab === 'templates' ? ' adm-btn-active' : '')} onClick=${() => setSubtab('templates')}>
          ${t('dashboard.pkgTemplatesTab') || 'Templates'} (${templates.length})
        </button>
        <button class=${'adm-btn' + (subtab === 'instances' ? ' adm-btn-active' : '')} onClick=${() => setSubtab('instances')}>
          ${t('dashboard.pkgInstancesTab') || 'Instances'} (${instances.length})
        </button>
      </div>

      ${subtab === 'packages' && html`
        <div class="adm-card">
          <h3>${t('dashboard.pkgAllPackages') || 'All Packages'}</h3>
          ${packages.length === 0 ? html`<${Empty} text=${t('dashboard.pkgNoPackages') || 'No packages yet'} />` : html`
            <table class="adm-table">
              <thead><tr>
                <th>${t('dashboard.name')}</th>
                <th>${t('dashboard.pkgAuthor') || 'Author'}</th>
                <th>${t('dashboard.pkgVersion') || 'Version'}</th>
                <th>${t('dashboard.status')}</th>
                <th>${t('dashboard.pkgCategory') || 'Category'}</th>
                <th>${t('dashboard.created')}</th>
              </tr></thead>
              <tbody>
                ${packages.map(p => html`
                  <tr key=${p.id}>
                    <td><strong>${escHtml(p.name)}</strong></td>
                    <td>${escHtml(p.author || '')}</td>
                    <td><code>${escHtml(p.version || '')}</code></td>
                    <td><${Badge} type=${p.status} /></td>
                    <td>${escHtml(p.category || '')}</td>
                    <td>${dt(p.createdAt)}</td>
                  </tr>
                `)}
              </tbody>
            </table>
          `}
        </div>
      `}

      ${subtab === 'templates' && html`
        <div class="adm-card">
          <h3>${t('dashboard.pkgAllTemplates') || 'Template Listings'}</h3>
          ${templates.length === 0 ? html`<${Empty} text=${t('dashboard.pkgNoTemplates') || 'No template listings yet'} />` : html`
            <table class="adm-table">
              <thead><tr>
                <th>${t('dashboard.pkgTitle') || 'Title'}</th>
                <th>${t('dashboard.pkgPackage') || 'Package'}</th>
                <th>${t('dashboard.pkgRating') || 'Rating'}</th>
                <th>${t('dashboard.pkgInstalls') || 'Installs'}</th>
                <th>${t('dashboard.pkgFeatured') || 'Featured'}</th>
                <th>${t('dashboard.status')}</th>
              </tr></thead>
              <tbody>
                ${templates.map(tpl => html`
                  <tr key=${tpl.id}>
                    <td><strong>${escHtml(tpl.title || '')}</strong></td>
                    <td>${escHtml(tpl.packageName || tpl.packageGroupId || '')}</td>
                    <td>\u2B50 ${tpl.rating?.toFixed(1) ?? '0.0'} (${tpl.reviewCount ?? 0})</td>
                    <td>${tpl.installCount ?? 0}</td>
                    <td>${tpl.featured ? '\u2705' : '\u2014'}</td>
                    <td><${Badge} type=${tpl.status} /></td>
                  </tr>
                `)}
              </tbody>
            </table>
          `}
        </div>
      `}

      ${subtab === 'instances' && html`
        <div class="adm-card">
          <h3>${t('dashboard.pkgAllInstances') || 'All Instances'}</h3>
          ${instances.length === 0 ? html`<${Empty} text=${t('dashboard.pkgNoInstances') || 'No instances yet'} />` : html`
            <table class="adm-table">
              <thead><tr>
                <th>${t('dashboard.pkgLabel') || 'Label'}</th>
                <th>${t('dashboard.pkgPackage') || 'Package'}</th>
                <th>${t('dashboard.pkgOwner') || 'Owner'}</th>
                <th>${t('dashboard.pkgVersion') || 'Version'}</th>
                <th>${t('dashboard.status')}</th>
                <th>${t('dashboard.pkgComponents') || 'Components'}</th>
                <th>${t('dashboard.pkgInstalled') || 'Installed'}</th>
              </tr></thead>
              <tbody>
                ${instances.map(inst => html`
                  <tr key=${inst.id}>
                    <td><strong>${escHtml(inst.label || '\u2014')}</strong></td>
                    <td>${escHtml(inst.packageGroupId || '')}</td>
                    <td>${escHtml(inst.owner || '')}</td>
                    <td><code>${escHtml(inst.packageVersion || '')}</code></td>
                    <td><${Badge} type=${inst.status} /></td>
                    <td>${inst.installedComponents?.length ?? 0}</td>
                    <td>${dt(inst.installedAt)}</td>
                  </tr>
                `)}
              </tbody>
            </table>
          `}
        </div>
      `}
    </div>
  `;
}
