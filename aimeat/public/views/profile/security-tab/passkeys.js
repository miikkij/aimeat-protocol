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
 *   v1.10.0 -- 2026-09-26 -- The line under a passkey's name is the Listing's typewriter line (.listing-meta), a unification: Jouni's decision "Meta line".
 *   v1.9.0 -- 2026-09-26 -- A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.8.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.7.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.6.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
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
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
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
import * as securityService from '/js/services/security.js';
import { passkeySupported, addPasskey } from '/js/services/auth.js';
import { swallowed } from '/js/swallowed.js';
import { date as fmtDate } from '/js/format.js';
import { Hint } from '/components/Hint.js';

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
    <h3 class="card-h3 sub-heading mt-section">${t('profile.security.passkeys.title')}</h3>
    <p class="poster-hint mb-1">${t('profile.security.passkeys.desc')}</p>
    <div class="card poster-row--thing">
      ${state.count === 0
        ? html`<p class="poster-quiet mb-half">${t('profile.security.passkeys.none')}</p>`
        : html`
          <div class="pf-2fa-devices mb-1">
            ${state.passkeys.map(p => html`
              <div class="pf-2fa-device poster-box" key=${p.id}>
                <div class="pf-flex-fill">
                  ${renaming === p.id
                    ? html`<div class="flex-row">
                        <input class="og-input" maxlength="80" value=${renameValue}
                          onInput=${e => setRenameValue(e.target.value)}
                          onKeyDown=${e => { if (e.key === 'Enter') saveName(p.id); }} />
                        <button class="poster-slab poster-slab--control" onClick=${() => saveName(p.id)}>${t('profile.security.save')}</button>
                        <button class="poster-action poster-action--small" onClick=${() => setRenaming(null)}>${t('profile.cancel')}</button>
                      </div>`
                    : html`<span class="pf-bold">${escHtml(p.label)}</span>`}
                  <div class="listing-meta">
                    ${whereItLives(p)}
                    ${' · '}
                    ${p.last_used_at
                      ? t('profile.security.passkeys.lastUsed').replace('{when}', fmtDate(p.last_used_at))
                      : t('profile.security.passkeys.neverUsed')}
                  </div>
                </div>
                ${renaming !== p.id && html`
                  <div class="flex-row">
                    <button class="poster-action poster-action--small" onClick=${() => { setRenaming(p.id); setRenameValue(p.label); }}>
                      ${t('profile.security.passkeys.rename')}
                    </button>
                    <button class="poster-action poster-action--small poster-action--danger" onClick=${() => removeDevice(p)}>
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
          <button class="poster-slab poster-slab--control" disabled=${busy} onClick=${addThisDevice}>
            ${busy ? t('profile.security.twoFactor.working') : t('profile.security.passkeys.addThisDevice')}
          </button>
          <p class="poster-hint mt-xs">${t('profile.security.passkeys.stillHavePassword')}</p>
        `
        : html`<${Hint}>${t('profile.security.passkeys.unsupported')}<//>`}
    </div>
    <${ConfirmUI} />
  `;
}
