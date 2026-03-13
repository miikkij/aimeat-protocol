import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Spinner } from './shared.js';
import { apiGet, apiPost, apiDelete } from '/js/api.js';

export default function NotificationsTab({ session, showToast }) {
  const [loading, setLoading] = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [subStatus, setSubStatus] = useState(null); // null | 'subscribing' | 'unsubscribing'
  const [vapidKey, setVapidKey] = useState(null);

  useEffect(() => {
    if (session) checkSubscription();
  }, [session]);

  async function checkSubscription() {
    setLoading(true);
    try {
      // Get VAPID key
      const vapidRes = await apiGet('/v1/push/vapid-key');
      if (vapidRes.data?.vapidPublicKey) {
        setVapidKey(vapidRes.data.vapidPublicKey);
      }
      // Check if browser has active subscription and sync with server
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration('/sw.js');
        if (reg) {
          const sub = await reg.pushManager.getSubscription();
          if (sub) {
            // Re-register with server in case it lost the record (e.g. restart)
            const subJson = sub.toJSON();
            await apiPost('/v1/push/subscribe', {
              endpoint: subJson.endpoint,
              keys: { p256dh: subJson.keys.p256dh, auth: subJson.keys.auth },
            });
          }
          setSubscribed(!!sub);
        }
      }
    } catch { /* push not configured */ }
    setLoading(false);
  }

  async function handleSubscribe() {
    setSubStatus('subscribing');
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        showToast(t('profile.notifications.noBrowserSupport'), true);
        setSubStatus(null);
        return;
      }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      const key = vapidKey;
      if (!key) {
        showToast(t('profile.notifications.notConfigured'), true);
        setSubStatus(null);
        return;
      }

      const urlBase64 = key.replace(/-/g, '+').replace(/_/g, '/');
      const raw = atob(urlBase64);
      const outputArray = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) outputArray[i] = raw.charCodeAt(i);

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: outputArray,
      });
      const subJson = subscription.toJSON();
      const res = await apiPost('/v1/push/subscribe', {
        endpoint: subJson.endpoint,
        keys: { p256dh: subJson.keys.p256dh, auth: subJson.keys.auth },
      });
      if (res.ok === false || res.error) {
        showToast(res.error?.message || t('profile.notifications.subscribeFailed'), true);
        setSubStatus(null);
        return;
      }
      setSubscribed(true);
      showToast(t('profile.notifications.subscribeSuccess'));
    } catch (err) {
      console.error('Push subscribe failed:', err);
      showToast(t('profile.notifications.subscribeFailed'), true);
    }
    setSubStatus(null);
  }

  async function handleUnsubscribe() {
    setSubStatus('unsubscribing');
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
      }
      await apiDelete('/v1/push/subscribe');
      setSubscribed(false);
      showToast(t('profile.notifications.unsubscribeSuccess'));
    } catch {
      showToast(t('profile.notifications.unsubscribeFailed'), true);
    }
    setSubStatus(null);
  }

  async function handleTestPush() {
    try {
      const res = await apiPost('/v1/push/test');
      if (res.ok === false || res.error) {
        showToast(res.error?.message || t('profile.notifications.testFailed'), true);
        return;
      }
      showToast(t('profile.notifications.testSent'));
    } catch {
      showToast(t('profile.notifications.testFailed'), true);
    }
  }

  if (loading) return html`<${Spinner} />`;

  if (!vapidKey) {
    return html`
      <div class="pf-card">
        <h3>${t('profile.notifications.title')}</h3>
        <p style="color:var(--text-dim)">${t('profile.notifications.notConfigured')}</p>
      </div>
    `;
  }

  return html`
    <div class="pf-card">
      <h3>${t('profile.notifications.title')}</h3>
      <p style="color:var(--text-dim);font-size:.9rem;margin-bottom:16px">${t('profile.notifications.explain')}</p>

      <div style="display:flex;align-items:center;gap:12px;padding:16px;border-radius:8px;background:var(--glass-bg,#FFFFFF);border:1px solid var(--glass-border,#E5E7EB)">
        <div style="flex:1">
          <div style="font-weight:600;margin-bottom:4px">
            ${t('profile.notifications.browserPush')}
          </div>
          <div style="font-size:.85rem;color:var(--text-dim)">
            ${subscribed
              ? t('profile.notifications.statusActive')
              : t('profile.notifications.statusInactive')}
          </div>
        </div>

        ${subscribed ? html`
          <div style="display:flex;gap:8px">
            <button class="btn btn-sm" onClick=${handleTestPush}>
              ${t('profile.notifications.testBtn')}
            </button>
            <button class="btn btn-sm btn-outline" onClick=${handleUnsubscribe}
              disabled=${subStatus === 'unsubscribing'}>
              ${subStatus === 'unsubscribing'
                ? t('profile.notifications.unsubscribing')
                : t('profile.notifications.unsubscribeBtn')}
            </button>
          </div>
        ` : html`
          <button class="btn btn-primary" onClick=${handleSubscribe}
            disabled=${subStatus === 'subscribing'}>
            ${subStatus === 'subscribing'
              ? t('profile.notifications.subscribing')
              : t('profile.notifications.subscribeBtn')}
          </button>
        `}
      </div>

      <p style="font-size:.8rem;color:var(--text-dim);margin-top:12px">
        ${t('profile.notifications.hint')}
      </p>
    </div>
  `;
}
