/**
 * @file notifications-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab for push notification and email notification preferences.
 * @version-history
 *   v1.0.0 — 2026-03-17 — Refactor: replace inline styles with CSS classes; use ToggleSwitch and GlassCard from shared.js
 *   v1.1.0 — 2026-07-02 — Distinguish a browser-level permission denial from generic subscribe
 *     failures so the user knows to unblock notifications in browser settings.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Spinner, ToggleSwitch, GlassCard } from './shared.js';
import { apiGet, apiPost, apiDelete } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { getNodeId } from '/js/services/auth.js';

export default function NotificationsTab({ session, showToast }) {
  const [loading, setLoading] = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [subStatus, setSubStatus] = useState(null); // null | 'subscribing' | 'unsubscribing'
  const [vapidKey, setVapidKey] = useState(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [emailPrefs, setEmailPrefs] = useState({ enabled: false, extensions: true, system: true, security: true });
  const [, setSavingEmail] = useState(false);

  // Defined before the effects below so their dependency arrays can reference it
  // (a useCallback const is not hoisted). Re-created only when `session` changes.
  const checkSubscription = useCallback(async ({ showSpinner = true } = {}) => {
    if (showSpinner) setLoading(true);
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
    } catch (err) { swallowed('notifications-tab: NotificationsTab', err); }
    // Check email verification status
    try {
      const ghii = session.ghii || `${session.owner}@${getNodeId()}`;
      const ghiiRes = await apiGet(`/v1/ghii/${encodeURIComponent(ghii)}`);
      if (ghiiRes.data?.verification_level >= 1) {
        setEmailVerified(true);
      }
      // Load email notification preferences from memory
      const prefsRes = await apiGet('/v1/memory/settings.email_notifications');
      if (prefsRes.data?.value) {
        setEmailPrefs(prefsRes.data.value);
      }
    } catch (err) { swallowed('notifications-tab: NotificationsTab', err); }
    setLoading(false);
  }, [session]);

  useEffect(() => {
    if (session) checkSubscription();
  }, [session, checkSubscription]);

  // Re-check email verification when other tabs update data (e.g. email confirmed)
  useEffect(() => {
    const handler = () => { if (session) checkSubscription({ showSpinner: false }); }; // silent
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [session, checkSubscription]);

  async function handleSubscribe() {
    setSubStatus('subscribing');
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        showToast(t('profile.notifications.noBrowserSupport'), true);
        setSubStatus(null);
        return;
      }
      if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
        showToast(t('profile.notifications.permissionDenied'), true);
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
      const denied = typeof Notification !== 'undefined' && Notification.permission === 'denied';
      showToast(t(denied ? 'profile.notifications.permissionDenied' : 'profile.notifications.subscribeFailed'), true);
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
    } catch (err) {
      swallowed('notifications-tab: handleUnsubscribe', err);
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
    } catch (err) {
      swallowed('notifications-tab: handleTestPush', err);
      showToast(t('profile.notifications.testFailed'), true);
    }
  }

  if (loading) return html`<div><${Spinner} /></div>`;

  async function handleSaveEmailPrefs(newPrefs) {
    setSavingEmail(true);
    try {
      await apiPost('/v1/memory', {
        key: 'settings.email_notifications',
        value: newPrefs,
        visibility: 'private',
        tags: ['settings'],
      });
      setEmailPrefs(newPrefs);
      showToast(t('profile.notifications.emailPrefsSaved'));
    } catch (err) {
      swallowed('notifications-tab: handleSaveEmailPrefs', err);
      showToast(t('profile.notifications.emailPrefsFailed'), true);
    }
    setSavingEmail(false);
  }

  function renderEmailNotifications() {
    if (!emailVerified) {
      return html`
        <${GlassCard}>
          <div class="pf-notif-disabled">
            <div class="pf-notif-heading">${t('profile.notifications.emailNotifications')}</div>
            <p class="text-caption">${t('profile.notifications.emailNotVerified')}</p>
          </div>
        </${GlassCard}>
      `;
    }

    return html`
      <${GlassCard}>
        <div class="flex-between mb-1">
          <div class="pf-notif-text">
            <div class="pf-notif-heading">${t('profile.notifications.emailNotifications')}</div>
            <div class="text-caption">${t('profile.notifications.enableEmailNotifs')}</div>
          </div>
          <${ToggleSwitch} checked=${emailPrefs.enabled}
            onChange=${e => handleSaveEmailPrefs({ ...emailPrefs, enabled: e.target.checked })} />
        </div>

        ${emailPrefs.enabled ? html`
          <div class="pf-notif-options">
            <label class="pf-notif-option">
              <input type="checkbox" checked=${emailPrefs.extensions}
                onChange=${e => handleSaveEmailPrefs({ ...emailPrefs, extensions: e.target.checked })} />
              ${t('profile.notifications.notifTypeExtensions')}
            </label>
            <label class="pf-notif-option">
              <input type="checkbox" checked=${emailPrefs.system}
                onChange=${e => handleSaveEmailPrefs({ ...emailPrefs, system: e.target.checked })} />
              ${t('profile.notifications.notifTypeSystem')}
            </label>
            <label class="pf-notif-option">
              <input type="checkbox" checked=${emailPrefs.security}
                onChange=${e => handleSaveEmailPrefs({ ...emailPrefs, security: e.target.checked })} />
              ${t('profile.notifications.notifTypeSecurity')}
            </label>
          </div>
        ` : null}
      </${GlassCard}>
    `;
  }

  function renderPushButtons() {
    if (subscribed) {
      return html`
        <div class="flex-row">
          <button class="btn-primary" onClick=${handleTestPush}>
            ${t('profile.notifications.testBtn')}
          </button>
          <button class="btn-outline" onClick=${handleUnsubscribe}
            disabled=${subStatus === 'unsubscribing'}>
            ${subStatus === 'unsubscribing'
              ? t('profile.notifications.unsubscribing')
              : t('profile.notifications.unsubscribeBtn')}
          </button>
        </div>`;
    }
    return html`
      <button class="btn-primary" onClick=${handleSubscribe}
        disabled=${subStatus === 'subscribing'}>
        ${subStatus === 'subscribing'
          ? t('profile.notifications.subscribing')
          : t('profile.notifications.subscribeBtn')}
      </button>`;
  }

  if (!vapidKey) {
    return html`<div>
      <div class="section-title">${t('profile.notifications.title')}</div>
      <div class="section-desc">${t('profile.notifications.explain')}</div>

      <p class="text-caption">${t('profile.notifications.notConfigured')}</p>

      <div class="section-title mt-section">${t('profile.notifications.emailNotifications')}</div>
      ${renderEmailNotifications()}
    </div>`;
  }

  return html`<div>
    <div class="section-title">${t('profile.notifications.title')}</div>
    <div class="section-desc">${t('profile.notifications.explain')}</div>

    <${GlassCard}>
      <div class="flex-between">
        <div class="pf-notif-text">
          <div class="pf-notif-heading">${t('profile.notifications.browserPush')}</div>
          <div class="text-caption">${subscribed
            ? t('profile.notifications.statusActive')
            : t('profile.notifications.statusInactive')}</div>
        </div>
        ${renderPushButtons()}
      </div>
    </${GlassCard}>

    <p class="text-meta mt-xs">${t('profile.notifications.hint')}</p>

    <div class="section-title mt-section">${t('profile.notifications.emailNotifications')}</div>
    ${renderEmailNotifications()}
  </div>`;
}
