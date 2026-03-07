import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import * as api from '/js/services/admin.js';
import { dt, StatCard, Empty, ExpandableHelp } from './shared.js';

export default function PushTab({ data, reload }) {
  const push = data.push;
  if (!push) return html`<${Empty} text=${t('dashboard.pushNotConfigured')} />`;

  const subs = push.subscriptions || [];
  const templates = push.templates || [];
  const locales = push.locales || ['en'];

  const [tplLocale, setTplLocale] = useState(locales[0] || 'en');
  const [saving, setSaving] = useState(null);
  const [testStatus, setTestStatus] = useState(null);
  const [resetStatus, setResetStatus] = useState(null);
  const [expanded, setExpanded] = useState({});

  const localeTpls = templates.filter(tpl => tpl.locale === tplLocale);

  const handleSave = async (tpl) => {
    const key = `${tpl.id}::${tpl.locale}`;
    setSaving(key);
    try {
      await api.savePushTemplate(tpl.id, tpl.locale, tpl.fields);
      setSaving(null);
      reload();
    } catch {
      setSaving(null);
      alert(t('dashboard.saveFailed'));
    }
  };

  const handleTest = async () => {
    setTestStatus('sending');
    try {
      await api.testPush();
      setTestStatus('sent');
      setTimeout(() => setTestStatus(null), 3000);
    } catch {
      setTestStatus('error');
      setTimeout(() => setTestStatus(null), 3000);
    }
  };

  const handleReset = async () => {
    if (!confirm(t('dashboard.pushResetConfirm'))) return;
    setResetStatus('resetting');
    try {
      await api.resetPushTemplates();
      setResetStatus(null);
      reload();
    } catch {
      setResetStatus('error');
      setTimeout(() => setResetStatus(null), 3000);
    }
  };

  const updateField = (tplId, field, value) => {
    const tpl = localeTpls.find(t => t.id === tplId);
    if (tpl) tpl.fields[field] = value;
  };

  function toggle(id) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  }

  return html`
    <p style="color:var(--text-dim);font-size:.85rem;margin-bottom:12px">${t('dashboard.pushExplain')}</p>
    <${ExpandableHelp} title=${t('dashboard.pushHelpTitle')}>${t('dashboard.pushHelpDetail')}</${ExpandableHelp}>

    <div style="display:flex;gap:12px;align-items:stretch;margin-bottom:16px;flex-wrap:wrap">
      <${StatCard} label=${t('dashboard.totalSubscriptions')} value=${push.total_subscriptions || subs.length} color="#06b6d4" />
      <${StatCard} label=${t('dashboard.activeSubscriptions')} value=${subs.filter(s => s.active !== false).length} color="#22c55e" />
      <div style="margin-left:auto;display:flex;flex-direction:column;justify-content:center;gap:6px;align-items:flex-end">
        <button
          class="adm-btn"
          style="white-space:nowrap"
          onClick=${handleTest}
          disabled=${testStatus === 'sending' || !subs.length}
        >
          ${testStatus === 'sending' ? t('dashboard.pushTestSending') :
            testStatus === 'sent' ? t('dashboard.pushTestSent') :
            testStatus === 'error' ? t('dashboard.pushTestError') :
            t('dashboard.pushTestBtn')}
        </button>
        ${!subs.length && html`<span style="font-size:.72rem;color:var(--text-dim)">${t('dashboard.pushTestNoSubs')}</span>`}
        ${testStatus === 'error' && html`<span style="font-size:.72rem;color:#ef4444">${t('dashboard.pushTestErrorDetail')}</span>`}
      </div>
    </div>

    <!-- Templates card — matches email tab structure -->
    <div class="adm-card" style="margin-top:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h4 style="margin:0">${t('dashboard.pushTemplatesTitle')}</h4>
        <div style="display:flex;gap:4px">
          ${locales.map(l => html`
            <button class=${tplLocale === l ? 'adm-btn' : 'adm-btn-action'} style="padding:4px 10px;font-size:.75rem"
              onClick=${() => setTplLocale(l)}>${l.toUpperCase()}</button>
          `)}
        </div>
      </div>
      <p style="color:var(--text-dim);font-size:.85rem;margin:0 0 12px">${t('dashboard.pushTemplatesExplain')}</p>

      ${localeTpls.map(tpl => {
        const isWebPush = tpl.id.startsWith('web_push');
        const key = `${tpl.id}::${tpl.locale}`;
        const isSaving = saving === key;
        const isOpen = expanded[tpl.id];
        return html`
          <div style="border:1px solid ${isOpen ? '#818cf8' : 'var(--glass-border)'};border-radius:8px;margin-bottom:10px;overflow:hidden;transition:border-color .2s ease">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;cursor:pointer;background:${isOpen ? 'rgba(79,70,229,0.04)' : 'rgba(255,255,255,.03)'}"
              onClick=${() => toggle(tpl.id)}>
              <span style="display:flex;align-items:center;gap:8px">
                <strong>${isWebPush ? t('dashboard.pushWebPushTitle') : t('dashboard.pushEmailTitle')}</strong>
                <span style="font-size:.72rem;color:var(--text-dim)">${isWebPush ? t('dashboard.pushWebPushUsed') : t('dashboard.pushEmailUsed')}</span>
                ${!tpl.is_default && html`<span style="font-size:.65rem;background:rgba(79,70,229,0.15);color:#818cf8;padding:1px 6px;border-radius:3px;font-weight:600">${t('dashboard.pushCustomized')}</span>`}
              </span>
              <span style="font-size:.75rem;color:var(--text-dim)">${isOpen ? '\u25B2' : '\u25BC'}</span>
            </div>
            ${isOpen && html`
              <div style="padding:0 14px 14px">
                <div style="border-top:1px solid var(--glass-border);padding:12px 0 0">
                  <!-- Placeholder badges -->
                  ${tpl.placeholders && tpl.placeholders.length > 0 && html`
                    <div style="margin-bottom:10px;padding:8px 10px;border-radius:6px;background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.15)">
                      <div style="font-size:.72rem;font-weight:600;color:#f59e0b;margin-bottom:4px">${t('dashboard.emailTplParams')}</div>
                      <div style="font-size:.72rem;color:var(--text-dim);margin-bottom:6px">${t('dashboard.emailTplParamsExplain')}</div>
                      <div style="display:flex;flex-wrap:wrap;gap:6px">
                        ${tpl.placeholders.map(p => html`
                          <span style="font-size:.72rem;background:rgba(0,0,0,0.2);color:#f59e0b;padding:2px 8px;border-radius:4px;font-family:monospace">${p}</span>
                        `)}
                      </div>
                    </div>
                  `}

                  <!-- Fields -->
                  <div style="display:flex;flex-direction:column;gap:8px">
                    <label style="font-size:.75rem;color:var(--text-dim)">${isWebPush ? t('dashboard.pushFieldTitle') : t('dashboard.pushFieldSubject')}</label>
                    <input
                      class="adm-input"
                      style="font-size:.85rem;font-family:monospace"
                      value=${isWebPush ? (tpl.fields.title || '') : (tpl.fields.subject || '')}
                      onInput=${(e) => updateField(tpl.id, isWebPush ? 'title' : 'subject', e.target.value)}
                    />

                    <label style="font-size:.75rem;color:var(--text-dim)">${t('dashboard.pushFieldBody')}</label>
                    <textarea
                      class="adm-input"
                      style="font-size:.85rem;font-family:monospace;min-height:${isWebPush ? '40px' : '100px'};resize:vertical"
                      onInput=${(e) => updateField(tpl.id, 'body', e.target.value)}
                    >${tpl.fields.body || ''}</textarea>
                  </div>

                  <!-- Action buttons -->
                  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px">
                    <button class="adm-btn-action" onClick=${() => handleSave(tpl)} disabled=${isSaving}
                      style="font-size:.8rem">${isSaving ? t('dashboard.saving') : t('dashboard.save')}</button>
                  </div>
                </div>
              </div>
            `}
          </div>
        `;
      })}

      <!-- Reset button -->
      <div style="display:flex;justify-content:flex-end;margin-top:4px">
        <button class="adm-btn-action" onClick=${handleReset} disabled=${resetStatus === 'resetting'}
          style="font-size:.8rem;color:#ef4444;border-color:rgba(239,68,68,0.3)">${resetStatus === 'resetting' ? t('dashboard.pushResetting') : t('dashboard.pushResetBtn')}</button>
      </div>
    </div>

    <!-- Notification Triggers -->
    <div class="adm-card">
      <h3>${t('dashboard.pushNotifyTypesTitle')}</h3>
      <p style="color:var(--text-dim);font-size:.8rem;margin-bottom:10px">${t('dashboard.pushNotifyTypesExplain')}</p>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${['pushTypeWorkAssignment', 'pushTypeActionRequest', 'pushTypeBoardNotification', 'pushTypeFederationSync'].map(key => {
          const text = t('dashboard.' + key);
          const [code, ...descParts] = text.split(' \u2014 ');
          const desc = descParts.join(' \u2014 ');
          return html`
            <div style="display:flex;gap:10px;align-items:baseline;padding:6px 10px;border-radius:6px;background:rgba(255,255,255,0.02);border:1px solid var(--glass-border)">
              <code style="font-size:.8rem;color:#f59e0b;min-width:160px">${escHtml(code)}</code>
              <span style="font-size:.82rem;color:var(--text-dim)">${escHtml(desc)}</span>
            </div>
          `;
        })}
      </div>
    </div>

    <!-- Subscriptions -->
    ${!subs.length
      ? html`<${Empty} text=${t('dashboard.noSubscriptions')} />`
      : html`<div class="adm-card"><div class="scrollable"><table>
        <thead><tr>
          <th>${t('dashboard.owner')}</th>
          <th>${t('dashboard.endpoint')}</th>
          <th>${t('dashboard.created')}</th>
        </tr></thead>
        <tbody>
          ${subs.map(s => html`<tr>
            <td class="mono" style="font-size:.8rem">${escHtml(s.owner_name || '\u2014')}</td>
            <td class="mono" style="font-size:.8rem;max-width:200px;overflow:hidden;text-overflow:ellipsis">${escHtml(s.endpoint?.substring(0, 40) || '\u2014')}</td>
            <td style="color:var(--text-dim)">${dt(s.created_at)}</td>
          </tr>`)}
        </tbody>
      </table></div></div>`
    }
  `;
}
