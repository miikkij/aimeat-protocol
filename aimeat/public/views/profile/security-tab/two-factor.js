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
 *   2026-09-22 -- Composed from the shared component set (Surface, Field, Action, CopyAction, Chip,
 *     Text); no own classes. The backup codes sit in a code surface; the setup card is a box; the
 *     title and description the Access page hid are gone (its sign-in row names the panel). The QR
 *     image keeps a plain img: the set has no image part yet.
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   v1.0.0 — 2026-09-04 — Initial. Closes the half-built TOTP feature: backend complete, no UI.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { useConfirm } from '/components/Modal.js';
import { Stack, Surface, Text, Chip, Action, CopyAction, Field } from '/components/poster-parts.js';
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
    return html`<${Surface} kind="box"><${Stack}>
      <${Text}><strong>${t('profile.security.twoFactor.setupStep1')}</strong><//>
      ${setupData.qr_data_url && html`
        <img src=${setupData.qr_data_url} alt=${t('profile.security.twoFactor.qrAlt')} width="200" height="200" />
      `}
      <${Text} kind="caption" tone="muted">${t('profile.security.twoFactor.manualEntry')}<//>
      <${Stack} direction="wrap" density="compact" align="center">
        <${Text} kind="mono">${setupData.totp_secret}<//>
        <${CopyAction} kind="text" text=${setupData.totp_secret || ''} />
      <//>

      <${Text}><strong>${t('profile.security.twoFactor.setupStep2')}</strong><//>
      <${Text} kind="caption" tone="muted">${t('profile.security.twoFactor.backupCodesOnce')}<//>
      ${codeList(codes)}
      <${Stack} direction="horizontal" align="start">
        <${CopyAction} text=${codes.join('\n')} label=${t('profile.security.twoFactor.copyCodes')} />
      <//>

      <${Text}><strong>${t('profile.security.twoFactor.setupStep3')}</strong><//>
      <${Stack} direction="wrap" density="compact" align="end">
        ${sixDigits(confirmCode, e => setConfirmCode(onlyDigits(e.target.value)), e => { if (e.key === 'Enter' && !busy) confirmSetup(); })}
        <${Action} disabled=${busy} onClick=${confirmSetup}>
          ${busy ? t('profile.security.twoFactor.working') : t('profile.security.twoFactor.turnOn')}
        <//>
        <${Action} kind="text" disabled=${busy} onClick=${reset}>${t('profile.cancel')}<//>
      <//>
      <${Text} kind="caption" tone="muted">${t('profile.security.twoFactor.notOnYet')}<//>
    <//><//>`;
  }

  // ── The resting state ── (the Access page's sign-in row names the panel)
  return html`<${Stack}>
    <${Stack} direction="horizontal" align="between">
      <${Text}><strong>${t('profile.security.twoFactor.authenticatorApp')}</strong><//>
      <${Chip} tone=${tf.enabled ? 'success' : 'muted'}>${tf.enabled ? t('profile.security.twoFactor.on') : t('profile.security.twoFactor.off')}<//>
    <//>

    ${!tf.enabled && html`
      <${Text} kind="caption" tone="muted">${tf.pending ? t('profile.security.twoFactor.unfinished') : t('profile.security.twoFactor.offDesc')}<//>
      <${Stack} direction="horizontal" align="start">
        <${Action} disabled=${busy} onClick=${startSetup}>
          ${busy ? t('profile.security.twoFactor.working') : t('profile.security.twoFactor.setUp')}
        <//>
      <//>
    `}

    ${tf.enabled && html`
      <${Text} kind="caption" tone="muted">${t('profile.security.twoFactor.codesLeft').replace('{n}', String(tf.backup_codes_left))}<//>
      ${tf.backup_codes_left === 0 && html`<${Text} kind="caption" tone="coral"><strong>${t('profile.security.twoFactor.noCodesLeft')}</strong><//>`}

      ${newCodes && html`
        ${codeList(newCodes)}
        <${Stack} direction="wrap" density="compact">
          <${CopyAction} text=${newCodes.join('\n')} label=${t('profile.security.twoFactor.copyCodes')} />
          <${Action} kind="text" onClick=${() => setNewCodes(null)}>${t('profile.security.twoFactor.savedThem')}<//>
        <//>
        <${Text} kind="caption" tone="muted">${t('profile.security.twoFactor.backupCodesOnce')}<//>
      `}

      ${action === null && html`<${Stack} direction="wrap" density="compact">
        <${Action} onClick=${() => { setAction('regenerate'); setActionCode(''); setNewCodes(null); }}>${t('profile.security.twoFactor.newCodes')}<//>
        <${Action} tone="danger" onClick=${() => { setAction('disable'); setActionCode(''); setBackupCodeInput(''); setUseBackupCode(false); }}>${t('profile.security.twoFactor.turnOff')}<//>
      <//>`}

      ${action === 'regenerate' && html`
        <${Text} kind="caption" tone="muted">${t('profile.security.twoFactor.newCodesAsk')}<//>
        <${Stack} direction="wrap" density="compact" align="end">
          ${sixDigits(actionCode, e => setActionCode(onlyDigits(e.target.value)), e => { if (e.key === 'Enter' && !busy && actionCode.length === 6) doRegenerate(); })}
          <${Action} disabled=${busy || actionCode.length !== 6} onClick=${doRegenerate}>
            ${busy ? t('profile.security.twoFactor.working') : t('profile.security.twoFactor.newCodes')}
          <//>
          <${Action} kind="text" onClick=${() => setAction(null)}>${t('profile.cancel')}<//>
        <//>
      `}

      ${action === 'disable' && html`
        <${Text} kind="caption" tone="muted">${t('profile.security.twoFactor.turnOffAsk')}<//>
        ${useBackupCode
          ? html`<${Field} width="narrow" maxLength=${16} ariaLabel=${t('profile.security.twoFactor.backupCodePlaceholder')}
              placeholder=${t('profile.security.twoFactor.backupCodePlaceholder')} value=${backupCodeInput}
              onInput=${e => setBackupCodeInput(e.target.value)} />`
          : sixDigits(actionCode, e => setActionCode(onlyDigits(e.target.value)))}
        <${Stack} direction="wrap" density="compact">
          <${Action} tone="danger" disabled=${busy || (useBackupCode ? !backupCodeInput.trim() : actionCode.length !== 6)} onClick=${askDisable}>
            ${busy ? t('profile.security.twoFactor.working') : t('profile.security.twoFactor.turnOff')}
          <//>
          <${Action} kind="text" onClick=${() => { setUseBackupCode(!useBackupCode); setActionCode(''); setBackupCodeInput(''); }}>
            ${useBackupCode ? t('profile.security.twoFactor.useAppCode') : t('profile.security.twoFactor.useBackupCode')}
          <//>
          <${Action} kind="text" onClick=${() => setAction(null)}>${t('profile.cancel')}<//>
        <//>
      `}
    `}
    <${ConfirmUI} />
  <//>`;
}

/** The backup codes, one per line in a code surface, to copy or write down. */
function codeList(codes) {
  return html`<${Surface} kind="code"><${Stack} direction="wrap" density="compact">
    ${codes.map(c => html`<${Text} kind="mono" key=${c}>${c}<//>`)}
  <//><//>`;
}

/** The six-digit field every code step uses: numeric, the one-time-code autofill, narrow. */
function sixDigits(value, onInput, onKeyDown) {
  return html`<${Field} width="narrow" inputMode="numeric" maxLength=${6} autoComplete="one-time-code"
    ariaLabel=${t('profile.security.twoFactor.title')} placeholder="123456" value=${value} onInput=${onInput} onKeyDown=${onKeyDown} />`;
}
