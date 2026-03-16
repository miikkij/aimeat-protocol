/**
 * @file email-tab.js
 * @description Profile tab for email verification and management.
 *   Allows users to verify their email address with a 6-digit code,
 *   view verification status, and change their email.
 * @version-history
 *   v1.0.0 — 2026-03-16 — Initial email verification tab
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Spinner } from './shared.js';
import { apiGet, apiPost } from '/js/api.js';

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
      const ghii = session.ghii || `${session.owner}@${window.AIMEAT?.auth?.nodeId || ''}`;
      const res = await apiGet(`/v1/ghii/${encodeURIComponent(ghii)}`);
      if (res.data) {
        setGhiiData(res.data);
        if (res.data.verification_level >= 1) {
          setStep('verified');
        }
      }
    } catch { /* ignore */ }
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
      showToast(t('profile.email.verifySuccess'));
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

  return html`
    <div class="pf-card">
      <h3>${t('profile.email.title')}</h3>
      <p style="color:var(--text-dim);font-size:.9rem;margin-bottom:16px">${t('profile.email.description')}</p>

      ${isVerified && !changing ? html`
        <div style="padding:16px;border-radius:8px;background:var(--glass-bg,#FFFFFF);border:1px solid var(--glass-border,#E5E7EB)">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <span style="color:#22C55E;font-size:20px">\u2713</span>
            <span style="font-weight:600;color:#22C55E">${t('profile.email.verified')}</span>
          </div>
          <div style="font-size:.9rem;color:var(--text-dim)">
            ${t('profile.email.verified')}
          </div>
          <button class="btn btn-sm btn-outline" style="margin-top:12px" onClick=${handleChangeEmail}>
            ${t('profile.email.changeEmail')}
          </button>
        </div>
      ` : step === 'codeSent' ? html`
        <div style="padding:16px;border-radius:8px;background:var(--glass-bg,#FFFFFF);border:1px solid var(--glass-border,#E5E7EB)">
          <p style="font-size:.9rem;color:#22C55E;margin-bottom:12px">${t('profile.email.codeSent')}</p>
          <div style="margin-bottom:14px">
            <label style="display:block;margin-bottom:5px;font-size:12px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:var(--text-dim)">${t('profile.email.enterCode')}</label>
            <input class="pf-input" type="text" maxlength="6" placeholder="123456"
              value=${code} onInput=${e => setCode(e.target.value)}
              style="font-size:1.5rem;letter-spacing:6px;text-align:center;max-width:200px" />
          </div>
          <button class="btn btn-primary" onClick=${handleVerifyCode} disabled=${verifying}>
            ${verifying ? '...' : t('profile.email.verify')}
          </button>
        </div>
      ` : html`
        <div style="padding:16px;border-radius:8px;background:var(--glass-bg,#FFFFFF);border:1px solid var(--glass-border,#E5E7EB)">
          ${!isVerified ? html`
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
              <span style="color:var(--text-dim);font-size:16px">\u2709</span>
              <span style="font-size:.9rem;color:var(--text-dim)">${t('profile.email.notVerified')}</span>
            </div>
          ` : null}
          <div style="margin-bottom:14px">
            <label style="display:block;margin-bottom:5px;font-size:12px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:var(--text-dim)">${t('profile.email.enterEmail')}</label>
            <input class="pf-input" type="email" placeholder="you@example.com"
              value=${email} onInput=${e => setEmail(e.target.value)} />
          </div>
          <button class="btn btn-primary" onClick=${handleSendCode} disabled=${sending}>
            ${sending ? '...' : t('profile.email.sendCode')}
          </button>
        </div>
      `}
    </div>
  `;
}
