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
 *   v1.0.0 — 2026-09-04 — Initial.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { useConfirm } from '/components/Modal.js';
import * as securityService from '/js/services/security.js';
import { passkeySupported, addPasskey } from '/js/services/auth.js';
import { swallowed } from '/js/swallowed.js';

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

  return html`
    <h3 class="card-h3 mt-section">${t('profile.security.passkeys.title')}</h3>
    <p class="text-caption mb-1">${t('profile.security.passkeys.desc')}</p>
    <div class="card">
      ${state.count === 0
        ? html`<p class="text-caption mb-half">${t('profile.security.passkeys.none')}</p>`
        : html`
          <div class="pf-2fa-devices mb-1">
            ${state.passkeys.map(p => html`
              <div class="pf-2fa-device" key=${p.id}>
                <div class="pf-flex-fill">
                  ${renaming === p.id
                    ? html`<div class="flex-row">
                        <input class="input-field" maxlength="80" value=${renameValue}
                          onInput=${e => setRenameValue(e.target.value)}
                          onKeyDown=${e => { if (e.key === 'Enter') saveName(p.id); }} />
                        <button class="btn-primary btn-sm" onClick=${() => saveName(p.id)}>${t('profile.security.save')}</button>
                        <button class="btn-ghost btn-sm" onClick=${() => setRenaming(null)}>${t('profile.cancel')}</button>
                      </div>`
                    : html`<span class="pf-bold">${escHtml(p.label)}</span>`}
                  <div class="text-caption">
                    ${whereItLives(p)}
                    ${' · '}
                    ${p.last_used_at
                      ? t('profile.security.passkeys.lastUsed').replace('{when}', new Date(p.last_used_at).toLocaleDateString())
                      : t('profile.security.passkeys.neverUsed')}
                  </div>
                </div>
                ${renaming !== p.id && html`
                  <div class="flex-row">
                    <button class="btn-ghost btn-sm" onClick=${() => { setRenaming(p.id); setRenameValue(p.label); }}>
                      ${t('profile.security.passkeys.rename')}
                    </button>
                    <button class="btn-danger-solid btn-sm" onClick=${() => removeDevice(p)}>
                      ${t('profile.security.passkeys.remove')}
                    </button>
                  </div>
                `}
              </div>
            `)}
          </div>
        `}

      ${supported
        ? html`
          <button class="btn-primary" disabled=${busy} onClick=${addThisDevice}>
            ${busy ? t('profile.security.twoFactor.working') : t('profile.security.passkeys.addThisDevice')}
          </button>
          <p class="text-caption mt-xs">${t('profile.security.passkeys.stillHavePassword')}</p>
        `
        : html`<p class="text-caption">${t('profile.security.passkeys.unsupported')}</p>`}
    </div>
    <${ConfirmUI} />
  `;
}
