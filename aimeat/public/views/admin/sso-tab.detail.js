/**
 * @file sso-tab.detail.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One company's own page: the six steps of setting it up, each showing what this node
 *   has actually SEEN rather than what it was told, plus the IdP walkthroughs, the troubleshooting
 *   table and the danger zone.
 *
 *   THE SIXTH STEP IS THE NEW ONE, and it is the reason this page was rebuilt. Steps one to five
 *   all happen here; the sixth is `sso.enabled` on the Config page, and until it is on, step five
 *   ("somebody has actually signed in") cannot complete no matter what an operator does. The old
 *   five-step playbook left a reader waiting for an event the node was refusing to let happen, and
 *   said so nowhere except one row of a troubleshooting table.
 *
 *   THE ORDER CHANGED TOO. Visibility used to be step five, after the test login; it is step three
 *   now, because whether a button exists decides what there is to test. What a step MEASURES is
 *   unchanged — the record's own fields, never a claim.
 *
 *   WHAT WAS KEPT, deliberately: the copy rows an IdP console asks for, the Entra and Okta
 *   walkthroughs, the once-only SCIM token, the troubleshooting table keyed by the codes the doors
 *   really emit, and the brief for the operator's own AI. None of that was the problem.
 * @structure
 *   - Step — one row: its number, what it wants, and its measured state
 *   - ConnectionDetail — the six steps, the walkthroughs, troubleshooting, the danger zone
 * @usage Imported by views/admin/sso-tab.js.
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial (the Organisation sign-in page in the poster face).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { Badge, ExpandableHelp, when } from './shared.js';
import { CopyButton } from '/components/CopyButton.js';
import { getSsoConnection, updateSsoConnection, deleteSsoConnection, mintSsoScimToken, setSsoIdpMetadata }
  from '/js/services/admin.js';

const S = (key, params) => t('admin.sso.' + key, params);

/** The codes the doors actually emit, so a screenshot from the far end matches a row. */
const TROUBLE = [
  ['FEATURE_DISABLED', 'featureDisabled'],
  ['SAML_INVALID_RESPONSE', 'invalidResponse'],
  ['SAML_START_FAILED', 'startFailed'],
  ['ACCOUNT_DISABLED', 'accountDisabled'],
  ['REGISTRATION_CLOSED', 'registrationClosed'],
  ['401 SCIM', 'scim401'],
  ['403 SCIM', 'scim403'],
  ['409 SCIM', 'scim409'],
];

/** One step: number, what it wants, and the state the record proves. */
function Step({ n, state, title, children, aside, last }) {
  const cls = state === 'done' ? 'done' : state === 'now' ? 'now' : '';
  return html`
    <div class="adm-sso-step ${last ? 'adm-sso-step--last' : ''}">
      <span class="adm-sso-step-n ${cls}">${n}</span>
      <span><b>${title}</b>${children}</span>
      <span class="adm-sso-step-r">${aside}</span>
    </div>`;
}

/** What an IdP console asks for, ready to paste. */
function CopyRow({ label, value }) {
  return html`
    <div class="adm-sso-copyrow">
      <span>${label}</span>
      <code class="adm-sso-code">${value}</code>
      <${CopyButton} text=${value} label=${S('detail.copy')} className="og-door og-door--up" />
    </div>`;
}

/** The brief an operator hands their own AI to be walked through the far end. */
function aiBrief(c) {
  return [
    S('detail.briefIntro', { name: c.name }),
    '',
    `Entity ID / Identifier: ${c.sp.entity_id}`,
    `Reply URL / ACS: ${c.sp.acs_url}`,
    `SP metadata URL: ${c.sp.metadata_url}`,
    `SCIM base URL: ${c.sp.scim_base_url}`,
    '',
    S('detail.briefSteps'),
  ].join('\n');
}

export function ConnectionDetail({ id, node, onBack, onChanged, showErr, confirm }) {
  const [conn, setConn] = useState(null);
  const [scimToken, setScimToken] = useState('');
  const [metaUrl, setMetaUrl] = useState('');
  const [metaXml, setMetaXml] = useState('');
  const [busy, setBusy] = useState(false);

  // Deps: the id only. `showErr` is a new function every render, and having it here turned the
  // load effect into a loop — measured as hundreds of refetches in twenty seconds. Load-path
  // errors go to the console like the other admin tabs; the toast stays for the interactive
  // actions, which are event handlers and never loop.
  const load = useCallback(async () => {
    try {
      const r = await getSsoConnection(id);
      if (r.data?.connection) setConn(r.data.connection);
    } catch (e) { console.warn('Failed to load SSO connection:', e.message); }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => onLiveUpdate(['config'], () => load()), [load]);

  if (!conn) return null;

  const frozen = node.locked;
  const listed = conn.login_visibility === 'listed';
  const canSignIn = node.enabled && conn.saml_configured;

  const act = async (fn) => {
    setBusy(true);
    try { await fn(); await load(); onChanged?.(); }
    catch (e) { showErr(e.message); }
    finally { setBusy(false); }
  };

  return html`
    <div class="adm-sso-detail">
      <div class="og-sec-h adm-sso-detail-h">
        <div>
          <button type="button" class="og-door og-door--quiet" onClick=${onBack}>${S('detail.back')}</button>
        </div>
        <div class="og-doors">
          <${Badge} type=${canSignIn ? 'success' : 'danger'}
            label=${canSignIn ? S('org.canSignIn') : S('org.cannotSignIn')} />
        </div>
      </div>

      <div class="adm-ov-status">${conn.name}</div>
      <p class="adm-alert-line">${S('detail.lead', { done: conn.steps_done ?? 0, total: 6 })}</p>
      <div class="adm-ov-up">${conn.id} · ${S('detail.created', { at: when(conn.created_at), by: conn.created_by })}</div>

      ${frozen ? html`<p class="adm-sso-locked">${S('now.lockedWhy', { setting: node.locked_setting })}</p>` : null}

      <div class="adm-sso-steps">
        <${Step} n=${1} state="done" title=${S('step.exists')}
          aside=${html`<${Badge} type="success" label=${S('step.done')} />`}>
          <p>${S('step.existsWhy')}</p>
          <div class="adm-sso-doms">
            ${(conn.domains || []).length
    ? conn.domains.map(d => html`<span class="adm-sso-chip">${d}</span>`)
    : html`<span class="adm-sso-chip">${S('org.noDomains')}</span>`}
          </div>
        <//>

        <${Step} n=${2} state=${conn.saml_configured ? 'done' : 'now'} title=${S('step.idp')}
          aside=${html`<${Badge} type=${conn.saml_configured ? 'success' : 'muted'}
            label=${conn.saml_configured ? S('step.done') : S('step.todo')} />`}>
          <p>${S('step.idpWhy')}</p>
          <${CopyRow} label=${S('detail.identifier')} value=${conn.sp.entity_id} />
          <${CopyRow} label=${S('detail.replyUrl')} value=${conn.sp.acs_url} />
          <${ExpandableHelp} title=${S('detail.entraTitle')}>
            <ol>${[1, 2, 3, 4, 5].map(i => html`<li>${S('detail.entra' + i)}</li>`)}</ol>
          <//>
          <${ExpandableHelp} title=${S('detail.oktaTitle')}>
            <ol>${[1, 2, 3, 4].map(i => html`<li>${S('detail.okta' + i)}</li>`)}</ol>
          <//>
          <div class="adm-sso-fld adm-sso-gap">
            <label>${S('detail.metaUrl')}</label>
            <input type="url" value=${metaUrl} disabled=${frozen}
              placeholder="https://login.microsoftonline.com/…/federationmetadata.xml"
              onInput=${e => setMetaUrl(e.target.value)} />
            <label>${S('detail.metaXml')}</label>
            <textarea rows="3" value=${metaXml} disabled=${frozen} placeholder="<EntityDescriptor …>"
              onInput=${e => setMetaXml(e.target.value)}></textarea>
            <button type="button" class="og-door" disabled=${frozen || busy || (!metaUrl.trim() && !metaXml.trim())}
              onClick=${() => act(async () => {
    await setSsoIdpMetadata(id, metaXml.trim() ? { xml: metaXml } : { url: metaUrl });
    setMetaUrl(''); setMetaXml('');
  })}>${conn.saml_configured ? S('detail.metaResubmit') : S('detail.metaSubmit')}</button>
            ${conn.saml_idp_entity_id
    ? html`<span class="adm-why">${S('detail.idpIs')} <code class="adm-sso-code">${conn.saml_idp_entity_id}</code></span>`
    : null}
          </div>
        <//>

        <${Step} n=${3} state="done" title=${S('step.findable')}
          aside=${html`<${Badge} type=${listed ? 'success' : 'info'}
            label=${listed ? S('step.listed') : S('step.hidden')} />`}>
          <p>${S('step.findableWhy')}</p>
          <label class="adm-sso-check">
            <input type="checkbox" checked=${listed} disabled=${frozen}
              onChange=${e => act(() => updateSsoConnection(id, { login_visibility: e.target.checked ? 'listed' : 'hidden' }))} />
            <span><b>${S('step.listedLabel')}</b><span class="adm-why">${S('step.listedWhy')}</span></span>
          </label>
          <label class="adm-sso-check">
            <input type="checkbox" checked=${conn.allow_idp_initiated} disabled=${frozen}
              onChange=${e => act(() => updateSsoConnection(id, { allow_idp_initiated: e.target.checked }))} />
            <span><b>${S('step.idpInitiated')}</b><span class="adm-why">${S('step.idpInitiatedWhy')}</span></span>
          </label>
        <//>

        <${Step} n=${4} state=${conn.scim_token_configured ? 'done' : 'now'} title=${S('step.key')}
          aside=${html`<${Badge} type=${conn.scim_token_configured ? 'success' : 'muted'}
            label=${conn.scim_token_configured ? S('step.minted') : S('step.todo')} />`}>
          <p>${S('step.keyWhy')}</p>
          <${CopyRow} label=${S('detail.scimBase')} value=${conn.sp.scim_base_url} />
          <button type="button" class="og-door" disabled=${frozen || busy}
            onClick=${() => confirm(S('detail.mintConfirm'), () => act(async () => {
    const r = await mintSsoScimToken(id);
    setScimToken(r.data?.scim_token || '');
  }))}>${conn.scim_token_configured ? S('detail.mintReplace') : S('detail.mintCreate')}</button>
          ${scimToken ? html`
            <div class="adm-sso-once">
              <b>${S('detail.tokenOnce')}</b>
              <${CopyRow} label=${S('detail.tokenLabel')} value=${scimToken} />
            </div>` : null}
          <${ExpandableHelp} title=${S('detail.scimEntraTitle')}>
            <ol>${[1, 2, 3, 4].map(i => html`<li>${S('detail.scimEntra' + i)}</li>`)}</ol>
          <//>
          <p class="adm-why">${conn.last_scim_request_at
    ? S('org.lastScim', { at: when(conn.last_scim_request_at) })
    : S('org.noScimYet')}</p>
        <//>

        <${Step} n=${5} state=${conn.last_login_at ? 'done' : 'now'} title=${S('step.signedIn')}
          aside=${html`<${Badge} type=${conn.last_login_at ? 'success' : 'muted'}
            label=${conn.last_login_at ? S('step.done') : S('step.waiting')} />`}>
          <p>${node.enabled ? S('step.signedInWhy') : S('step.signedInBlocked')}</p>
          ${canSignIn
    ? html`<a class="og-door" target="_blank" rel="noopener"
        href=${'/v1/ghii/login/saml/' + encodeURIComponent(id)}>${S('detail.testLogin')}</a>`
    : html`<span class="og-door og-door--off" title=${S('org.testOffWhy')}>${S('detail.testLogin')}</span>`}
          <p class="adm-why">${conn.last_login_at
    ? S('org.lastLogin', { at: when(conn.last_login_at) })
    : S('org.noLoginYet')}</p>
        <//>

        <${Step} n=${6} state=${node.enabled ? 'done' : 'now'} title=${S('step.door')} last=${true}
          aside=${html`<${Badge} type=${node.enabled ? 'success' : 'danger'}
            label=${node.enabled ? S('now.on') : S('now.off')} />`}>
          <p>${S('step.doorWhy', { setting: node.enabled_setting })}</p>
          ${!node.enabled ? html`
            <div class="adm-sso-gap">
              <a class="og-door og-door--danger" href="/v1/admin?tab=config">${S('now.openConfig')}</a>
            </div>` : null}
        <//>
      </div>

      <div class="adm-sso-two">
        <div>
          <div class="adm-sso-lbl">${S('detail.troubleTitle')}</div>
          <div class="adm-sso-scroll">
            <table class="adm-sso-tbl">
              <thead><tr><th>${S('detail.troubleWhat')}</th><th>${S('detail.troubleCode')}</th></tr></thead>
              <tbody>
                ${TROUBLE.map(([code, key]) => html`
                  <tr>
                    <td><b>${S('trouble.' + key)}</b><span class="adm-why">${S('trouble.' + key + 'Fix')}</span></td>
                    <td class="adm-sso-mono">${code}</td>
                  </tr>`)}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div class="adm-sso-lbl">${S('detail.briefTitle')}</div>
          <div class="og-box">
            <span class="og-box-label">${S('detail.briefLabel')}</span>
            <div class="adm-sso-paste">${aiBrief(conn)}</div>
          </div>
          <div class="adm-sso-acts">
            <${CopyButton} text=${aiBrief(conn)} label=${S('detail.copyBrief')} className="og-door og-door--quiet" />
          </div>

          <div class="adm-sso-lbl adm-sso-gap">${S('detail.dangerTitle')}</div>
          <p class="adm-why">${S('detail.deleteNote')}</p>
          <button type="button" class="og-door og-door--danger" disabled=${frozen || busy}
            onClick=${() => confirm(S('detail.deleteConfirm', { name: conn.name }), async () => {
    try { await deleteSsoConnection(id); onBack(); onChanged?.(); }
    catch (e) { showErr(e.message); }
  })}>${S('detail.delete')}</button>
        </div>
      </div>
    </div>`;
}
