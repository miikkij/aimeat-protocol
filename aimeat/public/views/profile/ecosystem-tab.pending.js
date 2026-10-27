/**
 * @file public/views/profile/ecosystem-tab.pending.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a waiting outside-app request asks for, on its row in Profile > Outside apps:
 *   the data areas the app asked for, each with a tick the owner keeps or takes off, and the markers
 *   the server returns for a request that reconnects an app already connected (`reconnect`) or that
 *   carries another key than the connection has (`key_changed`, with both fingerprints).
 *
 *   WHY (secaudit2026oct22, leads 2378 and 2415, the portal part). The approve route grants the app's
 *   own list of data areas when the body names none, and the row neither showed that list nor sent
 *   one, so an owner who picked "Read only" for an app could grant it every shared space they belong
 *   to without seeing it. The row also looked the same for a new app and for a key replacement of a
 *   working connection. Now the row shows both, and the approval sends `data_areas` from the ticks
 *   (ecosystem-tab.helpers.js chosenAreas).
 * @structure EcoPendingAccess({ request, ticks, onTick })
 * @usage html`<${EcoPendingAccess} request=${r} ticks=${ticks[r.user_code]} onTick=${(i, on) => ...} />`
 * @version-history
 *   v1.1.0 — 2026-10-27 — A same-key reconnect that did not prove it holds the pinned key
 *     (`key_proven` false) is marked with the danger tone and a hint (secaudit2026oct26,
 *     token-pickup-without-pinned-key-proof). A question mark beside the mark explains it
 *     (explain.ecosystem.reconnectUnproven; Jouni, 2026-10-27).
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22).
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Check } from '/components/Check.js';
import { Mark, Code } from '/components/Mark.js';
import { Hint } from '/components/Hint.js';
import { HelpTip } from '/components/HelpTip.js';
import { Stack } from '/components/Layout.js';
import { areaSentence, initialTicks } from './ecosystem-tab.helpers.js';

const html = htm.bind(h);

/**
 * The data areas with their ticks, and the reconnect and key-change markers.
 * @param {{ request: any, ticks?: boolean[], onTick: (index: number, on: boolean) => void }} props
 */
export function EcoPendingAccess({ request, ticks, onTick }) {
  const areas = request?.requested_data_areas || [];
  const on = Array.isArray(ticks) ? ticks : initialTicks(request);
  // A same-key reconnect that did not sign with the pinned key (key_proven false) is marked like a
  // key change, since anyone who knows the public key can send it.
  const unproven = request.reconnect && !request.key_changed && request.key_proven === false;
  const label = request.key_changed ? 'profile.ecosystem.keyChanged'
    : unproven ? 'profile.ecosystem.reconnectUnproven' : 'profile.ecosystem.reconnect';
  return html`
    <${Stack} gap="small">
      ${request.reconnect && html`
        <span>
          <${Mark} kind="status" tone=${request.key_changed || unproven ? 'danger' : 'attention'}>
            ${t(label)}
          <//>
          ${unproven && html` <${HelpTip} term="ecosystem.reconnectUnproven" label=${t(label)} />`}
        </span>`}
      ${unproven && html`<${Hint}>${t('profile.ecosystem.reconnectUnprovenHint', { app: request.display_name || request.app })}<//>`}
      ${request.key_changed && html`
        <${Hint}>
          ${t('profile.ecosystem.keyChangedHint', { app: request.display_name || request.app })}
          ${' '}<${Code}>${request.pinned_key_fingerprint}<//> → <${Code}>${request.key_fingerprint}<//>
        <//>`}
      ${areas.length > 0
        ? html`
          <div>
            <${Hint}>${t('profile.ecosystem.areasTitle')}<//>
            ${areas.map((a, i) => html`
              <${Check} key=${`${a.area}:${a.pattern}:${i}`} checked=${on[i] !== false} onChange=${(v) => onTick(i, v)}>
                ${areaSentence(a, t)}
              <//>`)}
          </div>`
        : html`<${Hint}>${t('profile.ecosystem.areasNone')}<//>`}
    <//>`;
}
