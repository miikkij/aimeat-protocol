/**
 * @file msm-tab.js
 * @description Admin dashboard MSM (Marketplace Service Manifest) tab — list,
 *   detail, create, edit and typed-name delete of registered service manifests.
 * @structure default export MsmTab({ data, reload }); internal renderDeleteModal,
 *   list/detail/create/edit views.
 * @usage Mounted by the admin dashboard tab router.
 * @version-history
 *   v1.1.0 — 2026-06-02 — Component unification (#3): delete-confirm overlay uses
 *     canonical .modal-overlay (theme.css) instead of removed .adm-modal-overlay.
 *   v1.2.0 — 2026-06-02 — Component unification (#2): delete-confirm modal uses the
 *     canonical <Modal> component (header ✕ + Escape/backdrop close); the typed-name
 *     guard stays in the body, with the danger cue moved to the message text.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, Badge, Empty, ExpandableHelp, useToast, Toast } from './shared.js';
import { getMsmDetail, createMsm, updateMsm, deleteMsm, getMsmTemplates, getMsmTemplate } from '/js/services/admin.js';
import { Modal } from '/components/Modal.js';

export default function MsmTab({ data, reload }) {
  const integrations = data.msm?.integrations || [];
  const [view, setView] = useState('list');    // list | detail | create | edit
  const [detail, setDetail] = useState(null);
  const [yaml, setYaml] = useState('');
  const [federate, setFederate] = useState(false);
  const [templates, setTemplates] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // Edit state
  const [editDesc, setEditDesc] = useState('');
  const [editFederate, setEditFederate] = useState(false);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteInput, setDeleteInput] = useState('');
  const [toast, showErr, showOk, clearToast] = useToast();

  async function showDetail(name) {
    try {
      const r = await getMsmDetail(name);
      setDetail(r.data);
      setView('detail');
    } catch (e) { setErr(e.message); }
  }

  async function openCreate() {
    setErr('');
    setYaml('');
    setFederate(false);
    setView('create');
    if (!templates) {
      try {
        const r = await getMsmTemplates();
        setTemplates(r.data?.templates || []);
      } catch { setTemplates([]); }
    }
  }

  async function loadTemplate(type) {
    if (!type) return;
    setLoading(true);
    try {
      const text = await getMsmTemplate(type);
      setYaml(text);
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }

  async function doCreate() {
    if (!yaml.trim()) return;
    setLoading(true);
    setErr('');
    try {
      await createMsm(yaml, federate);
      setView('list');
      setYaml('');
      setFederate(false);
      reload();
    } catch (e) {
      setErr(e.message || t('dashboard.errorLabel'));
    }
    setLoading(false);
  }

  function openEdit() {
    if (!detail) return;
    const def = detail.definition || {};
    const svc = def.service || {};
    setEditDesc(svc.description || '');
    setEditFederate(detail.federate || false);
    setErr('');
    setView('edit');
  }

  async function doEdit() {
    if (!detail) return;
    setLoading(true);
    setErr('');
    try {
      await updateMsm(detail.name, {
        description: editDesc,
        federate: editFederate,
      });
      // Refresh detail
      const r = await getMsmDetail(detail.name);
      setDetail(r.data);
      setView('detail');
      reload();
    } catch (e) {
      setErr(e.message || t('dashboard.errorLabel'));
    }
    setLoading(false);
  }

  function openDelete(name) {
    setDeleteTarget(name);
    setDeleteInput('');
  }

  async function doDelete() {
    if (!deleteTarget || deleteInput !== deleteTarget) return;
    setLoading(true);
    try {
      await deleteMsm(deleteTarget);
      setDeleteTarget(null);
      setDeleteInput('');
      setDetail(null);
      setView('list');
      reload();
    } catch (e) { showErr(e.message); }
    setLoading(false);
  }

  function backToList() { setView('list'); setDetail(null); setErr(''); }

  // ── Delete confirmation modal ──
  function renderDeleteModal() {
    if (!deleteTarget) return null;
    const closeDelete = () => { setDeleteTarget(null); setDeleteInput(''); };
    return html`
      <${Modal} open=${true} onClose=${closeDelete} title=${t('dashboard.msmDeleteTitle')}>
          <p class="adm-text-base adm-mb-md adm-text-error" style="margin:0 0 1rem">
            ${t('dashboard.msmDeleteConfirm').replace('{name}', deleteTarget)}
          </p>
          <input
            type="text"
            class="adm-input adm-input-full adm-mb-md"
            placeholder=${deleteTarget}
            value=${deleteInput}
            onInput=${e => setDeleteInput(e.target.value)}
          />
          <div class="adm-flex" style="justify-content:flex-end">
            <button class="adm-btn-sm" onClick=${closeDelete}>
              ${t('dashboard.cancel')}
            </button>
            <button
              class="adm-btn"
              style="background:#ef4444;border-color:#ef4444"
              disabled=${deleteInput !== deleteTarget || loading}
              onClick=${doDelete}
            >
              ${loading ? '...' : t('dashboard.delete')}
            </button>
          </div>
      <//>
    `;
  }

  // ── Edit view ──
  if (view === 'edit' && detail) {
    const def = detail.definition || {};
    const svc = def.service || {};
    return html`
      <div>
        <button class="adm-btn-sm" onClick=${() => setView('detail')}>\u2190 ${t('dashboard.back')}</button>
        <div class="adm-card adm-mt-md">
          <h4 class="adm-mb-md" style="margin:0">${t('dashboard.msmEdit')}</h4>

          <div class="adm-text-base adm-mb-lg" style="display:grid;grid-template-columns:1fr 1fr;gap:8px 24px">
            <div><strong>${t('dashboard.name')}:</strong> ${escHtml(detail.name)}</div>
            <div><strong>${t('dashboard.msmCategory')}:</strong> ${escHtml(detail.category || '—')}</div>
            <div><strong>${t('dashboard.msmAuthType')}:</strong> ${escHtml(detail.auth_type || '—')}</div>
            <div><strong>${t('dashboard.msmActions')}:</strong> ${detail.actions_count || 0}</div>
          </div>

          <label class="adm-text-base adm-text-dim adm-mb-xs" style="display:block">
            ${t('dashboard.msmEditDescription')}
          </label>
          <input
            type="text"
            class="adm-input adm-input-full adm-mb-md"
            value=${editDesc}
            onInput=${e => setEditDesc(e.target.value)}
          />

          <label class="adm-text-base adm-flex-center adm-mb-lg" style="cursor:pointer">
            <input type="checkbox" checked=${editFederate} onChange=${e => setEditFederate(e.target.checked)} />
            ${t('dashboard.msmEditFederate')}
          </label>

          ${err && html`<div class="error-box adm-mb-sm">${err}</div>`}

          <div class="adm-flex">
            <button class="adm-btn" onClick=${doEdit} disabled=${loading}>
              ${loading ? '...' : t('dashboard.msmEditSave')}
            </button>
            <button class="adm-btn-sm" onClick=${() => setView('detail')}>${t('dashboard.cancel')}</button>
          </div>
        </div>
      </div>
    `;
  }

  // ── Detail view ──
  if (view === 'detail' && detail) {
    const def = detail.definition || {};
    const svc = def.service || {};
    return html`
      <div>
        ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
        ${renderDeleteModal()}
        <button class="adm-btn-sm" onClick=${backToList}>\u2190 ${t('dashboard.back')}</button>
        <div class="adm-card adm-mt-md">
          <div class="adm-flex-between">
            <h4 style="margin:0">${escHtml(detail.name)}</h4>
            <div class="adm-flex">
              <button class="adm-btn-sm" onClick=${openEdit}>${t('dashboard.edit')}</button>
              <button class="adm-btn-sm adm-text-error" style="border-color:#ef4444" onClick=${() => openDelete(detail.name)}>
                ${t('dashboard.delete')}
              </button>
            </div>
          </div>
          ${svc.description && html`<p class="adm-text-base adm-text-dim" style="margin:4px 0 12px">${escHtml(svc.description)}</p>`}

          <div class="adm-text-base" style="display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;margin:12px 0">
            <div><strong>${t('dashboard.msmCategory')}:</strong> ${escHtml(detail.category || '—')}</div>
            <div><strong>${t('dashboard.msmAuthType')}:</strong> ${escHtml(detail.auth_type || '—')}</div>
            <div><strong>${t('dashboard.msmActions')}:</strong> ${detail.actions_count || 0}</div>
            <div><strong>${t('dashboard.msmRegisteredBy')}:</strong> ${escHtml(detail.registered_by || '—')}</div>
            <div><strong>${t('dashboard.created')}:</strong> ${dt(detail.registered_at)}</div>
            <div><strong>${t('dashboard.updated')}:</strong> ${dt(detail.updated_at)}</div>
            <div><strong>${t('dashboard.msmFederationLevel')}:</strong> ${detail.federate ? '\u2713' : '\u2014'}</div>
          </div>

          <h5 style="margin:16px 0 4px">${t('dashboard.msmDefinition')}</h5>
          <pre style="background:var(--bg-card);padding:12px;border-radius:6px;overflow:auto;font-size:.75rem">${JSON.stringify(def, null, 2)}</pre>
        </div>
      </div>
    `;
  }

  // ── Create view ──
  if (view === 'create') {
    return html`
      <div>
        <button class="adm-btn-sm" onClick=${backToList}>\u2190 ${t('dashboard.back')}</button>
        <div class="adm-card adm-mt-md">
          <h4 class="adm-mb-md" style="margin:0">${t('dashboard.msmAddNew')}</h4>

          ${templates && templates.length > 0 && html`
            <div class="adm-mb-md">
              <label class="adm-text-base adm-text-dim adm-mb-xs" style="display:block">${t('dashboard.msmCreateFromTemplate')}</label>
              <select style="width:auto;min-width:200px" onChange=${e => loadTemplate(e.target.value)}>
                <option value="">${t('dashboard.msmSelectTemplate')}</option>
                ${templates.map(ft => html`<option value=${ft.type}>${escHtml(ft.name)} (${ft.type})</option>`)}
              </select>
            </div>
          `}

          <label class="adm-text-base adm-text-dim adm-mb-xs" style="display:block">${t('dashboard.msmDefinition')}</label>
          <textarea
            rows="20"
            class="adm-input adm-input-full adm-text-sm"
            style="font-family:monospace;resize:vertical"
            placeholder=${t('dashboard.msmYamlPlaceholder')}
            value=${yaml}
            onInput=${e => setYaml(e.target.value)}
          />

          <label class="adm-text-base adm-flex-center" style="margin:12px 0;cursor:pointer">
            <input type="checkbox" checked=${federate} onChange=${e => setFederate(e.target.checked)} />
            ${t('dashboard.msmEditFederate')}
          </label>

          ${err && html`<div class="error-box adm-mt-sm">${err}</div>`}

          <div class="adm-flex adm-mt-md">
            <button class="adm-btn" onClick=${doCreate} disabled=${loading || !yaml.trim()}>
              ${loading ? '...' : t('dashboard.msmAddNew')}
            </button>
            <button class="adm-btn-sm" onClick=${backToList}>${t('dashboard.cancel')}</button>
          </div>
        </div>
      </div>
    `;
  }

  // ── List view ──
  return html`
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    ${renderDeleteModal()}
    <p class="adm-text-dim adm-mb-md" style="margin:0">${t('dashboard.msmExplain')}</p>
    <${ExpandableHelp} title=${t('dashboard.msmHelpTitle')}>
      ${t('dashboard.msmHelpDetail')}
    <//>

    <div class="adm-mb-md">
      <button class="adm-btn" onClick=${openCreate}>${t('dashboard.msmAddNew')}</button>
    </div>

    ${!integrations.length
      ? html`<${Empty} text=${t('dashboard.noMsmIntegrations')} />`
      : html`
        <div class="adm-card">
          <div class="scrollable">
            <table>
              <thead><tr>
                <th>${t('dashboard.name')}</th>
                <th>${t('dashboard.msmCategory')}</th>
                <th>${t('dashboard.msmAuthType')}</th>
                <th>${t('dashboard.msmActions')}</th>
                <th>${t('dashboard.msmRegisteredBy')}</th>
                <th>${t('dashboard.created')}</th>
                <th></th>
              </tr></thead>
              <tbody>
                ${integrations.map(m => html`<tr>
                  <td><strong style="cursor:pointer;color:var(--accent)" onClick=${() => showDetail(m.name)}>${escHtml(m.name)}</strong></td>
                  <td class="adm-text-sm adm-text-dim">${escHtml(m.category || '—')}</td>
                  <td class="adm-text-sm adm-text-dim">${escHtml(m.auth_type || '—')}</td>
                  <td class="adm-text-sm">${m.actions_count || 0}</td>
                  <td class="adm-text-sm">${escHtml(m.registered_by || '—')}</td>
                  <td class="adm-text-dim">${dt(m.registered_at)}</td>
                  <td style="white-space:nowrap">
                    <button class="adm-btn-sm" onClick=${() => showDetail(m.name)}>${t('dashboard.edit')}</button>
                    ${' '}
                    <button class="adm-btn-sm adm-text-error" style="border-color:#ef4444" onClick=${() => openDelete(m.name)}>
                      ${t('dashboard.delete')}
                    </button>
                  </td>
                </tr>`)}
              </tbody>
            </table>
          </div>
        </div>
      `}
  `;
}
