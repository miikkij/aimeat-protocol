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
 *   v1.11.0 -- 2026-09-26 -- A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.10.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.9.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.8.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.7.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.6.0 -- 2026-09-25 -- Code inside a sentence or a value line is the code-inline cut of the Code block (UI consolidation phase 5, a unification).
 *   v1.5.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.4.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.3.0 — 2026-09-25 — A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.2.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.1.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
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
      <h3 class="card-h3 sub-heading mt-section">${t('profile.security.twoFactor.title')}</h3>
      <div class="card poster-row--thing">
        <p class="pf-bold mb-half">${t('profile.security.twoFactor.setupStep1')}</p>
        ${setupData.qr_data_url && html`
          <img class="pf-2fa-qr" src=${setupData.qr_data_url}
            alt=${t('profile.security.twoFactor.qrAlt')} width="200" height="200" />
        `}
        <p class="poster-hint mb-half">${t('profile.security.twoFactor.manualEntry')}</p>
        <div class="flex-row mb-1">
          <code class="code-inline pf-code-break">${setupData.totp_secret}</code>
          <${CopyButton} text=${setupData.totp_secret || ''} className="poster-action poster-action--small" />
        </div>

        <p class="pf-bold mb-half">${t('profile.security.twoFactor.setupStep2')}</p>
        <p class="poster-hint mb-half">${t('profile.security.twoFactor.backupCodesOnce')}</p>
        <div class="pf-2fa-codes poster-box poster-box--copy mb-half">
          ${codes.map(c => html`<code class="code-inline" key=${c}>${c}</code>`)}
        </div>
        <${CopyButton} text=${codes.join('\n')} className="poster-action poster-action--small"
          label=${t('profile.security.twoFactor.copyCodes')} />

        <p class="pf-bold mt-1 mb-half">${t('profile.security.twoFactor.setupStep3')}</p>
        <div class="flex-row">
          <input class="og-input pf-2fa-code-input" inputmode="numeric" maxlength="6"
            autocomplete="one-time-code" placeholder="123456" value=${confirmCode}
            onInput=${e => setConfirmCode(onlyDigits(e.target.value))}
            onKeyDown=${e => { if (e.key === 'Enter' && !busy) confirmSetup(); }} />
          <button class="poster-slab poster-slab--control" disabled=${busy} onClick=${confirmSetup}>
            ${busy ? t('profile.security.twoFactor.working') : t('profile.security.twoFactor.turnOn')}
          </button>
          <button class="poster-action poster-action--small" disabled=${busy} onClick=${reset}>${t('profile.cancel')}</button>
        </div>
        <p class="poster-hint mt-xs">${t('profile.security.twoFactor.notOnYet')}</p>
      </div>
    `;
  }

  // ── The resting state ──
  return html`
    <h3 class="card-h3 sub-heading mt-section">${t('profile.security.twoFactor.title')}</h3>
    <p class="poster-hint mb-1">${t('profile.security.twoFactor.desc')}</p>
    <div class="card poster-row--thing">
      <div class="flex-between mb-half">
        <span class="sub-heading">${t('profile.security.twoFactor.authenticatorApp')}</span>
        <span class="poster-status ${tf.enabled ? 'poster-status--fine' : 'poster-status--off'}">
          ${tf.enabled ? t('profile.security.twoFactor.on') : t('profile.security.twoFactor.off')}
        </span>
      </div>

      ${!tf.enabled && html`
        <p class="poster-hint mb-half">
          ${tf.pending
            ? t('profile.security.twoFactor.unfinished')
            : t('profile.security.twoFactor.offDesc')}
        </p>
        <button class="poster-slab poster-slab--control" disabled=${busy} onClick=${startSetup}>
          ${busy ? t('profile.security.twoFactor.working') : t('profile.security.twoFactor.setUp')}
        </button>
      `}

      ${tf.enabled && html`
        <p class="poster-hint mb-half">
          ${t('profile.security.twoFactor.codesLeft').replace('{n}', String(tf.backup_codes_left))}
        </p>
        ${tf.backup_codes_left === 0 && html`
          <p class="poster-hint pf-bold mb-half">${t('profile.security.twoFactor.noCodesLeft')}</p>
        `}

        ${newCodes && html`
          <div class="pf-2fa-codes poster-box poster-box--copy mb-half">
            ${newCodes.map(c => html`<code class="code-inline" key=${c}>${c}</code>`)}
          </div>
          <div class="flex-row mb-1">
            <${CopyButton} text=${newCodes.join('\n')} className="poster-action poster-action--small"
              label=${t('profile.security.twoFactor.copyCodes')} />
            <button class="poster-action poster-action--small" onClick=${() => setNewCodes(null)}>
              ${t('profile.security.twoFactor.savedThem')}
            </button>
          </div>
          <p class="poster-hint mb-1">${t('profile.security.twoFactor.backupCodesOnce')}</p>
        `}

        ${action === null && html`
          <div class="flex-row">
            <button class="poster-action poster-action--small" onClick=${() => { setAction('regenerate'); setActionCode(''); setNewCodes(null); }}>
              ${t('profile.security.twoFactor.newCodes')}
            </button>
            <button class="poster-action poster-action--small poster-action--danger" onClick=${() => { setAction('disable'); setActionCode(''); setBackupCodeInput(''); setUseBackupCode(false); }}>
              ${t('profile.security.twoFactor.turnOff')}
            </button>
          </div>
        `}

        ${action === 'regenerate' && html`
          <p class="poster-hint mb-half">${t('profile.security.twoFactor.newCodesAsk')}</p>
          <div class="flex-row">
            <input class="og-input pf-2fa-code-input" inputmode="numeric" maxlength="6"
              autocomplete="one-time-code" placeholder="123456" value=${actionCode}
              onInput=${e => setActionCode(onlyDigits(e.target.value))}
              onKeyDown=${e => { if (e.key === 'Enter' && !busy && actionCode.length === 6) doRegenerate(); }} />
            <button class="poster-slab poster-slab--control" disabled=${busy || actionCode.length !== 6} onClick=${doRegenerate}>
              ${busy ? t('profile.security.twoFactor.working') : t('profile.security.twoFactor.newCodes')}
            </button>
            <button class="poster-action poster-action--small" onClick=${() => setAction(null)}>${t('profile.cancel')}</button>
          </div>
        `}

        ${action === 'disable' && html`
          <p class="poster-hint mb-half">${t('profile.security.twoFactor.turnOffAsk')}</p>
          ${useBackupCode
            ? html`<input class="og-input pf-2fa-code-input" maxlength="16"
                placeholder=${t('profile.security.twoFactor.backupCodePlaceholder')} value=${backupCodeInput}
                onInput=${e => setBackupCodeInput(e.target.value)} />`
            : html`<input class="og-input pf-2fa-code-input" inputmode="numeric" maxlength="6"
                autocomplete="one-time-code" placeholder="123456" value=${actionCode}
                onInput=${e => setActionCode(onlyDigits(e.target.value))} />`}
          <div class="flex-row mt-xs">
            <button class="poster-slab poster-slab--control poster-slab--danger" disabled=${busy || (useBackupCode ? !backupCodeInput.trim() : actionCode.length !== 6)}
              onClick=${askDisable}>
              ${busy ? t('profile.security.twoFactor.working') : t('profile.security.twoFactor.turnOff')}
            </button>
            <button class="poster-action poster-action--small" onClick=${() => { setUseBackupCode(!useBackupCode); setActionCode(''); setBackupCodeInput(''); }}>
              ${useBackupCode ? t('profile.security.twoFactor.useAppCode') : t('profile.security.twoFactor.useBackupCode')}
            </button>
            <button class="poster-action poster-action--small" onClick=${() => setAction(null)}>${t('profile.cancel')}</button>
          </div>
        `}
      `}
    </div>
    <${ConfirmUI} />
  `;
}
