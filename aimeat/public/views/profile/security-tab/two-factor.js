/**
 * @file two-factor.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two-step sign-in section of the profile Security tab: arm TOTP (QR code plus the
 *   codes to write down), confirm it with a code from the app, replace the backup codes, and turn it
 *   off again. The four routes under /v1/ghii/totp have been live since July 2026 with nothing in the
 *   SPA reaching them, so nobody could arm a second factor — and arming one over the API alone locked
 *   the person out of this web interface, which had no code step at sign-in.
 *
 *   ONE SCREEN FOR THE SECRET. The secret, the QR image and the backup codes exist in a single
 *   response and the server keeps no readable copy, so the setup card shows all three at once and
 *   says so, rather than walking the person past them a step at a time.
 *
 * @structure TwoFactorSection({ twoFactor, managed, showToast, onChanged })
 *   - idle: the state, and the control that fits it (set up / replace codes / turn off)
 *   - setup: QR + secret + backup codes + the confirm field, all on one card
 *   - the two code-gated actions (regenerate, disable) ask for the code inline
 * @usage html`<${TwoFactorSection} twoFactor=${ov.two_factor} managed=${!!managedBy} ... />`
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial. Closes the half-built TOTP feature: backend complete, no UI.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { useConfirm } from '/components/Modal.js';
import * as securityService from '/js/services/security.js';

/** A six-digit field's value, kept to digits so a pasted "123 456" still submits. */
function onlyDigits(value) {
  return (value || '').replace(/\D/g, '').slice(0, 6);
}

export function TwoFactorSection({ twoFactor, managed, showToast, onChanged }) {
  const { confirm, ConfirmUI } = useConfirm();
  // The one-time material from /setup. Held only until the person confirms, then dropped.
  const [setupData, setSetupData] = useState(null);
  const [confirmCode, setConfirmCode] = useState('');
  // Which code-gated action is open: 'disable' | 'regenerate' | null.
  const [action, setAction] = useState(null);
  const [actionCode, setActionCode] = useState('');
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [backupCodeInput, setBackupCodeInput] = useState('');
  // Freshly minted replacement codes, shown once after a regenerate.
  const [newCodes, setNewCodes] = useState(null);
  const [busy, setBusy] = useState(false);

  const tf = twoFactor || { available: false, enabled: false, pending: false, backup_codes_left: 0 };

  // The node can turn TOTP off entirely, and an organisation-managed account signs in through the
  // organisation's directory — neither one has a second factor to set here.
  if (!tf.available || managed) return null;

  function reset() {
    setSetupData(null); setConfirmCode(''); setAction(null);
    setActionCode(''); setBackupCodeInput(''); setUseBackupCode(false);
  }

  async function startSetup() {
    setBusy(true);
    try {
      const data = await securityService.totpSetup();
      setSetupData(data);
      setConfirmCode('');
    } catch (e) { showToast(e.message || t('profile.error'), true); }
    setBusy(false);
  }

  async function confirmSetup() {
    if (confirmCode.length !== 6) {
      showToast(t('profile.security.twoFactor.errCodeSix'), true);
      return;
    }
    setBusy(true);
    try {
      await securityService.totpVerify(confirmCode);
      reset();
      showToast(t('profile.security.twoFactor.armed'));
      onChanged();
    } catch (e) { showToast(e.message || t('profile.error'), true); }
    setBusy(false);
  }

  async function doRegenerate() {
    setBusy(true);
    try {
      const resp = await securityService.totpRegenerateBackupCodes(actionCode);
      setNewCodes(resp?.data?.backup_codes || []);
      setAction(null); setActionCode('');
      onChanged();
    } catch (e) { showToast(e.message || t('profile.error'), true); }
    setBusy(false);
  }

  function askDisable() {
    confirm(t('profile.security.twoFactor.disableConfirm'), async () => {
      setBusy(true);
      try {
        await securityService.totpDisable(
          useBackupCode ? { backupCode: backupCodeInput.trim() } : { code: actionCode },
        );
        reset();
        showToast(t('profile.security.twoFactor.disabled'));
        onChanged();
      } catch (e) { showToast(e.message || t('profile.error'), true); }
      setBusy(false);
    }, { danger: true });
  }

  // ── The setup card: everything the person must keep, on one screen ──
  if (setupData) {
    const codes = setupData.backup_codes || [];
    return html`
      <h3 class="card-h3 mt-section">${t('profile.security.twoFactor.title')}</h3>
      <div class="card">
        <p class="pf-bold mb-half">${t('profile.security.twoFactor.setupStep1')}</p>
        ${setupData.qr_data_url && html`
          <img class="pf-2fa-qr" src=${setupData.qr_data_url}
            alt=${t('profile.security.twoFactor.qrAlt')} width="200" height="200" />
        `}
        <p class="text-caption mb-half">${t('profile.security.twoFactor.manualEntry')}</p>
        <div class="flex-row mb-1">
          <code class="text-code pf-code-break">${setupData.totp_secret}</code>
          <${CopyButton} text=${setupData.totp_secret || ''} className="btn-ghost btn-sm" />
        </div>

        <p class="pf-bold mb-half">${t('profile.security.twoFactor.setupStep2')}</p>
        <p class="text-caption mb-half">${t('profile.security.twoFactor.backupCodesOnce')}</p>
        <div class="pf-2fa-codes mb-half">
          ${codes.map(c => html`<code class="text-code" key=${c}>${c}</code>`)}
        </div>
        <${CopyButton} text=${codes.join('\n')} className="btn-outline btn-sm"
          label=${t('profile.security.twoFactor.copyCodes')} />

        <p class="pf-bold mt-1 mb-half">${t('profile.security.twoFactor.setupStep3')}</p>
        <div class="flex-row">
          <input class="input-field text-code pf-2fa-code-input" inputmode="numeric" maxlength="6"
            autocomplete="one-time-code" placeholder="123456" value=${confirmCode}
            onInput=${e => setConfirmCode(onlyDigits(e.target.value))}
            onKeyDown=${e => { if (e.key === 'Enter' && !busy) confirmSetup(); }} />
          <button class="btn-primary" disabled=${busy} onClick=${confirmSetup}>
            ${busy ? t('profile.security.twoFactor.working') : t('profile.security.twoFactor.turnOn')}
          </button>
          <button class="btn-ghost" disabled=${busy} onClick=${reset}>${t('profile.cancel')}</button>
        </div>
        <p class="text-caption mt-xs">${t('profile.security.twoFactor.notOnYet')}</p>
      </div>
    `;
  }

  // ── The resting state ──
  return html`
    <h3 class="card-h3 mt-section">${t('profile.security.twoFactor.title')}</h3>
    <p class="text-caption mb-1">${t('profile.security.twoFactor.desc')}</p>
    <div class="card">
      <div class="flex-between mb-half">
        <span class="pf-bold">${t('profile.security.twoFactor.authenticatorApp')}</span>
        <span class="badge ${tf.enabled ? 'badge-success' : 'badge-muted'}">
          ${tf.enabled ? t('profile.security.twoFactor.on') : t('profile.security.twoFactor.off')}
        </span>
      </div>

      ${!tf.enabled && html`
        <p class="text-caption mb-half">
          ${tf.pending
            ? t('profile.security.twoFactor.unfinished')
            : t('profile.security.twoFactor.offDesc')}
        </p>
        <button class="btn-primary" disabled=${busy} onClick=${startSetup}>
          ${busy ? t('profile.security.twoFactor.working') : t('profile.security.twoFactor.setUp')}
        </button>
      `}

      ${tf.enabled && html`
        <p class="text-caption mb-half">
          ${t('profile.security.twoFactor.codesLeft').replace('{n}', String(tf.backup_codes_left))}
        </p>
        ${tf.backup_codes_left === 0 && html`
          <p class="text-caption pf-bold mb-half">${t('profile.security.twoFactor.noCodesLeft')}</p>
        `}

        ${newCodes && html`
          <div class="pf-2fa-codes mb-half">
            ${newCodes.map(c => html`<code class="text-code" key=${c}>${c}</code>`)}
          </div>
          <div class="flex-row mb-1">
            <${CopyButton} text=${newCodes.join('\n')} className="btn-outline btn-sm"
              label=${t('profile.security.twoFactor.copyCodes')} />
            <button class="btn-ghost btn-sm" onClick=${() => setNewCodes(null)}>
              ${t('profile.security.twoFactor.savedThem')}
            </button>
          </div>
          <p class="text-caption mb-1">${t('profile.security.twoFactor.backupCodesOnce')}</p>
        `}

        ${action === null && html`
          <div class="flex-row">
            <button class="btn-outline" onClick=${() => { setAction('regenerate'); setActionCode(''); setNewCodes(null); }}>
              ${t('profile.security.twoFactor.newCodes')}
            </button>
            <button class="btn-danger-solid" onClick=${() => { setAction('disable'); setActionCode(''); setBackupCodeInput(''); setUseBackupCode(false); }}>
              ${t('profile.security.twoFactor.turnOff')}
            </button>
          </div>
        `}

        ${action === 'regenerate' && html`
          <p class="text-caption mb-half">${t('profile.security.twoFactor.newCodesAsk')}</p>
          <div class="flex-row">
            <input class="input-field text-code pf-2fa-code-input" inputmode="numeric" maxlength="6"
              autocomplete="one-time-code" placeholder="123456" value=${actionCode}
              onInput=${e => setActionCode(onlyDigits(e.target.value))}
              onKeyDown=${e => { if (e.key === 'Enter' && !busy && actionCode.length === 6) doRegenerate(); }} />
            <button class="btn-primary" disabled=${busy || actionCode.length !== 6} onClick=${doRegenerate}>
              ${busy ? t('profile.security.twoFactor.working') : t('profile.security.twoFactor.newCodes')}
            </button>
            <button class="btn-ghost" onClick=${() => setAction(null)}>${t('profile.cancel')}</button>
          </div>
        `}

        ${action === 'disable' && html`
          <p class="text-caption mb-half">${t('profile.security.twoFactor.turnOffAsk')}</p>
          ${useBackupCode
            ? html`<input class="input-field text-code pf-2fa-code-input" maxlength="16"
                placeholder=${t('profile.security.twoFactor.backupCodePlaceholder')} value=${backupCodeInput}
                onInput=${e => setBackupCodeInput(e.target.value)} />`
            : html`<input class="input-field text-code pf-2fa-code-input" inputmode="numeric" maxlength="6"
                autocomplete="one-time-code" placeholder="123456" value=${actionCode}
                onInput=${e => setActionCode(onlyDigits(e.target.value))} />`}
          <div class="flex-row mt-xs">
            <button class="btn-danger-solid" disabled=${busy || (useBackupCode ? !backupCodeInput.trim() : actionCode.length !== 6)}
              onClick=${askDisable}>
              ${busy ? t('profile.security.twoFactor.working') : t('profile.security.twoFactor.turnOff')}
            </button>
            <button class="btn-ghost" onClick=${() => { setUseBackupCode(!useBackupCode); setActionCode(''); setBackupCodeInput(''); }}>
              ${useBackupCode ? t('profile.security.twoFactor.useAppCode') : t('profile.security.twoFactor.useBackupCode')}
            </button>
            <button class="btn-ghost" onClick=${() => setAction(null)}>${t('profile.cancel')}</button>
          </div>
        `}
      `}
    </div>
    <${ConfirmUI} />
  `;
}
