import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, Empty, ExpandableHelp, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { getCsmDetail, deleteCsm, createCsm, getCsmFileTemplates, getCsmFileTemplate, getCsmBuilderPrompt } from '/js/services/admin.js';

export default function CsmTab({ data, reload }) {
  const templates = data.csm?.templates || [];
  const [view, setView] = useState('list');    // list | detail | create | prompt
  const [detail, setDetail] = useState(null);
  const [yaml, setYaml] = useState('');
  const [fileTemplates, setFileTemplates] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [prompt, setPrompt] = useState('');
  const [copied, setCopied] = useState(false);
  const [toast, showErr, showOk, clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();

  async function showDetail(name) {
    try {
      const r = await getCsmDetail(name);
      setDetail(r.data);
      setView('detail');
    } catch (e) { setErr(e.message); }
  }

  async function doDelete(name) {
    const msg = t('dashboard.csmDeleteConfirm').replace('{name}', name);
    confirm(msg, async () => {
      try {
        await deleteCsm(name);
        setView('list');
        setDetail(null);
        reload();
      } catch (e) { showErr(e.message); }
    }, { danger: true });
  }

  async function openCreate() {
    setErr('');
    setYaml('');
    setView('create');
    if (!fileTemplates) {
      try {
        const r = await getCsmFileTemplates();
        setFileTemplates(r.data?.templates || []);
      } catch (e) { console.warn('Failed to load:', e.message); setFileTemplates([]); }
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

  async function openPrompt() {
    setErr('');
    setLoading(true);
    try {
      const r = await getCsmBuilderPrompt();
      setPrompt(r.data?.prompt || '');
      setView('prompt');
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* fallback — select text */ }
  }

  function backToList() { setView('list'); setDetail(null); setErr(''); setCopied(false); }

  // ── Detail view ──
  if (view === 'detail' && detail) {
    const def = detail.definition || {};
    const svc = def.service || {};
    return html`
      <div>
        ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
        <button class="adm-btn-sm" onClick=${backToList}>← ${t('dashboard.back')}</button>
        <div class="adm-card adm-mt-md">
          <div class="adm-flex-between">
            <h4 style="margin:0">${escHtml(detail.name)}</h4>
            <button class="adm-btn-sm" style="color:#ef4444;border-color:#ef4444" onClick=${() => doDelete(detail.name)}>
              ${t('dashboard.delete')}
            </button>
          </div>
          ${svc.description && html`<p class="adm-text-base adm-text-dim" style="margin:4px 0 12px">${escHtml(svc.description)}</p>`}

          <div class="adm-text-base" style="display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;margin:12px 0">
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
        <${ConfirmUI} />
      </div>
    `;
  }

  // ── AI Prompt view ──
  if (view === 'prompt') {
    return html`
      <div>
        <button class="adm-btn-sm" onClick=${backToList}>← ${t('dashboard.back')}</button>
        <div class="adm-card adm-mt-md">
          <h4 style="margin:0 0 4px">${t('dashboard.csmAiPromptTitle')}</h4>
          <p class="adm-text-base adm-text-dim" style="margin:0 0 12px">${t('dashboard.csmAiPromptDesc')}</p>

          <div style="position:relative">
            <pre style="background:var(--bg-deep,#0f172a);padding:16px;border-radius:8px;overflow:auto;font-size:.8rem;max-height:500px;white-space:pre-wrap;line-height:1.5;border:1px solid var(--glass-border,#334155)">${prompt}</pre>
            <button class="adm-btn" style="position:absolute;top:8px;right:8px" onClick=${copyPrompt}>
              ${copied ? t('dashboard.copied') : t('dashboard.copy')}
            </button>
          </div>

          <div class="adm-mt-lg">
            <${ExpandableHelp} title=${t('dashboard.csmAiPromptHow')}>
              <ol style="margin:0;padding-left:20px;font-size:.85rem;line-height:1.8">
                <li>${t('dashboard.csmAiStep1')}</li>
                <li>${t('dashboard.csmAiStep2')}</li>
                <li>${t('dashboard.csmAiStep3')}</li>
                <li>${t('dashboard.csmAiStep4')}</li>
              </ol>
            <//>
          </div>
        </div>
      </div>
    `;
  }

  // ── Create view ──
  if (view === 'create') {
    return html`
      <div>
        <button class="adm-btn-sm" onClick=${backToList}>← ${t('dashboard.back')}</button>
        <div class="adm-card adm-mt-md">
          <h4 style="margin:0 0 12px">${t('dashboard.csmCreate')}</h4>

          ${fileTemplates && fileTemplates.length > 0 && html`
            <div class="adm-mb-md">
              <label class="adm-text-base adm-text-dim" style="display:block;margin-bottom:4px">${t('dashboard.csmCreateFromTemplate')}</label>
              <select style="width:auto;min-width:200px" onChange=${e => loadTemplate(e.target.value)}>
                <option value="">${t('dashboard.csmSelectTemplate')}</option>
                ${fileTemplates.map(ft => html`<option value=${ft.type}>${escHtml(ft.name)} (${ft.type})</option>`)}
              </select>
            </div>
          `}

          <label class="adm-text-base adm-text-dim" style="display:block;margin-bottom:4px">${t('dashboard.csmDefinition')}</label>
          <textarea
            rows="16"
            style="width:100%;font-family:monospace;font-size:.8rem;resize:vertical"
            placeholder=${t('dashboard.csmYamlPlaceholder')}
            value=${yaml}
            onInput=${e => setYaml(e.target.value)}
          />

          ${err && html`<div class="error-box adm-mt-sm">${err}</div>`}

          <div class="adm-flex adm-mt-md">
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
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <p class="adm-text-dim" style="margin:0 0 12px">${t('dashboard.csmExplain')}</p>
    <${ExpandableHelp} title=${t('dashboard.csmHelpTitle')}>
      ${t('dashboard.csmHelpDetail')}
    <//>

    <div class="adm-flex adm-mb-md">
      <button class="adm-btn" onClick=${openCreate}>${t('dashboard.csmAddNew')}</button>
      <button class="adm-btn-action" onClick=${openPrompt}>${t('dashboard.csmCreateWithAi')}</button>
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
                  <td class="adm-text-sm adm-text-dim">${escHtml(c.service_type || '—')}</td>
                  <td class="adm-text-sm">${escHtml(c.registered_by || '—')}</td>
                  <td>${c.federate ? '✓' : '—'}</td>
                  <td class="adm-text-dim">${dt(c.registered_at)}</td>
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
    <${ConfirmUI} />
  `;
}
