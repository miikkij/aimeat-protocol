/**
 * @file cortex-tab.js
 * @description Admin dashboard tab for managing Cortex extensions at the node level.
 *   Lists all installed cortex extensions, allows activate/deactivate/uninstall,
 *   and shows component breakdowns.
 * @version-history
 *   v1.0.0 — 2026-03-17 — Initial admin cortex management tab
 *   v1.1.0 — 2026-06-02 — Admin design unification: fix the broken useToast wiring
 *     (object-destructured the array-returning hook, and passed wrong props to
 *     <Toast> — toasts never rendered); now uses the canonical [msg,showErr,showOk,
 *     clear] API with a showToast adapter + correct <Toast type text onDismiss>.
 *     Main btn-* classes → adm-btn / adm-btn-action / adm-btn adm-btn-danger-solid.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Badge, StatsGrid, Empty, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import * as cortexService from '/js/services/cortex.js';

const COMP_ICONS = { schema: '\u{1F4D0}', prompt: '\u{1F4AC}', action: '\u26A1', 'board-template': '\u{1F4CC}', ontology: '\u{1F9EC}', 'seed-data': '\u{1F331}', lib: '\u{1F4E6}' };

export default function CortexTab() {
  const [toast, showErr, showOk, clearToast] = useToast();
  const showToast = (text, isError) => isError ? showErr(text) : showOk(text);
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
  useEffect(() => onLiveUpdate(['cortex'], () => loadData({ showSpinner: false })), [loadData]);

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
      ${toast && html`<${Toast} type=${toast.type} text=${toast.text} onDismiss=${clearToast} />`}
      <${ConfirmUI} />
      <button class="adm-btn-action" onClick=${() => setDetail(null)}>${t('dashboard.cortex.back')}</button>
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
          ? html`<button class="adm-btn-action" onClick=${() => handleDeactivate(ext.name)}>${t('dashboard.cortex.deactivate')}</button>`
          : html`<button class="adm-btn" onClick=${() => handleActivate(ext.name)}>${t('dashboard.cortex.activate')}</button>`}
        <button class="adm-btn-action" onClick=${() => handleVisibility(ext.name, vis)}>
          ${vis === 'public' ? t('dashboard.cortex.makePrivate') : t('dashboard.cortex.makePublic')}
        </button>
        <button class="adm-btn adm-btn-danger-solid" onClick=${() => handleUninstall(ext.name)}>${t('dashboard.cortex.uninstall')}</button>
      </div>
    </div>`;
  }

  return html`<div>
    ${toast && html`<${Toast} type=${toast.type} text=${toast.text} onDismiss=${clearToast} />`}
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
                    ? html`<button class="adm-btn-action" onClick=${() => handleDeactivate(ext.name)}>${t('dashboard.cortex.deactivate')}</button>`
                    : html`<button class="adm-btn" onClick=${() => handleActivate(ext.name)}>${t('dashboard.cortex.activate')}</button>`}
                </td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>`
    }
  </div>`;
}
