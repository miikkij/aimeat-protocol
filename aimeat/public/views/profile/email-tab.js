/**
 * @file email-tab.js
 * @description Profile tab for email verification and management.
 *   Allows users to verify their email address with a 6-digit code,
 *   view verification status, and change their email.
 * @version-history
 *   v1.0.0 — 2026-03-16 — Initial email verification tab
 *   v1.1.0 — 2026-03-17 — Replace inline styles with CSS classes; use GlassCard/ToggleSwitch
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Spinner, GlassCard } from './shared.js';
import { apiPost } from '/js/api.js';
import { getProfile } from '/js/services/auth.js';
import { swallowed } from '/js/swallowed.js';

export default function EmailTab({ session, showToast }) {
  const [loading, setLoading] = useState(true);
  const [ghiiData, setGhiiData] = useState(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [verificationId, setVerificationId] = useState(null);
  const [step, setStep] = useState('idle'); // idle | codeSent | verified
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    if (session) loadData();
  }, [session]);

  async function loadData() {
    setLoading(true);
    try {
      const res = await getProfile();
      if (res && res.data) {
        setGhiiData(res.data);
        if (res.data.verification_level >= 1) {
          setStep('verified');
        }
      }
    } catch (err) { swallowed('email-tab: loadData', err); }
    setLoading(false);
  }

  async function handleSendCode() {
    if (!email.trim()) {
      showToast(t('profile.email.enterEmail'), true);
      return;
    }
    setSending(true);
    try {
      const res = await apiPost('/v1/ghii/email/verify', { email: email.trim() });
      if (res.ok === false || res.error) {
        showToast(res.error?.message || t('profile.email.sendFailed'), true);
        setSending(false);
        return;
      }
      setVerificationId(res.data?.verification_id || null);
      setStep('codeSent');
      showToast(t('profile.email.codeSent'));
    } catch (err) {
      showToast(err.message || t('profile.email.sendFailed'), true);
    }
    setSending(false);
  }

  async function handleVerifyCode() {
    if (!code.trim()) {
      showToast(t('profile.email.enterCode'), true);
      return;
    }
    setVerifying(true);
    try {
      const body = { code: code.trim() };
      if (verificationId) body.verification_id = verificationId;
      const res = await apiPost('/v1/ghii/email/confirm', body);
      if (res.ok === false || res.error) {
        showToast(res.error?.message || t('profile.email.verifyFailed'), true);
        setVerifying(false);
        return;
      }
      setStep('verified');
      setChanging(false);
      showToast(t('profile.email.verifySuccess'));
      // Notify other tabs (e.g. notifications-tab) that email status changed
      window.dispatchEvent(new CustomEvent('aimeat-live-update'));
      loadData();
    } catch (err) {
      showToast(err.message || t('profile.email.verifyFailed'), true);
    }
    setVerifying(false);
  }

  function handleChangeEmail() {
    setChanging(true);
    setStep('idle');
    setCode('');
    setVerificationId(null);
  }

  if (loading) return html`<${Spinner} />`;

  const isVerified = step === 'verified' || (ghiiData?.verification_level >= 1);

  return html`<div>
    <div class="section-title">${t('profile.email.title')}</div>
    <div class="section-desc">${t('profile.email.description')}</div>

    <div class="pf-card">
      ${isVerified && !changing ? html`
        <${GlassCard}>
          <div class="email-icon-row">
            <span class="email-verified-icon">\u2713</span>
            <span class="email-verified-text">${t('profile.email.verified')}</span>
          </div>
          ${ghiiData?.notification_email ? html`
            <div class="email-address-display">${ghiiData.notification_email}</div>
          ` : html`
            <div class="email-status-text">${t('profile.email.verified')}</div>
          `}
          <button class="btn-outline btn-sm email-change-btn" onClick=${handleChangeEmail}>
            ${t('profile.email.changeEmail')}
          </button>
        <//>
      ` : step === 'codeSent' ? html`
        <${GlassCard}>
          <p class="email-sent-text">${t('profile.email.codeSent')}</p>
          <div class="email-form-group">
            <label class="email-form-label">${t('profile.email.enterCode')}</label>
            <input class="input-field input-verification-code" type="text" maxlength="6" placeholder="123456"
              value=${code} onInput=${e => setCode(e.target.value)} />
          </div>
          <button class="btn-primary" onClick=${handleVerifyCode} disabled=${verifying}>
            ${verifying ? '...' : t('profile.email.verify')}
          </button>
        <//>
      ` : html`
        <${GlassCard}>
          ${!isVerified ? html`
            <div class="email-icon-row">
              <span class="email-unverified-icon">\u2709</span>
              <span class="email-unverified-text">${t('profile.email.notVerified')}</span>
            </div>
          ` : null}
          <div class="email-form-group">
            <label class="email-form-label">${t('profile.email.enterEmail')}</label>
            <input class="input-field" type="email" placeholder="you@example.com"
              value=${email} onInput=${e => setEmail(e.target.value)} />
          </div>
          <button class="btn-primary" onClick=${handleSendCode} disabled=${sending}>
            ${sending ? '...' : t('profile.email.sendCode')}
          </button>
        <//>
      `}
    </div>
  </div>`;
}
