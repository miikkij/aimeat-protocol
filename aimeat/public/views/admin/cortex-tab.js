/**
 * @file cortex-tab.js
 * @description Admin dashboard tab for managing Cortex extensions at the node level.
 *   Lists all installed cortex extensions, allows activate/deactivate/uninstall,
 *   and shows component breakdowns.
 * @version-history
 *   v1.0.0 — 2026-03-17 — Initial admin cortex management tab
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Badge, StatsGrid, Empty, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import * as cortexService from '/js/services/cortex.js';

const COMP_ICONS = { schema: '\u{1F4D0}', prompt: '\u{1F4AC}', action: '\u26A1', 'board-template': '\u{1F4CC}', ontology: '\u{1F9EC}', 'seed-data': '\u{1F331}', lib: '\u{1F4E6}' };

export default function CortexTab({ data, reload, session }) {
  const { toast, showToast } = useToast();
  const { confirm, ConfirmUI } = useConfirm();
  const [extensions, setExtensions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);

  const loadData = useCallback(async ({ showSpinner = true } = {}) => {
    if (showSpinner) setLoading(true);
    try {
      const resp = await cortexService.listExtensions();
      setExtensions(resp?.extensions || []);
    } catch { if (showSpinner) setExtensions([]); }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => {
    const handler = () => { loadData({ showSpinner: false }); }; // silent: no flash
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [loadData]);

  const handleActivate = async (name) => {
    try {
      await cortexService.activateExtension(name);
      showToast(t('dashboard.cortex.activated'));
      loadData();
    } catch (e) { showToast(e.message || 'Error', true); }
  };

  const handleDeactivate = async (name) => {
    try {
      await cortexService.deactivateExtension(name);
      showToast(t('dashboard.cortex.deactivated'));
      loadData();
    } catch (e) { showToast(e.message || 'Error', true); }
  };

  const handleUninstall = (name) => {
    confirm(t('dashboard.cortex.confirmUninstall') || `Uninstall "${name}"?`, async () => {
      try {
        await cortexService.uninstallExtension(name);
        showToast(t('dashboard.cortex.uninstalled'));
        setDetail(null);
        loadData();
      } catch (e) { showToast(e.message || 'Error', true); }
    }, { danger: true });
  };

  const handleVisibility = async (name, currentVis) => {
    try {
      await cortexService.toggleVisibility(name, currentVis);
      showToast(t('dashboard.cortex.visibilityChanged'));
      loadData();
    } catch (e) { showToast(e.message || 'Error', true); }
  };

  const loadDetail = async (name) => {
    try {
      const d = await cortexService.getExtensionDetail(name);
      setDetail(d);
    } catch (e) { showToast(e.message || 'Error', true); }
  };

  const active = extensions.filter(e => e.status === 'active').length;
  const inactive = extensions.length - active;

  if (detail) {
    const ext = detail;
    const comps = ext.components || [];
    const isActive = ext.status === 'active';
    const vis = ext.visibility || 'private';
    return html`<div>
      <${Toast} toast=${toast} />
      <${ConfirmUI} />
      <button class="btn-outline" onClick=${() => setDetail(null)}>${t('dashboard.cortex.back')}</button>
      <h3 class="adm-section-title" style="margin-top:1rem">${escHtml(ext.name)} <span class="adm-text-dim adm-text-sm">v${ext.version || '?'}</span></h3>
      <p class="adm-text-dim">${escHtml(ext.description || '')}</p>
      <div class="adm-meta-row">
        <span>${t('dashboard.cortex.author')}: ${escHtml(ext.author || '?')}</span>
        <span>${t('dashboard.cortex.installedBy')}: ${escHtml(ext.installed_by || '?')}</span>
        <span>${t('dashboard.cortex.visibility')}: ${vis}</span>
        <span><${Badge} type=${isActive ? 'success' : 'muted'} label=${isActive ? t('dashboard.cortex.active') : t('dashboard.cortex.inactive')} /></span>
      </div>

      <h4 class="adm-section-title" style="margin-top:1.5rem">${t('dashboard.cortex.components')}</h4>
      <div class="adm-card">
        ${comps.length === 0 ? html`<${Empty} text=${t('dashboard.cortex.noComponents')} />` : comps.map(c => html`
          <div class="adm-row">${COMP_ICONS[c.type] || '\u{1F4C4}'} ${c.type}: ${c.type === 'schema' ? c.key_pattern : (c.name || c.filename || '')}</div>
        `)}
      </div>

      <div class="adm-actions-row" style="margin-top:1.5rem">
        ${isActive
          ? html`<button class="btn-outline" onClick=${() => handleDeactivate(ext.name)}>${t('dashboard.cortex.deactivate')}</button>`
          : html`<button class="btn-primary" onClick=${() => handleActivate(ext.name)}>${t('dashboard.cortex.activate')}</button>`}
        <button class="btn-outline" onClick=${() => handleVisibility(ext.name, vis)}>
          ${vis === 'public' ? t('dashboard.cortex.makePrivate') : t('dashboard.cortex.makePublic')}
        </button>
        <button class="btn-danger-solid" onClick=${() => handleUninstall(ext.name)}>${t('dashboard.cortex.uninstall')}</button>
      </div>
    </div>`;
  }

  return html`<div>
    <${Toast} toast=${toast} />
    <${ConfirmUI} />
    <${StatsGrid} items=${[
      { label: t('dashboard.cortex.total'), value: extensions.length },
      { label: t('dashboard.cortex.active'), value: active },
      { label: t('dashboard.cortex.inactive'), value: inactive },
    ]} />

    ${loading ? html`<div class="adm-text-dim">${t('dashboard.cortex.loading')}</div>` : extensions.length === 0
      ? html`<${Empty} text=${t('dashboard.cortex.empty')} />`
      : html`<div class="adm-table-wrap">
        <table class="adm-table">
          <thead><tr>
            <th>${t('dashboard.cortex.name')}</th>
            <th>${t('dashboard.cortex.version')}</th>
            <th>${t('dashboard.cortex.installedBy')}</th>
            <th>${t('dashboard.cortex.status')}</th>
            <th>${t('dashboard.cortex.visibility')}</th>
            <th>${t('dashboard.cortex.componentsCol')}</th>
            <th></th>
          </tr></thead>
          <tbody>
            ${extensions.map(ext => {
              const isActive = ext.status === 'active';
              const types = ext.component_types || [];
              return html`<tr>
                <td><button class="adm-link" onClick=${() => loadDetail(ext.name)}>${escHtml(ext.name)}</button></td>
                <td class="adm-text-dim">v${ext.version || '?'}</td>
                <td class="adm-text-dim">${escHtml(ext.installed_by || '?')}</td>
                <td><${Badge} type=${isActive ? 'success' : 'muted'} label=${isActive ? t('dashboard.cortex.active') : t('dashboard.cortex.inactive')} /></td>
                <td class="adm-text-dim">${ext.visibility || 'private'}</td>
                <td class="adm-text-dim">${types.join(', ')}</td>
                <td>
                  ${isActive
                    ? html`<button class="btn-outline btn-sm" onClick=${() => handleDeactivate(ext.name)}>${t('dashboard.cortex.deactivate')}</button>`
                    : html`<button class="btn-primary btn-sm" onClick=${() => handleActivate(ext.name)}>${t('dashboard.cortex.activate')}</button>`}
                </td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>`
    }
  </div>`;
}
