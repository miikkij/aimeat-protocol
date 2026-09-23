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
 *   2026-09-22 -- Composed from the shared component set (numbered ListRows for the six steps,
 *     KeyValue copy rows, Field, Table, Surface): no class of its own, so a theme change reaches it.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.1.0 -- 2026-09-13 -- Compose ink row boundaries from the shared poster class.
 *   v1.0.0 — 2026-09-12 — Initial (the Organisation sign-in page in the poster face).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { Badge, ExpandableHelp, when } from './shared.js';
import { Columns, Stack, Steps, ListRow, KeyValue, Table, Field, Surface, Action, CopyAction, Text } from '/components/poster-parts.js';
import { Locked } from './sso-tab.now.js';
import { Domains } from './sso-tab.list.js';
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
function Step({ n, title, children, aside }) {
  // The measured state is the badge in `aside`; the number is the same coral for every step.
  return html`
    <${ListRow} number=${n} name=${title} value=${aside}>
      <${Stack} density="compact">${children}<//>
    <//>`;
}

/** What an IdP console asks for, ready to paste. */
function CopyRow({ label, value }) {
  return html`
    <${KeyValue} label=${label}>
      <${Stack} direction="wrap" align="center" density="compact">
        <${Text} kind="mono">${value}<//>
        <${CopyAction} kind="text" text=${value} label=${S('detail.copy')} />
      <//>
    <//>`;
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

  const why = (text) => html`<${Text} tone="muted">${text}<//>`;
  const caption = (text) => html`<${Text} kind="caption" tone="muted">${text}<//>`;
  const steps = (prefix, count) => html`<${Steps} items=${Array.from({ length: count }, (_, i) => S(prefix + (i + 1)))} />`;

  return html`
    <${Stack}>
      <${Stack} direction="horizontal" align="between">
        <${Action} onClick=${onBack}>${S('detail.back')}<//>
        <${Badge} type=${canSignIn ? 'success' : 'danger'}
          label=${canSignIn ? S('org.canSignIn') : S('org.cannotSignIn')} />
      <//>

      <${Stack} density="compact">
        <${Text} kind="heading">${conn.name}<//>
        <${Text}>${S('detail.lead', { done: conn.steps_done ?? 0, total: 6 })}<//>
        <${Text} kind="mono" tone="muted">${conn.id} · ${S('detail.created', { at: when(conn.created_at), by: conn.created_by })}<//>
      <//>

      ${frozen ? html`<${Locked} setting=${node.locked_setting} />` : null}

      <div>
        <${Step} n=${1} state="done" title=${S('step.exists')}
          aside=${html`<${Badge} type="success" label=${S('step.done')} />`}>
          ${why(S('step.existsWhy'))}
          <${Domains} domains=${conn.domains} />
        <//>

        <${Step} n=${2} state=${conn.saml_configured ? 'done' : 'now'} title=${S('step.idp')}
          aside=${html`<${Badge} type=${conn.saml_configured ? 'success' : 'muted'}
            label=${conn.saml_configured ? S('step.done') : S('step.todo')} />`}>
          ${why(S('step.idpWhy'))}
          <${CopyRow} label=${S('detail.identifier')} value=${conn.sp.entity_id} />
          <${CopyRow} label=${S('detail.replyUrl')} value=${conn.sp.acs_url} />
          <${ExpandableHelp} title=${S('detail.entraTitle')}>${steps('detail.entra', 5)}<//>
          <${ExpandableHelp} title=${S('detail.oktaTitle')}>${steps('detail.okta', 4)}<//>
          <${Field} type="url" label=${S('detail.metaUrl')} value=${metaUrl} disabled=${frozen}
            placeholder="https://login.microsoftonline.com/…/federationmetadata.xml"
            onInput=${e => setMetaUrl(e.target.value)} />
          <${Field} type="textarea" rows=${3} label=${S('detail.metaXml')} value=${metaXml} disabled=${frozen}
            placeholder="<EntityDescriptor …>" onInput=${e => setMetaXml(e.target.value)} />
          <${Stack} direction="wrap" align="center">
            <${Action} disabled=${frozen || busy || (!metaUrl.trim() && !metaXml.trim())}
              onClick=${() => act(async () => {
    await setSsoIdpMetadata(id, metaXml.trim() ? { xml: metaXml } : { url: metaUrl });
    setMetaUrl(''); setMetaXml('');
  })}>${conn.saml_configured ? S('detail.metaResubmit') : S('detail.metaSubmit')}<//>
            ${conn.saml_idp_entity_id
    ? html`<${Text} kind="caption" tone="muted">${S('detail.idpIs')} <${Text} kind="mono">${conn.saml_idp_entity_id}<//><//>`
    : null}
          <//>
        <//>

        <${Step} n=${3} state="done" title=${S('step.findable')}
          aside=${html`<${Badge} type=${listed ? 'success' : 'info'}
            label=${listed ? S('step.listed') : S('step.hidden')} />`}>
          ${why(S('step.findableWhy'))}
          <${Field} type="checkbox" label=${S('step.listedLabel')} hint=${S('step.listedWhy')} value=${listed} disabled=${frozen}
            onChange=${e => act(() => updateSsoConnection(id, { login_visibility: e.target.checked ? 'listed' : 'hidden' }))} />
          <${Field} type="checkbox" label=${S('step.idpInitiated')} hint=${S('step.idpInitiatedWhy')} value=${conn.allow_idp_initiated} disabled=${frozen}
            onChange=${e => act(() => updateSsoConnection(id, { allow_idp_initiated: e.target.checked }))} />
        <//>

        <${Step} n=${4} state=${conn.scim_token_configured ? 'done' : 'now'} title=${S('step.key')}
          aside=${html`<${Badge} type=${conn.scim_token_configured ? 'success' : 'muted'}
            label=${conn.scim_token_configured ? S('step.minted') : S('step.todo')} />`}>
          ${why(S('step.keyWhy'))}
          <${CopyRow} label=${S('detail.scimBase')} value=${conn.sp.scim_base_url} />
          <${Stack} direction="wrap">
            <${Action} disabled=${frozen || busy}
              onClick=${() => confirm(S('detail.mintConfirm'), () => act(async () => {
    const r = await mintSsoScimToken(id);
    setScimToken(r.data?.scim_token || '');
  }))}>${conn.scim_token_configured ? S('detail.mintReplace') : S('detail.mintCreate')}<//>
          <//>
          ${scimToken ? html`
            <${Surface} kind="box" tone="coral" density="compact"><${Stack} density="compact">
              <strong>${S('detail.tokenOnce')}</strong>
              <${CopyRow} label=${S('detail.tokenLabel')} value=${scimToken} />
            <//><//>` : null}
          <${ExpandableHelp} title=${S('detail.scimEntraTitle')}>${steps('detail.scimEntra', 4)}<//>
          ${caption(conn.last_scim_request_at
    ? S('org.lastScim', { at: when(conn.last_scim_request_at) })
    : S('org.noScimYet'))}
        <//>

        <${Step} n=${5} state=${conn.last_login_at ? 'done' : 'now'} title=${S('step.signedIn')}
          aside=${html`<${Badge} type=${conn.last_login_at ? 'success' : 'muted'}
            label=${conn.last_login_at ? S('step.done') : S('step.waiting')} />`}>
          ${why(node.enabled ? S('step.signedInWhy') : S('step.signedInBlocked'))}
          <${Stack} direction="wrap">
            ${canSignIn
    ? html`<${Action} target="_blank" href=${'/v1/ghii/login/saml/' + encodeURIComponent(id)}>${S('detail.testLogin')}<//>`
    : html`<${Action} disabled title=${S('org.testOffWhy')}>${S('detail.testLogin')}<//>`}
          <//>
          ${caption(conn.last_login_at
    ? S('org.lastLogin', { at: when(conn.last_login_at) })
    : S('org.noLoginYet'))}
        <//>

        <${Step} n=${6} state=${node.enabled ? 'done' : 'now'} title=${S('step.door')}
          aside=${html`<${Badge} type=${node.enabled ? 'success' : 'danger'}
            label=${node.enabled ? S('now.on') : S('now.off')} />`}>
          ${why(S('step.doorWhy', { setting: node.enabled_setting }))}
          ${!node.enabled ? html`
            <${Stack} direction="wrap">
              <${Action} tone="danger" href="/v1/admin?tab=config">${S('now.openConfig')}<//>
            <//>` : null}
        <//>
      </div>

      <${Columns} layout="trailing" collapse=${900}>
        <${Stack} density="compact">
          <${Text} kind="label">${S('detail.troubleTitle')}<//>
          <${Table} density="compact" collapse=${560} label=${S('detail.troubleTitle')}
            headers=${[S('detail.troubleWhat'), S('detail.troubleCode')]}
            rows=${TROUBLE.map(([code, key]) => [
    html`<${Stack} density="compact"><strong>${S('trouble.' + key)}</strong>${why(S('trouble.' + key + 'Fix'))}<//>`,
    html`<${Text} kind="mono">${code}<//>`,
  ])} />
        <//>
        <${Stack} density="compact">
          <${Text} kind="label">${S('detail.briefTitle')}<//>
          <${Surface} kind="aside" density="compact"><${Stack} density="compact">
            <${Text} kind="label">${S('detail.briefLabel')}<//>
            <${Text} lines>${aiBrief(conn)}<//>
          <//><//>
          <${Stack} direction="wrap">
            <${CopyAction} text=${aiBrief(conn)} label=${S('detail.copyBrief')} />
          <//>

          <${Text} kind="label">${S('detail.dangerTitle')}<//>
          ${caption(S('detail.deleteNote'))}
          <${Stack} direction="wrap">
            <${Action} tone="danger" disabled=${frozen || busy}
              onClick=${() => confirm(S('detail.deleteConfirm', { name: conn.name }), async () => {
    try { await deleteSsoConnection(id); onBack(); onChanged?.(); }
    catch (e) { showErr(e.message); }
  })}>${S('detail.delete')}<//>
          <//>
        <//>
      <//>
    <//>`;
}
