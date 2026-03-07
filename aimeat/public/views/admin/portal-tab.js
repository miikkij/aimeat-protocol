import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, Badge, ExpandableHelp } from './shared.js';
import {
  saveSiteTemplate, deleteSiteTemplate, clearSiteCache,
  getSiteMemoryKeys, getSitePrompt, addMemory, deleteMemory, triggerLbSync,
} from '/js/services/admin.js';

export default function PortalTab({ data, reload }) {
  const p = data.portal || {};
  const meta = p.meta || {};
  const tmpl = p.template || {};
  const changes = (p.changelog?.entries) || [];
  const isLb = meta.lb_mode?.enabled;

  const [template, setTemplate] = useState(tmpl.template || '');
  const [memKeys, setMemKeys] = useState(null);
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');

  useEffect(() => { loadMemKeys(); }, []);

  async function loadMemKeys() {
    try {
      const res = await getSiteMemoryKeys();
      setMemKeys(res.data?.keys || []);
    } catch { setMemKeys([]); }
  }

  async function saveTemplate() {
    try { await saveSiteTemplate(template); reload(); }
    catch (e) { alert(t('dashboard.errorLabel') + ': ' + e.message); }
  }

  function downloadTemplate() {
    if (!template) return;
    const blob = new Blob([template], { type: 'text/html' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'portal-template.html'; a.click();
  }

  async function resetTemplate() {
    if (!confirm(t('dashboard.portalResetDefault') + '?')) return;
    try { await deleteSiteTemplate(); reload(); }
    catch (e) { alert(t('dashboard.errorLabel') + ': ' + e.message); }
  }

  async function doClearCache() {
    try { await clearSiteCache(); } catch (e) { alert(t('dashboard.errorLabel') + ': ' + e.message); }
  }

  async function addMem() {
    if (!newKey.trim()) return;
    try { await addMemory(newKey, newVal); setNewKey(''); setNewVal(''); loadMemKeys(); }
    catch (e) { alert(t('dashboard.errorLabel') + ': ' + e.message); }
  }

  async function delMem(key) {
    if (!confirm(t('dashboard.portalDeleteKeyConfirm').replace('{key}', key))) return;
    try { await deleteMemory(key); loadMemKeys(); }
    catch (e) { alert(t('dashboard.errorLabel') + ': ' + e.message); }
  }

  async function copyPrompt() {
    try {
      const res = await getSitePrompt();
      const prompt = res.data?.prompt || 'No prompt available';
      await navigator.clipboard.writeText(prompt);
      alert(t('dashboard.portalAiCopied'));
    } catch (e) { alert(t('dashboard.errorLabel') + ': ' + e.message); }
  }

  async function doLbSync() {
    try {
      const res = await triggerLbSync();
      const d = res.data || {};
      alert(t('dashboard.portalLbSyncDone') + ' (template: ' + (d.template_updated ? 'yes' : 'no') + ', memory: ' + (d.memory_keys_synced || 0) + ')');
      reload();
    } catch (e) { alert(t('dashboard.errorLabel') + ': ' + e.message); }
  }

  const kv = meta.kv || {};
  const kvKeys = Object.keys(kv);

  return html`
    <!-- LB mode banner -->
    ${isLb && html`
      <div class="adm-card" style="border:1px solid #eab308;margin-bottom:16px">
        <h3>\u{1F504} ${t('dashboard.portalLbMode')}</h3>
        <p style="color:var(--text-dim);margin-bottom:8px">${t('dashboard.portalLbReadOnly')}</p>
        <div class="adm-erow"><span class="adm-elabel">${t('dashboard.portalLbOrigin')}</span><span class="adm-eval">${escHtml(meta.lb_mode.origin_url || '-')}</span></div>
        <div class="adm-erow"><span class="adm-elabel">${t('dashboard.portalLbLastSync')}</span><span class="adm-eval">${meta.lb_mode.last_sync ? dt(meta.lb_mode.last_sync) : '-'}</span></div>
        ${meta.lb_mode.last_error && html`<div class="adm-erow"><span class="adm-elabel">${t('dashboard.portalLbError')}</span><span style="color:#ef4444">${escHtml(meta.lb_mode.last_error)}</span></div>`}
        <button class="adm-btn-action" style="margin-top:8px" onClick=${doLbSync}>\u{1F504} ${t('dashboard.portalLbSyncNow')}</button>
      </div>
    `}

    <!-- Preview -->
    <div class="adm-card">
      <h3>${t('dashboard.portalPreview')}</h3>
      <iframe src="/" style="width:100%;height:400px;border:1px solid var(--glass-border);border-radius:8px;background:#fff" sandbox="allow-same-origin"></iframe>
      <div style="margin-top:8px;display:flex;gap:8px">
        <button class="adm-btn-action" onClick=${doClearCache}>\u{1F6AB} ${t('dashboard.portalClearCache')}</button>
      </div>
    </div>

    <!-- Template editor -->
    <div class="adm-card">
      <h3>${t('dashboard.portalTemplate')}</h3>
      <${ExpandableHelp} title=${t('dashboard.portalTagHelpTitle')}>
        <p>${t('dashboard.portalTagHelpDetail')}</p>
        <table>
          <thead><tr><th>Tag</th><th>${t('dashboard.details')}</th></tr></thead>
          <tbody>
            <tr><td><code>\{\{config:node_id\}\}</code></td><td>${t('dashboard.tagExConfig')}</td></tr>
            <tr><td><code>\{\{memory:portal/welcome\}\}</code></td><td>${t('dashboard.tagExMemory')}</td></tr>
            <tr><td><code>\{\{storage:type\}\}</code></td><td>${t('dashboard.tagExStorage')}</td></tr>
            <tr><td><code>\{\{kv:site_name\}\}</code></td><td>${t('dashboard.tagExKv')}</td></tr>
            <tr><td><code>\{\{board:general\}\}</code></td><td>${t('dashboard.tagExBoard')}</td></tr>
          </tbody>
        </table>
      </${ExpandableHelp}>
      <textarea rows="20" value=${template} onInput=${e => setTemplate(e.target.value)}
        style="width:100%;font-family:monospace;font-size:13px;padding:12px;border:1px solid var(--glass-border);border-radius:8px;background:var(--glass-bg);color:var(--text-bright);resize:vertical"></textarea>
      <div style="margin-top:8px;display:flex;gap:8px">
        <button class="adm-btn-action" onClick=${saveTemplate}>\u{1F4BE} ${t('dashboard.portalSaveTemplate')}</button>
        <button class="adm-btn-action" onClick=${downloadTemplate}>\u{1F4E5} ${t('dashboard.portalDownload')}</button>
        <button class="adm-btn-action" onClick=${resetTemplate}>\u{1F504} ${t('dashboard.portalResetDefault')}</button>
      </div>
    </div>

    <!-- Memory keys -->
    <div class="adm-card">
      <h3>${t('dashboard.portalMemoryKeys')}</h3>
      <p style="color:var(--text-dim);font-size:.85rem;margin-bottom:8px">${t('dashboard.portalMemoryKeysExplain')}</p>
      ${memKeys === null
        ? html`<div style="color:var(--text-dim)">${t('dashboard.loading')}...</div>`
        : memKeys.length === 0
          ? html`<div style="color:var(--text-dim)">${t('dashboard.portalNoMemoryKeys')}</div>`
          : html`<table>
            <thead><tr><th>${t('dashboard.portalKeyLabel')}</th><th>${t('dashboard.portalValueLabel')}</th><th></th></tr></thead>
            <tbody>
              ${memKeys.map(k => html`<tr>
                <td><code>${escHtml(k.key)}</code></td>
                <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis">${escHtml(String(k.value || ''))}</td>
                <td><button class="adm-btn-sm" onClick=${() => delMem(k.key)}>\u274C</button></td>
              </tr>`)}
            </tbody>
          </table>`
      }
      <div style="margin-top:8px;display:flex;gap:8px;align-items:center">
        <input class="adm-inp" value=${newKey} onInput=${e => setNewKey(e.target.value)} placeholder="portal/key" style="flex:1;background:var(--glass-bg);border:1px solid var(--glass-border);color:var(--text-bright);padding:8px 12px;border-radius:6px" />
        <input class="adm-inp" value=${newVal} onInput=${e => setNewVal(e.target.value)} placeholder="value" style="flex:2;background:var(--glass-bg);border:1px solid var(--glass-border);color:var(--text-bright);padding:8px 12px;border-radius:6px" />
        <button class="adm-btn-action" onClick=${addMem}>+ ${t('dashboard.portalUpload')}</button>
      </div>
    </div>

    <!-- KV pairs -->
    <div class="adm-card">
      <h3>${t('dashboard.portalKvPairs')}</h3>
      <p style="color:var(--text-dim);font-size:.85rem;margin-bottom:8px">${t('dashboard.portalKvExplain')}</p>
      ${kvKeys.length === 0
        ? html`<div style="color:var(--text-dim)">${t('dashboard.portalNoKvPairs')}</div>`
        : html`<table>
          <thead><tr><th>${t('dashboard.portalKeyLabel')}</th><th>${t('dashboard.portalValueLabel')}</th></tr></thead>
          <tbody>${kvKeys.map(k => html`<tr><td><code>${escHtml(k)}</code></td><td class="adm-eval">${escHtml(kv[k])}</td></tr>`)}</tbody>
        </table>`
      }
    </div>

    <!-- AI Chat -->
    <div class="adm-card">
      <h3>${t('dashboard.portalAiChat')}</h3>
      <p style="color:var(--text-dim);font-size:.85rem">${t('dashboard.portalAiExplain')}</p>
      <div style="margin-top:8px">
        <button class="adm-btn-action" onClick=${copyPrompt}>\u{1F4CB} ${t('dashboard.portalAiLoadPrompt')}</button>
      </div>
    </div>

    <!-- Changelog -->
    <div class="adm-card">
      <h3>${t('dashboard.portalChangelog')}</h3>
      ${changes.length === 0
        ? html`<div style="color:var(--text-dim)">${t('dashboard.portalNoChanges')}</div>`
        : html`<table>
          <thead><tr><th>${t('dashboard.action')}</th><th>${t('dashboard.by')}</th><th>${t('dashboard.created')}</th></tr></thead>
          <tbody>
            ${changes.slice(0, 20).map(c => html`<tr>
              <td><${Badge} type=${c.action} /></td>
              <td class="mono" style="font-size:.75rem">${escHtml(c.changed_by || c.changedBy || '-')}</td>
              <td style="color:var(--text-dim)">${dt(c.changed_at || c.changedAt)}</td>
            </tr>`)}
          </tbody>
        </table>`
      }
    </div>
  `;
}
