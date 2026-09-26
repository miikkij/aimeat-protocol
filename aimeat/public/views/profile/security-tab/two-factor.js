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
 *   IN A ROW. The Access page shows this section inside its own sign-in row, which already names it:
 *   `inRow` leaves out the heading and the first line, and the card takes a row's air.
 *
 * @structure TwoFactorSection({ twoFactor, managed, showToast, onChanged, inRow })
 *   - idle: the state, and the control that fits it (set up / replace codes / turn off)
 *   - setup: QR + secret + backup codes + the confirm field, all on one card
 *   - the two code-gated actions (regenerate, disable) ask for the code inline
 * @usage html`<${TwoFactorSection} twoFactor=${ov.two_factor} managed=${!!managedBy} ... />`
 * @version-history
 *   v1.12.0 -- 2026-09-26 -- Every part is a component that takes data (Card section, Mark status,
 *     Note, Action/Loud with copy, TextField, SubHeading, Layout, and two new ones: QrCode and
 *     CodeGrid); the section writes no class. `inRow` replaces the Access page's CSS that hid the
 *     heading and the first line. Put back from main: the code fields in the code face.
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
import { useConfirm } from '/components/Modal.js';
import * as securityService from '/js/services/security.js';
import { Card } from '/components/Card.js';
import { Note } from '/components/Note.js';
import { Mark, Code } from '/components/Mark.js';
import { Action, Loud } from '/components/Action.js';
import { TextField } from '/components/TextField.js';
import { SubHeading } from '/components/SubHeading.js';
import { Row as Line, Space } from '/components/Layout.js';
import { QrCode } from '/components/QrCode.js';
import { CodeGrid } from '/components/CodeGrid.js';

/** A six-digit field's value, kept to digits so a pasted "123 456" still submits. */
function onlyDigits(value) {
  return (value || '').replace(/\D/g, '').slice(0, 6);
}

export function TwoFactorSection({ twoFactor, managed, showToast, onChanged, inRow }) {
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

  // The section's heading, unless it stands inside a row that already names it (the Access page).
  const heading = inRow ? null : html`
    <${Space} above="section"><${SubHeading} level=${3}>${t('profile.security.twoFactor.title')}<//><//>`;
  // A six-digit code from the app: the code face, short, the phone's number pad.
  const appCode = (value, setValue, onEnter) => html`<${TextField} code size="short" inputMode="numeric" maxLength=${6}
    autoComplete="one-time-code" placeholder="123456"
    value=${value} onInput=${(v) => setValue(onlyDigits(v))} onEnter=${onEnter} />`;
  const working = t('profile.security.twoFactor.working');

  // ── The setup card: everything the person must keep, on one screen ──
  if (setupData) {
    const codes = setupData.backup_codes || [];
    return html`
      ${heading}
      <${Card} tone="section" inRow=${inRow}>
        <${Space} below="small"><b>${t('profile.security.twoFactor.setupStep1')}</b><//>
        <${QrCode} src=${setupData.qr_data_url} alt=${t('profile.security.twoFactor.qrAlt')} />
        <${Space} below="small"><${Note}>${t('profile.security.twoFactor.manualEntry')}<//><//>
        <${Line} below="large">
          <${Code}>${setupData.totp_secret}<//>
          <${Action} small copy=${setupData.totp_secret || ''}>${t('common.copy')}<//>
        <//>

        <${Space} below="small"><b>${t('profile.security.twoFactor.setupStep2')}</b><//>
        <${Space} below="small"><${Note}>${t('profile.security.twoFactor.backupCodesOnce')}<//><//>
        <${CodeGrid} codes=${codes} />
        <${Action} small copy=${codes.join('\n')}>${t('profile.security.twoFactor.copyCodes')}<//>

        <${Space} above="large" below="small"><b>${t('profile.security.twoFactor.setupStep3')}</b><//>
        <${Line}>
          ${appCode(confirmCode, setConfirmCode, () => { if (!busy) confirmSetup(); })}
          <${Loud} control disabled=${busy} onClick=${confirmSetup}>
            ${busy ? working : t('profile.security.twoFactor.turnOn')}
          <//>
          <${Action} small disabled=${busy} onClick=${reset}>${t('profile.cancel')}<//>
        <//>
        <${Space} above="tight"><${Note}>${t('profile.security.twoFactor.notOnYet')}<//><//>
      <//>
    `;
  }

  // ── The resting state ──
  return html`
    ${heading}
    ${inRow ? null : html`<${Space} below="large"><${Note}>${t('profile.security.twoFactor.desc')}<//><//>`}
    <${Card} tone="section" inRow=${inRow} title=${t('profile.security.twoFactor.authenticatorApp')}
      aside=${html`<${Mark} kind="status" tone=${tf.enabled ? 'fine' : 'off'}>
        ${tf.enabled ? t('profile.security.twoFactor.on') : t('profile.security.twoFactor.off')}
      <//>`}>

      ${!tf.enabled && html`
        <${Space} below="small"><${Note}>
          ${tf.pending
            ? t('profile.security.twoFactor.unfinished')
            : t('profile.security.twoFactor.offDesc')}
        <//><//>
        <${Loud} control disabled=${busy} onClick=${startSetup}>
          ${busy ? working : t('profile.security.twoFactor.setUp')}
        <//>
      `}

      ${tf.enabled && html`
        <${Space} below="small"><${Note}>
          ${t('profile.security.twoFactor.codesLeft').replace('{n}', String(tf.backup_codes_left))}
        <//><//>
        ${tf.backup_codes_left === 0 && html`
          <${Space} below="small"><${Note}><b>${t('profile.security.twoFactor.noCodesLeft')}</b><//><//>
        `}

        ${newCodes && html`
          <${CodeGrid} codes=${newCodes} />
          <${Line} below="large">
            <${Action} small copy=${newCodes.join('\n')}>${t('profile.security.twoFactor.copyCodes')}<//>
            <${Action} small onClick=${() => setNewCodes(null)}>
              ${t('profile.security.twoFactor.savedThem')}
            <//>
          <//>
          <${Space} below="large"><${Note}>${t('profile.security.twoFactor.backupCodesOnce')}<//><//>
        `}

        ${action === null && html`
          <${Line}>
            <${Action} small onClick=${() => { setAction('regenerate'); setActionCode(''); setNewCodes(null); }}>
              ${t('profile.security.twoFactor.newCodes')}
            <//>
            <${Action} small tone="danger" onClick=${() => { setAction('disable'); setActionCode(''); setBackupCodeInput(''); setUseBackupCode(false); }}>
              ${t('profile.security.twoFactor.turnOff')}
            <//>
          <//>
        `}

        ${action === 'regenerate' && html`
          <${Space} below="small"><${Note}>${t('profile.security.twoFactor.newCodesAsk')}<//><//>
          <${Line}>
            ${appCode(actionCode, setActionCode, () => { if (!busy && actionCode.length === 6) doRegenerate(); })}
            <${Loud} control disabled=${busy || actionCode.length !== 6} onClick=${doRegenerate}>
              ${busy ? working : t('profile.security.twoFactor.newCodes')}
            <//>
            <${Action} small onClick=${() => setAction(null)}>${t('profile.cancel')}<//>
          <//>
        `}

        ${action === 'disable' && html`
          <${Space} below="small"><${Note}>${t('profile.security.twoFactor.turnOffAsk')}<//><//>
          ${useBackupCode
            ? html`<${TextField} code size="short" maxLength=${16}
                placeholder=${t('profile.security.twoFactor.backupCodePlaceholder')} value=${backupCodeInput}
                onInput=${setBackupCodeInput} />`
            : appCode(actionCode, setActionCode)}
          <${Line} above="tight">
            <${Loud} control danger disabled=${busy || (useBackupCode ? !backupCodeInput.trim() : actionCode.length !== 6)}
              onClick=${askDisable}>
              ${busy ? working : t('profile.security.twoFactor.turnOff')}
            <//>
            <${Action} small onClick=${() => { setUseBackupCode(!useBackupCode); setActionCode(''); setBackupCodeInput(''); }}>
              ${useBackupCode ? t('profile.security.twoFactor.useAppCode') : t('profile.security.twoFactor.useBackupCode')}
            <//>
            <${Action} small onClick=${() => setAction(null)}>${t('profile.cancel')}<//>
          <//>
        `}
      `}
    <//>
    <${ConfirmUI} />
  `;
}
