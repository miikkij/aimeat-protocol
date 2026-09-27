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
 *
 *   Every part is a library component; the page passes data and writes no class.
 * @structure
 *   - Step — one row: its number, what it wants, and its measured state
 *   - ConnectionDetail — the six steps, the walkthroughs, troubleshooting, the danger zone
 * @usage Imported by views/admin/sso-tab.js.
 * @version-history
 *   v2.0.0 — 2026-09-27 — Library components only: the Verdict with the six steps beside it as a
 *     numbered List, the copy rows as Code with a copying Action, TextField and TextArea, Check,
 *     the walkthroughs as StepList in ExpandableHelp, the troubleshooting as a List, SettingBox.
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
import { Verdict } from '/components/Readings.js';
import { List, Row as Item, Name, Num, Cell, Doors } from '/components/List.js';
import { Figure } from '/components/Figure.js';
import { Action, Actions } from '/components/Action.js';
import { Code, Label, Marks, Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Box, SettingBox } from '/components/Box.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Check } from '/components/Check.js';
import { StepList } from '/components/StepList.js';
import { Beside, Stack, Row as Line } from '/components/Layout.js';
import { Frozen } from './sso-tab.now.js';
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

/** One step: number, what it wants, and the state the record proves (done green, now coral). */
function Step({ n, state, title, children, aside }) {
  const tone = state === 'done' ? 'fine' : state === 'now' ? 'notice' : undefined;
  return html`
    <${Item}>
      <${Num}><${Figure} small tone=${tone} n=${n} /><//>
      <${Cell}><${Stack} gap="small"><b>${title}</b>${children}<//><//>
      <${Doors}>${aside}<//>
    <//>`;
}

/** What an IdP console asks for, ready to paste. */
function CopyRow({ label, value }) {
  return html`
    <${Line} wrap gap="small">
      <${Note} kind="meta" inline>${label}<//>
      <${Code}>${value}<//>
      <${Action} small soft copy=${value}>${S('detail.copy')}<//>
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

  return html`
    <${Stack} gap="large">
      <${Line} justify="between" wrap>
        <${Action} small soft onClick=${onBack}>${S('detail.back')}<//>
        <${Badge} type=${canSignIn ? 'success' : 'danger'}
          label=${canSignIn ? S('org.canSignIn') : S('org.cannotSignIn')} />
      <//>

      <${Verdict} word=${conn.name}
        line=${S('detail.lead', { done: conn.steps_done ?? 0, total: 6 })}
        stamp=${`${conn.id} · ${S('detail.created', { at: when(conn.created_at), by: conn.created_by })}`}
        doors=${frozen ? html`<${Frozen} setting=${node.locked_setting} />` : null}>
        <${List} cols="n-name-state" keepCols>
          <${Step} n=${1} state="done" title=${S('step.exists')}
            aside=${html`<${Badge} type="success" label=${S('step.done')} />`}>
            <${Note} kind="hint">${S('step.existsWhy')}<//>
            <${Marks}>
              ${(conn.domains || []).length
    ? conn.domains.map(d => html`<${Mark} key=${d}>${d}<//>`)
    : html`<${Mark}>${S('org.noDomains')}<//>`}
            <//>
          <//>

          <${Step} n=${2} state=${conn.saml_configured ? 'done' : 'now'} title=${S('step.idp')}
            aside=${html`<${Badge} type=${conn.saml_configured ? 'success' : 'muted'}
              label=${conn.saml_configured ? S('step.done') : S('step.todo')} />`}>
            <${Note} kind="hint">${S('step.idpWhy')}<//>
            <${CopyRow} label=${S('detail.identifier')} value=${conn.sp.entity_id} />
            <${CopyRow} label=${S('detail.replyUrl')} value=${conn.sp.acs_url} />
            <${ExpandableHelp} title=${S('detail.entraTitle')}>
              <${StepList} steps=${[1, 2, 3, 4, 5].map(i => S('detail.entra' + i))} />
            <//>
            <${ExpandableHelp} title=${S('detail.oktaTitle')}>
              <${StepList} steps=${[1, 2, 3, 4].map(i => S('detail.okta' + i))} />
            <//>
            <${Stack} gap="small" above="small">
              <${TextField} type="url" label=${S('detail.metaUrl')} value=${metaUrl} disabled=${frozen}
                placeholder="https://login.microsoftonline.com/…/federationmetadata.xml"
                onInput=${v => setMetaUrl(v)} />
              <${TextArea} code rows=${3} label=${S('detail.metaXml')} value=${metaXml} disabled=${frozen}
                placeholder="<EntityDescriptor …>" onInput=${v => setMetaXml(v)} />
              <${Actions}>
                <${Action} small disabled=${frozen || busy || (!metaUrl.trim() && !metaXml.trim())}
                  onClick=${() => act(async () => {
    await setSsoIdpMetadata(id, metaXml.trim() ? { xml: metaXml } : { url: metaUrl });
    setMetaUrl(''); setMetaXml('');
  })}>${conn.saml_configured ? S('detail.metaResubmit') : S('detail.metaSubmit')}<//>
              <//>
              ${conn.saml_idp_entity_id
    ? html`<${Note} kind="hint">${S('detail.idpIs')} <${Code}>${conn.saml_idp_entity_id}<//><//>`
    : null}
            <//>
          <//>

          <${Step} n=${3} state="done" title=${S('step.findable')}
            aside=${html`<${Badge} type=${listed ? 'success' : 'info'}
              label=${listed ? S('step.listed') : S('step.hidden')} />`}>
            <${Note} kind="hint">${S('step.findableWhy')}<//>
            <${Check} checked=${listed} disabled=${frozen} hint=${S('step.listedWhy')}
              onChange=${checked => act(() => updateSsoConnection(id, { login_visibility: checked ? 'listed' : 'hidden' }))}>
              <b>${S('step.listedLabel')}</b>
            <//>
            <${Check} checked=${conn.allow_idp_initiated} disabled=${frozen} hint=${S('step.idpInitiatedWhy')}
              onChange=${checked => act(() => updateSsoConnection(id, { allow_idp_initiated: checked }))}>
              <b>${S('step.idpInitiated')}</b>
            <//>
          <//>

          <${Step} n=${4} state=${conn.scim_token_configured ? 'done' : 'now'} title=${S('step.key')}
            aside=${html`<${Badge} type=${conn.scim_token_configured ? 'success' : 'muted'}
              label=${conn.scim_token_configured ? S('step.minted') : S('step.todo')} />`}>
            <${Note} kind="hint">${S('step.keyWhy')}<//>
            <${CopyRow} label=${S('detail.scimBase')} value=${conn.sp.scim_base_url} />
            <${Actions}>
              <${Action} small disabled=${frozen || busy}
                onClick=${() => confirm(S('detail.mintConfirm'), () => act(async () => {
    const r = await mintSsoScimToken(id);
    setScimToken(r.data?.scim_token || '');
  }))}>${conn.scim_token_configured ? S('detail.mintReplace') : S('detail.mintCreate')}<//>
            <//>
            ${scimToken ? html`
              <${Box} tone="attention">
                <b>${S('detail.tokenOnce')}</b>
                <${CopyRow} label=${S('detail.tokenLabel')} value=${scimToken} />
              <//>` : null}
            <${ExpandableHelp} title=${S('detail.scimEntraTitle')}>
              <${StepList} steps=${[1, 2, 3, 4].map(i => S('detail.scimEntra' + i))} />
            <//>
            <${Note} kind="hint">${conn.last_scim_request_at
    ? S('org.lastScim', { at: when(conn.last_scim_request_at) })
    : S('org.noScimYet')}<//>
          <//>

          <${Step} n=${5} state=${conn.last_login_at ? 'done' : 'now'} title=${S('step.signedIn')}
            aside=${html`<${Badge} type=${conn.last_login_at ? 'success' : 'muted'}
              label=${conn.last_login_at ? S('step.done') : S('step.waiting')} />`}>
            <${Note} kind="hint">${node.enabled ? S('step.signedInWhy') : S('step.signedInBlocked')}<//>
            <${Actions}>
              ${canSignIn
    ? html`<${Action} small newTab href=${'/v1/ghii/login/saml/' + encodeURIComponent(id)}>${S('detail.testLogin')}<//>`
    : html`<${Action} small disabled title=${S('org.testOffWhy')}>${S('detail.testLogin')}<//>`}
            <//>
            <${Note} kind="hint">${conn.last_login_at
    ? S('org.lastLogin', { at: when(conn.last_login_at) })
    : S('org.noLoginYet')}<//>
          <//>

          <${Step} n=${6} state=${node.enabled ? 'done' : 'now'} title=${S('step.door')}
            aside=${html`<${Badge} type=${node.enabled ? 'success' : 'danger'}
              label=${node.enabled ? S('now.on') : S('now.off')} />`}>
            <${Note} kind="hint">${S('step.doorWhy', { setting: node.enabled_setting })}<//>
            ${!node.enabled ? html`
              <${Actions}>
                <${Action} small tone="danger" href="/v1/admin?tab=config">${S('now.openConfig')}<//>
              <//>` : null}
          <//>
        <//>
      <//>

      <${Beside} wide rule pad="large" side=${html`
        <${Stack}>
          <${Label} block>${S('detail.briefTitle')}<//>
          <${SettingBox} label=${S('detail.briefLabel')}>
            <${Code} block>${aiBrief(conn)}<//>
          <//>
          <${Actions}>
            <${Action} small soft copy=${aiBrief(conn)}>${S('detail.copyBrief')}<//>
          <//>

          <${Label} block>${S('detail.dangerTitle')}<//>
          <${Note} kind="hint">${S('detail.deleteNote')}<//>
          <${Actions}>
            <${Action} small tone="danger" disabled=${frozen || busy}
              onClick=${() => confirm(S('detail.deleteConfirm', { name: conn.name }), async () => {
    try { await deleteSsoConnection(id); onBack(); onChanged?.(); }
    catch (e) { showErr(e.message); }
  })}>${S('detail.delete')}<//>
          <//>
        <//>`}>
        <${Label} block>${S('detail.troubleTitle')}<//>
        <${List} cols="name-what" head=${[S('detail.troubleWhat'), S('detail.troubleCode')]}>
          ${TROUBLE.map(([code, key]) => html`
            <${Item} key=${code}>
              <${Name} desc=${S('trouble.' + key + 'Fix')}>${S('trouble.' + key)}<//>
              <${Cell} meta>${code}<//>
            <//>`)}
        <//>
      <//>
    <//>`;
}
