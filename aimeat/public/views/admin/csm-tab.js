import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, Empty, ExpandableHelp } from './shared.js';
import { getCsmDetail, deleteCsm, createCsm, getCsmFileTemplates, getCsmFileTemplate } from '/js/services/admin.js';

export default function CsmTab({ data, reload }) {
  const templates = data.csm?.templates || [];
  const [view, setView] = useState('list');    // list | detail | create
  const [detail, setDetail] = useState(null);
  const [yaml, setYaml] = useState('');
  const [fileTemplates, setFileTemplates] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function showDetail(name) {
    try {
      const r = await getCsmDetail(name);
      setDetail(r.data);
      setView('detail');
    } catch (e) { setErr(e.message); }
  }

  async function doDelete(name) {
    const msg = t('dashboard.csmDeleteConfirm').replace('{name}', name);
    if (!confirm(msg)) return;
    try {
      await deleteCsm(name);
      setView('list');
      setDetail(null);
      reload();
    } catch (e) { alert(t('dashboard.errorLabel') + ': ' + e.message); }
  }

  async function openCreate() {
    setErr('');
    setYaml('');
    setView('create');
    if (!fileTemplates) {
      try {
        const r = await getCsmFileTemplates();
        setFileTemplates(r.data?.templates || []);
      } catch { setFileTemplates([]); }
    }
  }

  async function loadTemplate(type) {
    if (!type) return;
    setLoading(true);
    try {
      const text = await getCsmFileTemplate(type);
      setYaml(text);
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }

  async function doCreate() {
    if (!yaml.trim()) return;
    setLoading(true);
    setErr('');
    try {
      await createCsm(yaml);
      setView('list');
      setYaml('');
      reload();
    } catch (e) {
      setErr(e.message || t('dashboard.errorLabel'));
    }
    setLoading(false);
  }

  function backToList() { setView('list'); setDetail(null); setErr(''); }

  // ── Detail view ──
  if (view === 'detail' && detail) {
    const def = detail.definition || {};
    const svc = def.service || {};
    return html`
      <div>
        <button class="adm-btn-sm" onClick=${backToList}>← ${t('dashboard.back')}</button>
        <div class="adm-card" style="margin-top:12px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <h4 style="margin:0">${escHtml(detail.name)}</h4>
            <button class="adm-btn-sm" style="color:#ef4444;border-color:#ef4444" onClick=${() => doDelete(detail.name)}>
              ${t('dashboard.delete')}
            </button>
          </div>
          ${svc.description && html`<p style="font-size:.85rem;color:var(--text-dim);margin:4px 0 12px">${escHtml(svc.description)}</p>`}

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;margin:12px 0;font-size:.85rem">
            <div><strong>${t('dashboard.csmServiceType')}:</strong> ${escHtml(detail.service_type || '—')}</div>
            <div><strong>${t('dashboard.csmRegisteredBy')}:</strong> ${escHtml(detail.registered_by || '—')}</div>
            <div><strong>${t('dashboard.created')}:</strong> ${dt(detail.registered_at)}</div>
            <div><strong>${t('dashboard.updated')}:</strong> ${dt(detail.updated_at)}</div>
            <div><strong>${t('dashboard.csmFederate')}:</strong> ${detail.federate ? '✓' : '—'}</div>
            ${detail.json_schema_key && html`<div><strong>${t('dashboard.schema')}:</strong> <code style="font-size:.75rem">${detail.json_schema_key}</code></div>`}
          </div>

          ${detail.semantic && html`
            <h5 style="margin:16px 0 4px">${t('dashboard.semantic') || 'Semantic'}</h5>
            <pre style="background:var(--bg-card);padding:12px;border-radius:6px;overflow:auto;font-size:.75rem">${JSON.stringify(detail.semantic, null, 2)}</pre>
          `}

          <h5 style="margin:16px 0 4px">${t('dashboard.csmDefinition')}</h5>
          <pre style="background:var(--bg-card);padding:12px;border-radius:6px;overflow:auto;font-size:.75rem">${JSON.stringify(def, null, 2)}</pre>
        </div>
      </div>
    `;
  }

  // ── Create view ──
  if (view === 'create') {
    return html`
      <div>
        <button class="adm-btn-sm" onClick=${backToList}>← ${t('dashboard.back')}</button>
        <div class="adm-card" style="margin-top:12px">
          <h4 style="margin:0 0 12px">${t('dashboard.csmCreate')}</h4>

          ${fileTemplates && fileTemplates.length > 0 && html`
            <div style="margin-bottom:12px">
              <label style="font-size:.85rem;color:var(--text-dim);display:block;margin-bottom:4px">${t('dashboard.csmCreateFromTemplate')}</label>
              <select style="width:auto;min-width:200px" onChange=${e => loadTemplate(e.target.value)}>
                <option value="">${t('dashboard.csmSelectTemplate')}</option>
                ${fileTemplates.map(ft => html`<option value=${ft.type}>${escHtml(ft.name)} (${ft.type})</option>`)}
              </select>
            </div>
          `}

          <label style="font-size:.85rem;color:var(--text-dim);display:block;margin-bottom:4px">${t('dashboard.csmDefinition')}</label>
          <textarea
            rows="16"
            style="width:100%;font-family:monospace;font-size:.8rem;resize:vertical"
            placeholder=${t('dashboard.csmYamlPlaceholder')}
            value=${yaml}
            onInput=${e => setYaml(e.target.value)}
          />

          ${err && html`<div class="error-box" style="margin-top:8px">${err}</div>`}

          <div style="margin-top:12px;display:flex;gap:8px">
            <button class="adm-btn" onClick=${doCreate} disabled=${loading || !yaml.trim()}>
              ${loading ? '...' : t('dashboard.csmCreate')}
            </button>
            <button class="adm-btn-sm" onClick=${backToList}>${t('dashboard.cancel')}</button>
          </div>
        </div>
      </div>
    `;
  }

  // ── List view ──
  return html`
    <p style="color:var(--text-dim);margin:0 0 12px">${t('dashboard.csmExplain')}</p>
    <${ExpandableHelp} title=${t('dashboard.csmHelpTitle')}>
      ${t('dashboard.csmHelpDetail')}
    <//>

    <div style="margin-bottom:12px">
      <button class="adm-btn" onClick=${openCreate}>${t('dashboard.csmAddNew')}</button>
    </div>

    ${!templates.length
      ? html`<${Empty} text=${t('dashboard.noCsmTemplates')} />`
      : html`
        <div class="adm-card">
          <div class="scrollable">
            <table>
              <thead><tr>
                <th>${t('dashboard.name')}</th>
                <th>${t('dashboard.csmServiceType')}</th>
                <th>${t('dashboard.csmRegisteredBy')}</th>
                <th>${t('dashboard.csmFederate')}</th>
                <th>${t('dashboard.created')}</th>
                <th></th>
              </tr></thead>
              <tbody>
                ${templates.map(c => html`<tr>
                  <td><strong>${escHtml(c.name)}</strong></td>
                  <td style="font-size:.8rem;color:var(--text-dim)">${escHtml(c.service_type || '—')}</td>
                  <td style="font-size:.8rem">${escHtml(c.registered_by || '—')}</td>
                  <td>${c.federate ? '✓' : '—'}</td>
                  <td style="color:var(--text-dim)">${dt(c.registered_at)}</td>
                  <td style="white-space:nowrap">
                    <button class="adm-btn-sm" onClick=${() => showDetail(c.name)}>${t('dashboard.details')}</button>
                    ${' '}
                    <button class="adm-btn-sm" style="color:#ef4444;border-color:#ef4444" onClick=${() => doDelete(c.name)}>
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
