/**
 * @file passkeys.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The passkey section of the profile Security tab: the devices that can sign in as
 *   you, adding this one, renaming them and taking one away.
 *
 *   THE CEREMONY IS NOT HERE. Adding a device goes through /js/services/auth.js, the same code
 *   the sign-in modal uses for the other half of the flow, so the browser plumbing has one home
 *   (src/static/sdk-libs/auth/passkey.js) and the two surfaces cannot disagree about it.
 *
 *   A PASSKEY REPLACES NOTHING. Adding one does not remove the password and does not switch off
 *   two-step sign-in; it is another way in, and the section says so, because a person who thinks
 *   their password is gone will not understand what happened when they are asked for it.
 *
 * @structure PasskeysSection({ passkeysAvailable, showToast, onChanged })
 * @usage html`<${PasskeysSection} passkeysAvailable=${true} ... />`
 * @version-history
 *   2026-09-22 -- Composed from the shared component set (ListRow per device with the rename field
 *     as its open body, Field, Action, Text); no own classes. The title and description the Access
 *     page hid are gone: its sign-in row names the panel.
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   v1.0.0 — 2026-09-04 — Initial.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { useConfirm } from '/components/Modal.js';
import { Stack, ListRow, Toolbar, Action, Field, Text } from '/components/poster-parts.js';
import * as securityService from '/js/services/security.js';
import { passkeySupported, addPasskey } from '/js/services/auth.js';
import { swallowed } from '/js/swallowed.js';
import { date as fmtDate } from '/js/format.js';

/** What the device is, in the person's words rather than the protocol's. */
function whereItLives(p) {
  if (p.backed_up) return t('profile.security.passkeys.synced');
  if ((p.transports || []).includes('internal')) return t('profile.security.passkeys.thisDevice');
  return t('profile.security.passkeys.securityKey');
}

export function PasskeysSection({ showToast }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  const load = useCallback(async () => {
    try { setState(await securityService.listPasskeys()); }
    catch (err) { swallowed('passkeys: list', err); setState({ passkeys: [], count: 0, available: false }); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  // Nothing to show while the node's answer is still on its way, and nothing at all on a node that
  // has passkeys switched off or in a browser that cannot do them.
  if (!state) return null;
  const supported = passkeySupported();
  if (!state.available) return null;

  async function addThisDevice() {
    setBusy(true);
    try {
      await addPasskey(t('profile.security.passkeys.defaultLabel'));
      showToast(t('profile.security.passkeys.added'));
      await load();
    } catch (e) {
      // Closing the device prompt is the person changing their mind, not a failure.
      if (e?.code !== 'PASSKEY_CANCELLED') showToast(e.message || t('profile.error'), true);
    }
    setBusy(false);
  }

  async function saveName(id) {
    const label = renameValue.trim();
    if (!label) return;
    try {
      await securityService.renamePasskey(id, label);
      setRenaming(null);
      await load();
    } catch (e) { showToast(e.message || t('profile.error'), true); }
  }

  function removeDevice(p) {
    const last = state.count === 1;
    const question = last
      ? t('profile.security.passkeys.removeLastConfirm').replace('{name}', p.label)
      : t('profile.security.passkeys.removeConfirm').replace('{name}', p.label);
    confirm(question, async () => {
      try {
        await securityService.deletePasskey(p.id);
        showToast(t('profile.security.passkeys.removed'));
        await load();
      } catch (e) { showToast(e.message || t('profile.error'), true); }
    }, { danger: true });
  }

  // The Access page's sign-in row names this panel; the panel is the devices and the one action.
  return html`<${Stack}>
    ${state.count === 0
      ? html`<${Text} kind="caption" tone="muted">${t('profile.security.passkeys.none')}<//>`
      : html`<${Stack} density="compact">${state.passkeys.map(p => html`
        <${ListRow} key=${p.id} density="compact"
          name=${escHtml(p.label)}
          detail=${`${whereItLives(p)} · ${p.last_used_at
            ? t('profile.security.passkeys.lastUsed').replace('{when}', fmtDate(p.last_used_at))
            : t('profile.security.passkeys.neverUsed')}`} detailKind="text"
          actions=${renaming !== p.id ? html`
            <${Action} kind="text" onClick=${() => { setRenaming(p.id); setRenameValue(p.label); }}>${t('profile.security.passkeys.rename')}<//>
            <${Action} kind="text" tone="danger" onClick=${() => removeDevice(p)}>${t('profile.security.passkeys.remove')}<//>` : null}>
          ${renaming === p.id && html`<${Toolbar} label=${t('profile.security.passkeys.rename')} actions=${html`
            <${Action} onClick=${() => saveName(p.id)}>${t('profile.security.save')}<//>
            <${Action} kind="text" onClick=${() => setRenaming(null)}>${t('profile.cancel')}<//>`}>
            <${Field} ariaLabel=${t('profile.security.passkeys.rename')} maxLength=${80} value=${renameValue} autoFocus
              onInput=${e => setRenameValue(e.target.value)}
              onKeyDown=${e => { if (e.key === 'Enter') saveName(p.id); }} />
          <//>`}
        <//>
      `)}<//>`}

    ${supported
      ? html`<${Stack} density="compact">
          <${Stack} direction="horizontal" align="start">
            <${Action} disabled=${busy} onClick=${addThisDevice}>
              ${busy ? t('profile.security.twoFactor.working') : t('profile.security.passkeys.addThisDevice')}
            <//>
          <//>
          <${Text} kind="caption" tone="muted">${t('profile.security.passkeys.stillHavePassword')}<//>
        <//>`
      : html`<${Text} kind="caption" tone="muted">${t('profile.security.passkeys.unsupported')}<//>`}
    <${ConfirmUI} />
  <//>`;
}
