/**
 * @file subdomains-tab.js
 * @description Admin dashboard Subdomains tab — operator management of
 *   subdomain → site mappings (serve a published app at `<sub>.<apex>` or
 *   301-redirect). Table with enabled-toggle, create form, and
 *   type-to-confirm deletion.
 * @structure SubdomainsAdminTab (default)
 * @usage Mounted by the admin dashboard tab router (views/admin.js).
 * @version-history
 *   v1.0.0 — 2026-06-12 — Initial: subdomain routing (operator-only management)
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { dt, Spinner, Empty, ErrorBox } from './shared.js';
import { Modal } from '/components/Modal.js';
import * as adminService from '/js/services/admin.js';

export default function SubdomainsAdminTab() {
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ subdomain: '', kind: 'app', target: '' });
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  // Type-to-confirm delete state: { subdomain, typed }
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await adminService.getSubdomainSites();
      setSites(resp?.data?.sites || []);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handler = () => { load(); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  const create = useCallback(async () => {
    setFormError(null);
    setSaving(true);
    try {
      await adminService.createSubdomainSite({
        subdomain: form.subdomain.trim().toLowerCase(),
        kind: form.kind,
        target: form.target.trim(),
      });
      setShowCreate(false);
      setForm({ subdomain: '', kind: 'app', target: '' });
      load();
    } catch (err) {
      setFormError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }, [form, load]);

  const toggleEnabled = useCallback(async (site) => {
    try {
      await adminService.updateSubdomainSite(site.subdomain, { enabled: !site.enabled });
      load();
    } catch (err) {
      setError(err?.message || String(err));
    }
  }, [load]);

  const doDelete = useCallback(async () => {
    if (!deleting || deleting.typed !== deleting.subdomain) return;
    try {
      await adminService.deleteSubdomainSite(deleting.subdomain);
      setDeleting(null);
      load();
    } catch (err) {
      setError(err?.message || String(err));
      setDeleting(null);
    }
  }, [deleting, load]);

  // Public URL for a mapping, derived from the page's own host
  const siteUrl = (sub) => `${location.protocol}//${sub}.${location.host}/`;

  return html`
    <p class="adm-text-sm adm-text-dim adm-mb-md">${t('admin.subdomains.desc')}</p>

    <div class="adm-card">
      <div class="adm-flex-between adm-mb-md">
        <h2>${t('admin.subdomains.title')}</h2>
        <button class="adm-btn-sm" onClick=${() => { setShowCreate(!showCreate); setFormError(null); }}>
          ${showCreate ? t('common.cancel') : '+ ' + t('admin.subdomains.add')}
        </button>
      </div>

      ${showCreate && html`
        <div class="adm-subdomain-form adm-mb-md">
          <input class="adm-input" placeholder=${t('admin.subdomains.subdomain')}
            value=${form.subdomain}
            onInput=${e => setForm({ ...form, subdomain: e.target.value })} />
          <select class="adm-input" value=${form.kind}
            onChange=${e => setForm({ ...form, kind: e.target.value })}>
            <option value="app">${t('admin.subdomains.kindApp')}</option>
            <option value="redirect">${t('admin.subdomains.kindRedirect')}</option>
          </select>
          <input class="adm-input" value=${form.target}
            placeholder=${form.kind === 'app' ? t('admin.subdomains.targetHintApp') : t('admin.subdomains.targetHintRedirect')}
            onInput=${e => setForm({ ...form, target: e.target.value })} />
          <button class="adm-btn" disabled=${saving || !form.subdomain.trim() || !form.target.trim()}
            onClick=${create}>${t('admin.subdomains.create')}</button>
          ${formError && html`<div class="adm-text-error adm-text-sm">${formError}</div>`}
        </div>
      `}

      ${error && html`<${ErrorBox} message=${error} />`}
      ${loading ? html`<${Spinner} />` : sites.length === 0
        ? html`<${Empty} text=${t('admin.subdomains.empty')} />`
        : html`
        <div class="scrollable">
          <table>
            <thead><tr>
              <th>${t('admin.subdomains.subdomain')}</th>
              <th>${t('admin.subdomains.kind')}</th>
              <th>${t('admin.subdomains.target')}</th>
              <th>${t('admin.subdomains.enabled')}</th>
              <th>${t('admin.subdomains.createdBy')}</th>
              <th>${t('admin.subdomains.created')}</th>
              <th></th>
            </tr></thead>
            <tbody>
              ${sites.map(s => html`
                <tr>
                  <td class="mono">
                    <a href=${siteUrl(s.subdomain)} target="_blank" rel="noopener">\u{1F310} ${s.subdomain}</a>
                  </td>
                  <td>${s.kind === 'app' ? t('admin.subdomains.kindApp') : t('admin.subdomains.kindRedirect')}</td>
                  <td class="mono">${s.target}</td>
                  <td>
                    <input type="checkbox" checked=${s.enabled} onChange=${() => toggleEnabled(s)}
                      title=${t('admin.subdomains.enabled')} />
                  </td>
                  <td class="mono">${s.createdBy}</td>
                  <td>${dt(s.createdAt)}</td>
                  <td>
                    <button class="adm-btn-sm adm-btn-danger"
                      onClick=${() => setDeleting({ subdomain: s.subdomain, typed: '' })}>
                      ${t('admin.subdomains.delete')}
                    </button>
                  </td>
                </tr>
              `)}
            </tbody>
          </table>
        </div>
      `}
    </div>

    <${Modal} open=${!!deleting} onClose=${() => setDeleting(null)} title=${t('admin.subdomains.deleteTitle')}>
      ${deleting && html`
        <p>${t('admin.subdomains.deleteConfirm')} <strong class="mono">${deleting.subdomain}</strong></p>
        <input class="adm-input adm-input-full" value=${deleting.typed}
          onInput=${e => setDeleting({ ...deleting, typed: e.target.value })} />
        <div class="adm-flex adm-mt-md adm-subdomain-modal-actions">
          <button class="btn-ghost" onClick=${() => setDeleting(null)}>${t('common.cancel')}</button>
          <button class="btn-danger-solid" disabled=${deleting.typed !== deleting.subdomain}
            onClick=${doDelete}>${t('admin.subdomains.delete')}</button>
        </div>
      `}
    <//>
  `;
}
