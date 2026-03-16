import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import * as api from '/js/services/admin.js';
import { dt, StatCard, Empty, ExpandableHelp, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';

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
  const [subStatus, setSubStatus] = useState(null); // null | 'subscribing' | 'subscribed' | 'unsubscribing' | 'error'
  const { confirm, ConfirmUI } = useConfirm();
  const [toast, showErr, showOk, clearToast] = useToast();

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
      showErr(t('dashboard.saveFailed'));
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

  const handleReset = () => {
    confirm(t('dashboard.pushResetConfirm'), async () => {
      setResetStatus('resetting');
      try {
        await api.resetPushTemplates();
        setResetStatus(null);
        reload();
      } catch {
        setResetStatus('error');
        setTimeout(() => setResetStatus(null), 3000);
      }
    }, { danger: true });
  };

  const handleSubscribe = async () => {
    setSubStatus('subscribing');
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        showErr(t('dashboard.pushNoBrowserSupport') || 'This browser does not support push notifications');
        setSubStatus('error');
        return;
      }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const vapidRes = await api.getVapidKey();
      const vapidKey = vapidRes.data.vapidPublicKey;
      const urlBase64 = vapidKey.replace(/-/g, '+').replace(/_/g, '/');
      const raw = atob(urlBase64);
      const outputArray = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) outputArray[i] = raw.charCodeAt(i);
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: outputArray,
      });
      const subJson = subscription.toJSON();
      await api.subscribePush(subJson.endpoint, { p256dh: subJson.keys.p256dh, auth: subJson.keys.auth });
      setSubStatus('subscribed');
      reload();
    } catch (err) {
      console.error('Push subscribe failed:', err);
      setSubStatus('error');
      setTimeout(() => setSubStatus(null), 3000);
    }
  };

  const handleUnsubscribe = async () => {
    setSubStatus('unsubscribing');
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
      }
      await api.unsubscribePush();
      setSubStatus(null);
      reload();
    } catch {
      setSubStatus('error');
      setTimeout(() => setSubStatus(null), 3000);
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
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <p class="adm-text-dim adm-text-base adm-mb-md">${t('dashboard.pushExplain')}</p>
    <${ExpandableHelp} title=${t('dashboard.pushHelpTitle')}>${t('dashboard.pushHelpDetail')}</${ExpandableHelp}>

    <div class="adm-flex-wrap adm-mb-lg" style="gap:12px;align-items:stretch">
      <${StatCard} label=${t('dashboard.totalSubscriptions')} value=${push.total_subscriptions || subs.length} color="#06b6d4" />
      <${StatCard} label=${t('dashboard.activeSubscriptions')} value=${subs.filter(s => s.active !== false).length} color="#22c55e" />
      <div style="margin-left:auto;display:flex;flex-direction:column;justify-content:center;gap:6px;align-items:flex-end">
        <div class="adm-flex">
          <button
            class="adm-btn"
            style="white-space:nowrap"
            onClick=${handleSubscribe}
            disabled=${subStatus === 'subscribing'}
          >
            ${subStatus === 'subscribing' ? (t('dashboard.pushSubscribing') || 'Subscribing...') :
              subStatus === 'subscribed' ? (t('dashboard.pushSubscribed') || 'Subscribed!') :
              (t('dashboard.pushSubscribeBtn') || 'Subscribe this browser')}
          </button>
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
        </div>
        ${subs.length > 0 && html`
          <button
            style="font-size:.72rem;color:var(--text-dim);background:none;border:none;cursor:pointer;text-decoration:underline;padding:0"
            onClick=${handleUnsubscribe}
            disabled=${subStatus === 'unsubscribing'}
          >${t('dashboard.pushUnsubscribeBtn') || 'Unsubscribe'}</button>
        `}
        ${!subs.length && html`<span class="adm-text-dim" style="font-size:.72rem">${t('dashboard.pushTestNoSubs')}</span>`}
        ${testStatus === 'error' && html`<span class="adm-text-error" style="font-size:.72rem">${t('dashboard.pushTestErrorDetail')}</span>`}
      </div>
    </div>

    <!-- Templates card — matches email tab structure -->
    <div class="adm-card adm-mt-md">
      <div class="adm-flex-between adm-mb-md">
        <h4 style="margin:0">${t('dashboard.pushTemplatesTitle')}</h4>
        <div style="display:flex;gap:4px">
          ${locales.map(l => html`
            <button class=${tplLocale === l ? 'adm-btn' : 'adm-btn-action'} style="padding:4px 10px;font-size:.75rem"
              onClick=${() => setTplLocale(l)}>${l.toUpperCase()}</button>
          `)}
        </div>
      </div>
      <p class="adm-text-dim adm-text-base adm-mb-md" style="margin:0">${t('dashboard.pushTemplatesExplain')}</p>

      ${localeTpls.map(tpl => {
        const isWebPush = tpl.id.startsWith('web_push');
        const key = `${tpl.id}::${tpl.locale}`;
        const isSaving = saving === key;
        const isOpen = expanded[tpl.id];
        return html`
          <div style="border:1px solid ${isOpen ? '#818cf8' : 'var(--glass-border)'};border-radius:8px;margin-bottom:10px;overflow:hidden;transition:border-color .2s ease">
            <div class="adm-flex-between" style="padding:10px 14px;cursor:pointer;background:${isOpen ? 'rgba(79,70,229,0.04)' : 'rgba(255,255,255,.03)'}"
              onClick=${() => toggle(tpl.id)}>
              <span class="adm-flex-center">
                <strong>${isWebPush ? t('dashboard.pushWebPushTitle') : t('dashboard.pushEmailTitle')}</strong>
                <span class="adm-text-dim" style="font-size:.72rem">${isWebPush ? t('dashboard.pushWebPushUsed') : t('dashboard.pushEmailUsed')}</span>
                ${!tpl.is_default && html`<span style="font-size:.65rem;background:rgba(79,70,229,0.15);color:#818cf8;padding:1px 6px;border-radius:3px;font-weight:600">${t('dashboard.pushCustomized')}</span>`}
              </span>
              <span class="adm-text-dim" style="font-size:.75rem">${isOpen ? '\u25B2' : '\u25BC'}</span>
            </div>
            ${isOpen && html`
              <div style="padding:0 14px 14px">
                <div style="border-top:1px solid var(--glass-border);padding:12px 0 0">
                  <!-- Placeholder badges -->
                  ${tpl.placeholders && tpl.placeholders.length > 0 && html`
                    <div style="margin-bottom:10px;padding:8px 10px;border-radius:6px;background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.15)">
                      <div style="font-size:.72rem;font-weight:600;color:#f59e0b;margin-bottom:4px">${t('dashboard.emailTplParams')}</div>
                      <div style="font-size:.72rem;color:var(--text-dim);margin-bottom:6px">${t('dashboard.emailTplParamsExplain')}</div>
                      <div class="adm-flex-wrap" style="gap:6px">
                        ${tpl.placeholders.map(p => html`
                          <span style="font-size:.72rem;background:rgba(0,0,0,0.2);color:#f59e0b;padding:2px 8px;border-radius:4px;font-family:monospace">${p}</span>
                        `)}
                      </div>
                    </div>
                  `}

                  <!-- Fields -->
                  <div class="adm-flex-col">
                    <label class="adm-text-dim" style="font-size:.75rem">${isWebPush ? t('dashboard.pushFieldTitle') : t('dashboard.pushFieldSubject')}</label>
                    <input
                      class="adm-input"
                      style="font-size:.85rem;font-family:monospace"
                      value=${isWebPush ? (tpl.fields.title || '') : (tpl.fields.subject || '')}
                      onInput=${(e) => updateField(tpl.id, isWebPush ? 'title' : 'subject', e.target.value)}
                    />

                    <label class="adm-text-dim" style="font-size:.75rem">${t('dashboard.pushFieldBody')}</label>
                    <textarea
                      class="adm-input"
                      style="font-size:.85rem;font-family:monospace;min-height:${isWebPush ? '40px' : '100px'};resize:vertical"
                      onInput=${(e) => updateField(tpl.id, 'body', e.target.value)}
                    >${tpl.fields.body || ''}</textarea>
                  </div>

                  <!-- Action buttons -->
                  <div class="adm-flex-center" style="flex-wrap:wrap;margin-top:10px">
                    <button class="adm-btn-action adm-text-sm" onClick=${() => handleSave(tpl)} disabled=${isSaving}>
                      ${isSaving ? t('dashboard.saving') : t('dashboard.save')}</button>
                  </div>
                </div>
              </div>
            `}
          </div>
        `;
      })}

      <!-- Reset button -->
      <div style="display:flex;justify-content:flex-end;margin-top:4px">
        <button class="adm-btn-action adm-text-sm" onClick=${handleReset} disabled=${resetStatus === 'resetting'}
          style="color:#ef4444;border-color:rgba(239,68,68,0.3)">${resetStatus === 'resetting' ? t('dashboard.pushResetting') : t('dashboard.pushResetBtn')}</button>
      </div>
    </div>

    <!-- Notification Triggers -->
    <div class="adm-card">
      <h3>${t('dashboard.pushNotifyTypesTitle')}</h3>
      <p class="adm-text-dim adm-text-sm" style="margin-bottom:10px">${t('dashboard.pushNotifyTypesExplain')}</p>
      <div class="adm-flex-col" style="gap:6px">
        ${['pushTypeWorkAssignment', 'pushTypeActionRequest', 'pushTypeBoardNotification', 'pushTypeFederationSync'].map(key => {
          const text = t('dashboard.' + key);
          const [code, ...descParts] = text.split(' \u2014 ');
          const desc = descParts.join(' \u2014 ');
          return html`
            <div style="display:flex;gap:10px;align-items:baseline;padding:6px 10px;border-radius:6px;background:rgba(255,255,255,0.02);border:1px solid var(--glass-border)">
              <code class="adm-text-sm" style="color:#f59e0b;min-width:160px">${escHtml(code)}</code>
              <span class="adm-text-dim" style="font-size:.82rem">${escHtml(desc)}</span>
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
            <td class="mono adm-text-sm">${escHtml(s.owner_name || '\u2014')}</td>
            <td class="mono adm-text-sm" style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${escHtml(s.endpoint?.substring(0, 40) || '\u2014')}</td>
            <td class="adm-text-dim">${dt(s.created_at)}</td>
          </tr>`)}
        </tbody>
      </table></div></div>`
    }
    <${ConfirmUI} />
  `;
}
