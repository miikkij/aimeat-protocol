import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import * as api from '/js/services/admin.js';
import { dt, StatsGrid, Empty, ExpandableHelp } from './shared.js';

export default function PushTab({ data, reload }) {
  const push = data.push;
  if (!push) return html`<${Empty} text=${t('dashboard.pushNotConfigured')} />`;

  const subs = push.subscriptions || [];
  const templates = push.templates || [];
  const locales = push.locales || ['en'];

  const [activeLocale, setActiveLocale] = useState(locales[0] || 'en');
  const [saving, setSaving] = useState(null);
  const [testStatus, setTestStatus] = useState(null);
  const [resetStatus, setResetStatus] = useState(null);

  const localeTpls = templates.filter(tpl => tpl.locale === activeLocale);

  const handleSave = async (tpl) => {
    const key = `${tpl.id}::${tpl.locale}`;
    setSaving(key);
    try {
      await api.savePushTemplate(tpl.id, tpl.locale, tpl.fields);
      setSaving(null);
      reload();
    } catch (err) {
      setSaving(null);
      alert(t('dashboard.saveFailed') || 'Save failed: ' + String(err));
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
    if (!confirm(t('dashboard.pushResetConfirm') || 'Reset all templates to defaults? This will overwrite any customizations.')) return;
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

  return html`
    <p style="color:var(--text-dim);font-size:.85rem;margin-bottom:12px">${t('dashboard.pushExplain')}</p>
    <${ExpandableHelp} title=${t('dashboard.pushHelpTitle')}>${t('dashboard.pushHelpDetail')}</${ExpandableHelp}>

    <div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:16px;flex-wrap:wrap">
      <${StatsGrid} items=${[
        { label: t('dashboard.totalSubscriptions'), value: push.total_subscriptions || subs.length, color: '#06b6d4' },
        { label: t('dashboard.activeSubscriptions'), value: subs.filter(s => s.active !== false).length, color: '#22c55e' },
      ]} />
      <div style="margin-left:auto;display:flex;flex-direction:column;gap:8px;align-items:flex-end">
        <button
          class="adm-btn"
          style="white-space:nowrap"
          onClick=${handleTest}
          disabled=${testStatus === 'sending'}
        >
          ${testStatus === 'sending' ? (t('dashboard.pushTestSending') || 'Sending...') :
            testStatus === 'sent' ? (t('dashboard.pushTestSent') || 'Sent!') :
            testStatus === 'error' ? (t('dashboard.pushTestError') || 'Failed') :
            (t('dashboard.pushTestBtn') || 'Send Test Push')}
        </button>
      </div>
    </div>

    <!-- Locale Tabs -->
    <div style="display:flex;gap:4px;margin-bottom:16px">
      ${locales.map(loc => html`
        <button class=${activeLocale === loc ? 'adm-btn' : 'adm-btn-action'} style="padding:4px 10px;font-size:.75rem"
          onClick=${() => setActiveLocale(loc)}>${loc.toUpperCase()}</button>
      `)}
    </div>

    <!-- Editable Templates -->
    <div class="adm-card">
      <h3>${t('dashboard.pushTemplatesTitle')}</h3>
      <p style="color:var(--text-dim);font-size:.8rem;margin-bottom:12px">${t('dashboard.pushTemplatesExplain')}</p>

      <div style="display:flex;flex-direction:column;gap:16px">
        ${localeTpls.map(tpl => {
          const isWebPush = tpl.id.startsWith('web_push');
          const key = `${tpl.id}::${tpl.locale}`;
          const isSaving = saving === key;
          return html`
            <div style="border:1px solid var(--glass-border);border-radius:8px;padding:14px;background:rgba(255,255,255,0.02)">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <div style="font-weight:700;font-size:.9rem">
                  ${isWebPush ? t('dashboard.pushWebPushTitle') : t('dashboard.pushEmailTitle')}
                </div>
                <span style="font-size:.7rem;color:${tpl.is_default ? 'var(--text-dim)' : '#22c55e'}">${tpl.is_default ? (t('dashboard.pushDefault') || 'default') : (t('dashboard.pushCustomized') || 'customized')}</span>
              </div>
              <div style="font-size:.8rem;color:var(--text-dim);margin-bottom:10px">
                ${isWebPush ? t('dashboard.pushWebPushUsed') : t('dashboard.pushEmailUsed')}
              </div>

              <div style="display:flex;flex-direction:column;gap:8px">
                ${isWebPush ? html`
                  <label style="font-size:.75rem;color:var(--text-dim)">${t('dashboard.pushFieldTitle')}</label>
                  <input
                    class="adm-input"
                    style="font-size:.85rem;font-family:monospace"
                    value=${tpl.fields.title || ''}
                    onInput=${(e) => updateField(tpl.id, 'title', e.target.value)}
                  />
                ` : html`
                  <label style="font-size:.75rem;color:var(--text-dim)">${t('dashboard.pushFieldSubject')}</label>
                  <input
                    class="adm-input"
                    style="font-size:.85rem;font-family:monospace"
                    value=${tpl.fields.subject || ''}
                    onInput=${(e) => updateField(tpl.id, 'subject', e.target.value)}
                  />
                `}

                <label style="font-size:.75rem;color:var(--text-dim)">${t('dashboard.pushFieldBody')}</label>
                <textarea
                  class="adm-input"
                  style="font-size:.85rem;font-family:monospace;min-height:${isWebPush ? '40px' : '100px'};resize:vertical"
                  onInput=${(e) => updateField(tpl.id, 'body', e.target.value)}
                >${tpl.fields.body || ''}</textarea>

                <!-- Placeholder badges -->
                <div style="display:flex;gap:6px;flex-wrap:wrap">
                  ${(tpl.placeholders || []).map(p => html`
                    <span style="font-size:.72rem;padding:2px 8px;border-radius:10px;background:rgba(245,158,11,0.15);color:#f59e0b;border:1px solid rgba(245,158,11,0.3)">${p}</span>
                  `)}
                </div>

                <div style="display:flex;justify-content:flex-end;margin-top:4px">
                  <button
                    class="adm-btn"
                    style="font-size:.8rem"
                    onClick=${() => handleSave(tpl)}
                    disabled=${isSaving}
                  >${isSaving ? t('dashboard.saving') : t('dashboard.save')}</button>
                </div>
              </div>
            </div>
          `;
        })}
      </div>

      <!-- Reset button -->
      <div style="display:flex;justify-content:flex-end;margin-top:12px">
        <button
          class="adm-btn"
          style="font-size:.78rem;color:var(--text-dim)"
          onClick=${handleReset}
          disabled=${resetStatus === 'resetting'}
        >${resetStatus === 'resetting' ? (t('dashboard.pushResetting') || 'Resetting...') : (t('dashboard.pushResetBtn') || 'Reset to Default Templates')}</button>
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
