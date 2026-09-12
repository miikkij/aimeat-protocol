/**
 * @file public/views/admin/sso-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Organisation sign-in page in the poster face (design canvas "AIMEAT
 *   Organisation Sign-in"): whether anybody at a connected company can actually sign in, and what
 *   is in the way when they cannot.
 *
 *   THE PAGE HAS TWO LIVES AND THE OLD ONE HAD DESIGN FOR NEITHER. Empty, it showed a grey sentence
 *   naming two protocols and a button, which is what aimeat.io has always looked like — the empty
 *   state IS the normal state here. Connected, it showed a table of ticks: SAML ✓, SCIM ✓, Listed.
 *   Five facts and no answer to the only question an operator has.
 *
 *   AND THE ANSWER USUALLY IS NOT ON THIS PAGE. A connection can be complete — company created,
 *   their identity provider read, a token minted, listed — and nobody can sign in, because
 *   `sso.enabled` is off and both public doors answer 503. That ordering is deliberate (a node is
 *   configured first and switched on second), which is exactly why a surface has to say which of
 *   the two phases it is in. The playbook showed five steps; the real sequence has six.
 *
 *   ONE READ. GET /v1/admin/sso/connections carries the connections AND the two node-wide switches
 *   now, so nothing here infers a state the server could have computed. → services/sso-overview.ts
 * @structure
 *   - AskAi (05) — the seven tools, and the paste
 *   - SsoTab (default) — the read, the empty/connected branch, and the per-company detail
 * @usage Mounted by the admin dashboard tab router (views/admin.js).
 * @version-history
 *   v2.0.0 — 2026-09-12 — The poster face. One read that says whether anybody can sign in, an
 *     empty state that leads with what the operator gets rather than with SAML and SCIM, a row per
 *     company saying what it can do right now, and the sixth step the playbook never had.
 *   v1.0.0 — 2026-08-24 — Initial (BR-04 phase 1, playbook per Jouni's 2026-08-23 requirement).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { Spinner, ErrorBox, useToast, Toast, Row } from './shared.js';
import { CopyButton } from '/components/CopyButton.js';
import { useConfirm } from '/components/Modal.js';
import { getNodeUrl } from '/js/services/auth.js';
import { getSsoConnections, createSsoConnection } from '/js/services/admin.js';
import { Nothing, RightNow } from './sso-tab.now.js';
import { BeforeYouStart, Organisations } from './sso-tab.list.js';
import { ConnectionDetail } from './sso-tab.detail.js';
import { buildSsoPrompt } from './sso-tab.prompt.js';

const S = (key, params) => t('admin.sso.' + key, params);

/**
 * Section 03: the tools, and the paste.
 *
 * It is 03 in both branches. The canvas numbered it 05 because its Main artboard folded a
 * company's own six steps and its troubleshooting into the list; those live in the detail view
 * here, so the list is three sections and numbering it otherwise counts sections that are not
 * on the page.
 */
function AskAi({ node, count }) {
  const paste = buildSsoPrompt({ url: getNodeUrl(), enabled: node.enabled, count });
  return html`
    <section class="og-sec" id="adm-sso-03">
      <div class="og-sec-h">
        <h2>${S('ai.title')}<small>03</small></h2>
        <div class="og-doors">
          <${CopyButton} text=${paste} label=${S('ai.copy')} className="og-door og-door--quiet" />
        </div>
      </div>
      <div class="adm-sso-ai">
        <div>
          <p class="adm-sso-lead">${S('ai.lead')}</p>
          ${Row({ title: S('ai.see'), why: S('ai.seeWhy'), chip: null, value: 'aimeat_admin_sso_list' })}
          ${Row({ title: S('ai.connect'), why: S('ai.connectWhy'), chip: null, value: 'aimeat_admin_sso_create' })}
          ${Row({ title: S('ai.metadata'), why: S('ai.metadataWhy'), chip: null, value: 'aimeat_admin_sso_idp_metadata' })}
          ${Row({ title: S('ai.token'), why: S('ai.tokenWhy'), chip: null, value: 'aimeat_admin_sso_scim_token', last: true })}
        </div>
        <div class="og-box">
          <span class="og-box-label">${S('ai.label')}</span>
          <div class="adm-sso-paste">${paste}</div>
        </div>
      </div>
    </section>`;
}

export default function SsoTab() {
  useViewCSS('/css/views/admin-sso.css');
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(null);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, showErr, , clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();

  // Deps: none. `showErr` is a new function every render and would turn this into a refetch loop.
  const load = useCallback(async () => {
    try {
      const r = await getSsoConnections();
      if (r.data) { setData(r.data); setFailed(null); }
    } catch (e) {
      console.warn('Failed to load SSO connections:', e.message);
      setFailed(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  // A connection is configuration, and so are both switches: one of them moving on the Config page
  // changes every verdict on this one.
  useEffect(() => onLiveUpdate(['config', 'features'], () => load()), [load]);

  /** The one write this page's list makes. Refused outright while the node is frozen. */
  const create = useCallback(async (body) => {
    setBusy(true);
    try {
      const r = await createSsoConnection(body);
      await load();
      setSelected(r.data?.connection?.id || body.id);
      return true;
    } catch (e) {
      // The toast IS the surfacing; `false` only tells the form to stay open so the operator can
      // fix what was refused. A frozen node lands here with SEALED_CONFIG, which the message names.
      console.warn('Creating an SSO connection was refused:', e.message);
      showErr(e.message);
      return false;
    } finally { setBusy(false); }
  }, [load, showErr]);

  const toSection = (n) => document.getElementById('adm-sso-' + n)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (failed && !data) return html`<${ErrorBox} message=${failed} />`;
  if (!data) return html`<${Spinner} text=${S('loading')} />`;

  const { node, connections } = data;

  if (selected) {
    return html`<div class="adm-sso">
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <${ConnectionDetail} id=${selected} node=${node} onBack=${() => setSelected(null)}
        onChanged=${load} showErr=${showErr} confirm=${confirm} />
      <${ConfirmUI} />
    </div>`;
  }

  // Nothing connected: the offer, what to gather, and the paste. No numbered rows and no strip of
  // zeros — there is nothing to report yet, and a row of noughts is what made the old page read as
  // a dead end rather than an invitation.
  if (connections.length === 0) {
    return html`<div class="adm-sso">
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <${Nothing} node=${node} onConnect=${() => toSection('02')} />
      <${BeforeYouStart} node=${node} onCreate=${create} busy=${busy} />
      <${AskAi} node=${node} count=${0} />
      <${ConfirmUI} />
    </div>`;
  }

  return html`<div class="adm-sso">
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <${RightNow} data=${data} onConnect=${() => toSection('02')} toSection=${toSection} />
    <${Organisations} data=${data} onOpen=${setSelected} onCreate=${create} busy=${busy} />
    <${AskAi} node=${node} count=${connections.length} />
    <${ConfirmUI} />
  </div>`;
}
