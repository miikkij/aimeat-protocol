import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Badge, Empty, ExpandableHelp } from './shared.js';
import { saveConfig, deleteConfig } from '/js/services/admin.js';

// Map config source to Badge type for visual distinction
const SOURCE_BADGE = {
  database: 'healthy',
  env: 'info',
  file: 'private',
  consul: 'watch',
  default: 'idle',
};

export default function ConfigTab({ data, reload }) {
  const s = data.configSchema;
  if (!s || !s.schema) return html`<${Empty} text=${t('dashboard.configNotAvailable')} />`;

  const [pending, setPending] = useState({});
  const [result, setResult] = useState(null);

  const schema = s.schema;
  const editable = s.editable !== false;

  // Group by first part of path
  const groups = {};
  for (const path in schema) {
    const group = path.split('.')[0];
    if (!groups[group]) groups[group] = [];
    groups[group].push({ path, entry: schema[path] });
  }

  // Translate a config path — try dashboard.cfg_<dotpath> then fall back to raw path
  function label(path) {
    const key = 'dashboard.cfg_' + path.replace(/\./g, '_');
    const val = t(key);
    return val !== key ? val : path;
  }
  function groupLabel(g) {
    const key = 'dashboard.cfgGroup_' + g;
    const val = t(key);
    return val !== key ? val : g.charAt(0).toUpperCase() + g.slice(1).replace(/_/g, ' ');
  }

  function onChange(path, value) {
    setPending(prev => ({ ...prev, [path]: value }));
  }

  async function save() {
    const changes = Object.entries(pending).map(([path, value]) => ({ path, value }));
    if (!changes.length) return;
    try {
      const r = await saveConfig(changes);
      setResult({ ok: true, msg: t('dashboard.savedChanges').replace('{count}', r.data.applied.length) });
      setPending({});
      reload();
    } catch (err) {
      setResult({ ok: false, msg: err.message });
    }
  }

  async function resetConfig(path) {
    try {
      await deleteConfig(path);
      setResult({ ok: true, msg: t('dashboard.cfgResetDone').replace('{path}', path) });
      reload();
    } catch (err) {
      setResult({ ok: false, msg: err.message });
    }
  }

  function cancel() {
    setPending({});
    setResult(null);
  }

  const pendingKeys = Object.keys(pending);

  return html`
    <!-- Read-only banner for in-memory storage -->
    ${!editable && html`
      <div class="adm-config-readonly-banner">
        <p>${t('dashboard.cfgReadOnlyBanner')}</p>
        <${ExpandableHelp} title=${t('dashboard.cfgReadOnlyHelpTitle')}>
          <p>${t('dashboard.cfgReadOnlyHelpDetail')}</p>
        </${ExpandableHelp}>
      </div>
    `}

    ${result && html`<div style="margin-bottom:12px;padding:8px 12px;border-radius:6px;background:${result.ok ? '#16a34a22' : '#dc262622'};color:${result.ok ? '#22c55e' : '#ef4444'};font-size:.85rem">${escHtml(result.msg)}</div>`}

    <!-- Pending changes banner -->
    ${editable && pendingKeys.length > 0 && html`
      <div class="adm-config-changes">
        <h3 style="color:#eab308;margin-bottom:8px">${t('dashboard.pendingChanges')}</h3>
        ${pendingKeys.map(k => html`<div>${escHtml(k)} \u2192 <strong>${escHtml(String(pending[k]))}</strong></div>`)}
        <div style="margin-top:8px">
          <button class="adm-btn-action" onClick=${save}>${t('dashboard.saveChanges')}</button>
          ${' '}
          <button class="adm-btn-action" onClick=${cancel}>${t('dashboard.cancelLabel')}</button>
        </div>
      </div>
    `}

    ${Object.entries(groups).map(([g, items]) => {
      const helpKey = 'dashboard.cfgHelp_' + g;
      const helpText = t(helpKey);
      const hasHelp = helpText !== helpKey;
      return html`
      <details class="adm-card" style="margin-bottom:8px" open>
        <summary style="cursor:pointer;font-weight:600;font-size:.95rem;padding:8px 0">
          ${groupLabel(g)}
        </summary>
        ${hasHelp && html`<${ExpandableHelp} title=${t('dashboard.cfgHelpTitle')}><p>${helpText}</p></${ExpandableHelp}>`}
        <div class=${!editable ? 'adm-config-readonly' : ''} style="padding:8px 0">
          ${items.map(({ path: p, entry: e }) => html`
            <div class="adm-hrow">
              <span class="adm-hmetric" title=${e.description}>
                ${label(p)}
                ${e.source && html` <span class="adm-badge adm-badge-${SOURCE_BADGE[e.source] || 'idle'}" style="font-size:.6rem;vertical-align:middle">${e.source}</span>`}
              </span>
              <span>
                ${!e.mutable
                  ? (typeof e.value === 'boolean'
                    ? html`${e.value ? html`<${Badge} type="healthy" /> ${t('dashboard.yesLabel')}` : html`<${Badge} type="critical" /> ${t('dashboard.noLabel')}`}`
                    : html`<code>${escHtml(String(e.value))}</code> <span style="color:var(--text-dim);font-size:.75rem">${t('dashboard.readOnly')}</span>`)
                  : e.type === 'boolean'
                    ? html`<label style="cursor:pointer"><input type="checkbox" checked=${e.value} onChange=${ev => onChange(p, ev.target.checked)} disabled=${!editable} /> ${e.value ? t('dashboard.enabled') : t('dashboard.disabled')}</label>`
                    : e.type === 'integer'
                      ? html`<input type="number" value=${e.value} style="width:120px" onChange=${ev => onChange(p, parseInt(ev.target.value))} disabled=${!editable} />${e.range ? html` <span style="color:var(--text-dim);font-size:.75rem">${escHtml(e.range)}</span>` : null}`
                      : e.type === 'float'
                        ? html`<input type="number" step="0.01" value=${e.value} style="width:120px" onChange=${ev => onChange(p, parseFloat(ev.target.value))} disabled=${!editable} />${e.range ? html` <span style="color:var(--text-dim);font-size:.75rem">${escHtml(e.range)}</span>` : null}`
                        : e.type === 'string'
                          ? html`<input type="text" value=${e.value || ''} style="width:250px" onChange=${ev => onChange(p, ev.target.value)} disabled=${!editable} />`
                          : e.type === 'object'
                            ? html`<code style="font-size:.75rem">${escHtml(JSON.stringify(e.value)).substring(0, 100)}...</code>`
                            : html`<code>${escHtml(String(e.value))}</code>`
                }
                ${e.canReset && editable && html` <button class="adm-btn-sm" onClick=${() => resetConfig(p)}>${t('dashboard.cfgReset')}</button>`}
              </span>
            </div>
          `)}
        </div>
      </details>
    `})}
  `;
}
