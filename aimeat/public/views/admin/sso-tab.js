/**
 * @file public/views/admin/sso-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard tab for organisation sign-in (BR-04): the SSO connections an
 *   operator manages, and — per connection — a five-step setup playbook where every step shows
 *   its MEASURED state from the record (created → IdP metadata read → a real login seen → the
 *   directory has called SCIM → production choices), never a claim without evidence. Includes the
 *   IdP-console walkthroughs for Entra and Okta, a troubleshooting table keyed by the error codes
 *   the doors actually emit, the copy-once SCIM token, and a copyable brief the operator can hand
 *   their own AI to be guided through the IdP side.
 * @structure
 *   - SsoTab(): list + create form, or the selected connection's detail
 *   - ConnectionDetail(): SP details, the playbook steps, troubleshooting, AI brief, danger zone
 *   - Step(): one playbook row with its measured status
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial (BR-04 phase 1, playbook per Jouni's 2026-08-23 requirement).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, copyToClipboard } from '/js/utils.js';
import { dt, Empty, useToast, Toast, DataTable, ExpandableHelp } from './shared.js';
import {
  getSsoConnections, getSsoConnection, createSsoConnection, updateSsoConnection,
  deleteSsoConnection, mintSsoScimToken, setSsoIdpMetadata,
} from '/js/services/admin.js';
import { useConfirm } from '/components/Modal.js';

const ok = (cond) => cond ? '✓' : '';

/** One playbook step: number, measured state, title, body. The state is read from the record. */
function Step({ n, done, title, children }) {
  return html`
    <div class="adm-card adm-sso-step">
      <div class="adm-sso-step-head">
        <strong>${n}. ${title}</strong>
        ${done
          ? html`<span class="tag">✓ ${t('dashboard.ssoStepDone')}</span>`
          : html`<span class="tag adm-sso-tag-dim">${t('dashboard.ssoStepTodo')}</span>`}
      </div>
      <div class="adm-sso-step-body">${children}</div>
    </div>
  `;
}

/** A value with a copy button — what the IdP console asks for, ready to paste. */
function CopyRow({ label, value, onCopied }) {
  return html`
    <div class="adm-sso-copyrow">
      <span class="adm-sso-copylabel">${label}</span>
      <code class="mono adm-sso-code">${escHtml(value)}</code>
      <button class="adm-btn-sm" onClick=${async () => { await copyToClipboard(value); onCopied?.(); }}>${t('dashboard.ssoCopy')}</button>
    </div>
  `;
}

/** The brief an operator pastes to their own AI to be walked through the IdP console side. */
function aiBrief(c) {
  return [
    t('dashboard.ssoAiBriefIntro').replace('{name}', c.name),
    '',
    `Entity ID / Identifier: ${c.sp.entity_id}`,
    `Reply URL / ACS: ${c.sp.acs_url}`,
    `SP metadata URL: ${c.sp.metadata_url}`,
    `SCIM base URL: ${c.sp.scim_base_url}`,
    '',
    t('dashboard.ssoAiBriefSteps'),
  ].join('\n');
}

function ConnectionDetail({ id, onBack, showErr, confirm, reload }) {
  const [conn, setConn] = useState(null);
  const [scimToken, setScimToken] = useState('');
  const [metaUrl, setMetaUrl] = useState('');
  const [metaXml, setMetaXml] = useState('');
  const [busy, setBusy] = useState(false);

  // Deps: the id only. showErr is a new function every render, and having it here turned the
  // load-effect into a loop — load → setConn → render → new load → effect → load — measured as
  // hundreds of refetches in 20 s. Load-path errors go to the console like the other admin tabs;
  // the toast stays for the interactive actions, which are event handlers and never loop.
  const load = useCallback(async () => {
    try {
      const r = await getSsoConnection(id);
      if (r.data?.connection) setConn(r.data.connection);
    } catch (e) { console.warn('Failed to load SSO connection:', e.message); }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => onLiveUpdate(['config'], () => load()), [load]);

  if (!conn) return null;

  async function submitMetadata() {
    setBusy(true);
    try {
      await setSsoIdpMetadata(id, metaXml.trim() ? { xml: metaXml } : { url: metaUrl });
      setMetaUrl(''); setMetaXml('');
      await load();
    } catch (e) { showErr(e.message); }
    setBusy(false);
  }

  async function mintToken() {
    confirm(t('dashboard.ssoScimTokenConfirm'), async () => {
      try {
        const r = await mintSsoScimToken(id);
        setScimToken(r.data?.scim_token || '');
        await load();
      } catch (e) { showErr(e.message); }
    });
  }

  async function saveSetting(patch) {
    try { await updateSsoConnection(id, patch); await load(); }
    catch (e) { showErr(e.message); }
  }

  function doDelete() {
    confirm(t('dashboard.ssoDeleteConfirm').replace('{name}', conn.name), async () => {
      try { await deleteSsoConnection(id); onBack(); reload(); }
      catch (e) { showErr(e.message); }
    });
  }

  const trouble = [
    ['SAML_INVALID_RESPONSE', t('dashboard.ssoTrbInvalidResponse')],
    ['SAML_START_FAILED', t('dashboard.ssoTrbStartFailed')],
    ['ACCOUNT_DISABLED', t('dashboard.ssoTrbAccountDisabled')],
    ['REGISTRATION_CLOSED', t('dashboard.ssoTrbRegistrationClosed')],
    ['FEATURE_DISABLED (503)', t('dashboard.ssoTrbFeatureDisabled')],
    ['401 (SCIM)', t('dashboard.ssoTrbScim401')],
    ['403 (SCIM)', t('dashboard.ssoTrbScim403')],
    ['409 uniqueness (SCIM)', t('dashboard.ssoTrbScim409')],
  ];

  return html`
    <div>
      <button class="adm-btn-sm" onClick=${onBack}>← ${t('dashboard.ssoBack')}</button>
      <h3 class="adm-sso-h3">${escHtml(conn.name)} <code class="mono adm-sso-title-code">${escHtml(conn.id)}</code></h3>
      <p class="adm-sso-lead">${t('dashboard.ssoDetailIntro')}</p>

      <${Step} n=${1} done=${true} title=${t('dashboard.ssoStep1Title')}>
        <p>${t('dashboard.ssoStep1Body')}</p>
        <div>
          <span class="adm-sso-dim">${t('dashboard.ssoDomains')}:</span>
          ${(conn.domains || []).length ? conn.domains.map(d => html`<span class="tag">${escHtml(d)}</span> `) : html`<em>${t('dashboard.ssoNoDomains')}</em>`}
        </div>
      <//>

      <${Step} n=${2} done=${conn.saml_configured} title=${t('dashboard.ssoStep2Title')}>
        <p>${t('dashboard.ssoStep2Body')}</p>
        <${CopyRow} label=${t('dashboard.ssoSpEntityId')} value=${conn.sp.entity_id} />
        <${CopyRow} label=${t('dashboard.ssoSpAcsUrl')} value=${conn.sp.acs_url} />
        <${ExpandableHelp} title=${t('dashboard.ssoEntraHowTitle')}>
          <ol>
            <li>${t('dashboard.ssoEntraHow1')}</li>
            <li>${t('dashboard.ssoEntraHow2')}</li>
            <li>${t('dashboard.ssoEntraHow3')}</li>
            <li>${t('dashboard.ssoEntraHow4')}</li>
            <li>${t('dashboard.ssoEntraHow5')}</li>
          </ol>
        <//>
        <${ExpandableHelp} title=${t('dashboard.ssoOktaHowTitle')}>
          <ol>
            <li>${t('dashboard.ssoOktaHow1')}</li>
            <li>${t('dashboard.ssoOktaHow2')}</li>
            <li>${t('dashboard.ssoOktaHow3')}</li>
            <li>${t('dashboard.ssoOktaHow4')}</li>
          </ol>
        <//>
        <div class="adm-sso-gap-top">
          <label class="adm-label">${t('dashboard.ssoMetaUrlLabel')}</label>
          <input class="adm-input" type="url" placeholder="https://login.microsoftonline.com/…/federationmetadata.xml"
            value=${metaUrl} onInput=${e => setMetaUrl(e.target.value)} />
          <label class="adm-label adm-sso-gap-top">${t('dashboard.ssoMetaXmlLabel')}</label>
          <textarea class="adm-input" rows="3" placeholder="<EntityDescriptor …>"
            value=${metaXml} onInput=${e => setMetaXml(e.target.value)}></textarea>
          <button class="adm-btn-sm" disabled=${busy || (!metaUrl.trim() && !metaXml.trim())} onClick=${submitMetadata}>
            ${conn.saml_configured ? t('dashboard.ssoMetaResubmit') : t('dashboard.ssoMetaSubmit')}
          </button>
          ${conn.saml_idp_entity_id && html`<div class="adm-sso-note">${t('dashboard.ssoIdpConfigured')}: <code class="mono adm-sso-code">${escHtml(conn.saml_idp_entity_id)}</code></div>`}
        </div>
      <//>

      <${Step} n=${3} done=${!!conn.last_login_at} title=${t('dashboard.ssoStep3Title')}>
        <p>${t('dashboard.ssoStep3Body')}</p>
        <a class="adm-btn-sm" target="_blank" rel="noopener" href=${'/v1/ghii/login/saml/' + encodeURIComponent(conn.id)}>
          ${t('dashboard.ssoTestLogin')}
        </a>
        ${conn.last_login_at
          ? html`<div class="adm-sso-note">${t('dashboard.ssoLastLogin')}: ${dt(conn.last_login_at)}</div>`
          : html`<div class="adm-sso-note">${t('dashboard.ssoNoLoginYet')}</div>`}
      <//>

      <${Step} n=${4} done=${conn.scim_token_configured && !!conn.last_scim_request_at} title=${t('dashboard.ssoStep4Title')}>
        <p>${t('dashboard.ssoStep4Body')}</p>
        <${CopyRow} label=${t('dashboard.ssoScimBaseUrl')} value=${conn.sp.scim_base_url} />
        <button class="adm-btn-sm" onClick=${mintToken}>
          ${conn.scim_token_configured ? t('dashboard.ssoScimTokenReplace') : t('dashboard.ssoScimTokenCreate')}
        </button>
        ${scimToken && html`
          <div class="adm-card adm-sso-gap-top">
            <strong>${t('dashboard.ssoScimTokenOnce')}</strong>
            <${CopyRow} label=${t('dashboard.ssoScimTokenLabel')} value=${scimToken} />
          </div>
        `}
        <${ExpandableHelp} title=${t('dashboard.ssoScimEntraTitle')}>
          <ol>
            <li>${t('dashboard.ssoScimEntra1')}</li>
            <li>${t('dashboard.ssoScimEntra2')}</li>
            <li>${t('dashboard.ssoScimEntra3')}</li>
            <li>${t('dashboard.ssoScimEntra4')}</li>
          </ol>
        <//>
        ${conn.last_scim_request_at
          ? html`<div class="adm-sso-note">${t('dashboard.ssoLastScim')}: ${dt(conn.last_scim_request_at)}</div>`
          : html`<div class="adm-sso-note">${t('dashboard.ssoNoScimYet')}</div>`}
      <//>

      <${Step} n=${5} done=${conn.saml_configured && conn.scim_token_configured} title=${t('dashboard.ssoStep5Title')}>
        <p>${t('dashboard.ssoStep5Body')}</p>
        <label class="adm-sso-check-row">
          <input type="checkbox" checked=${conn.login_visibility === 'listed'}
            onChange=${e => saveSetting({ login_visibility: e.target.checked ? 'listed' : 'hidden' })} />
          ${' '}${t('dashboard.ssoVisibilityListed')}
        </label>
        <label class="adm-sso-check-row">
          <input type="checkbox" checked=${conn.allow_idp_initiated}
            onChange=${e => saveSetting({ allow_idp_initiated: e.target.checked })} />
          ${' '}${t('dashboard.ssoIdpInitiated')}
        </label>
        <p class="adm-sso-intro">${t('dashboard.ssoLockNote')}</p>
      <//>

      <${ExpandableHelp} title=${t('dashboard.ssoTroubleTitle')}>
        <${DataTable}
          headers=${[t('dashboard.ssoTroubleCode'), t('dashboard.ssoTroubleFix')]}
          rows=${trouble.map(([code, fix]) => [html`<code class="mono adm-sso-code">${code}</code>`, fix])}
        />
      <//>

      <${ExpandableHelp} title=${t('dashboard.ssoAiBriefTitle')}>
        <p>${t('dashboard.ssoAiBriefHint')}</p>
        <textarea class="adm-input mono adm-sso-brief" rows="8" readonly>${aiBrief(conn)}</textarea>
        <button class="adm-btn-sm" onClick=${() => copyToClipboard(aiBrief(conn))}>${t('dashboard.ssoCopy')}</button>
      <//>

      <div class="adm-card adm-sso-section">
        <strong>${t('dashboard.ssoDangerTitle')}</strong>
        <p class="adm-sso-intro">${t('dashboard.ssoDeleteNote')}</p>
        <button class="adm-btn-sm" onClick=${doDelete}>${t('dashboard.ssoDelete')}</button>
      </div>
    </div>
  `;
}

export default function SsoTab() {
  const [connections, setConnections] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ id: '', name: '', domains: '', organism_id: '', login_visibility: 'listed' });
  const [toast, showErr, , clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();

  // Same dep rule as the detail's load above: an empty list, or the effect loops.
  const load = useCallback(async ({ showSpinner = true } = {}) => {
    void showSpinner;
    try {
      const r = await getSsoConnections();
      if (r.data) setConnections(r.data.connections || []);
    } catch (e) { console.warn('Failed to load SSO connections:', e.message); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => onLiveUpdate(['config'], () => load({ showSpinner: false })), [load]);

  async function doCreate() {
    try {
      const body = {
        id: form.id.trim(), name: form.name.trim(),
        domains: form.domains.split(',').map(s => s.trim()).filter(Boolean),
        login_visibility: form.login_visibility,
        ...(form.organism_id.trim() ? { organism_id: form.organism_id.trim() } : {}),
      };
      const r = await createSsoConnection(body);
      setShowCreate(false);
      setForm({ id: '', name: '', domains: '', organism_id: '', login_visibility: 'listed' });
      await load();
      setSelected(r.data?.connection?.id || body.id);
    } catch (e) { showErr(e.message); }
  }

  if (selected) {
    return html`
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <${ConnectionDetail} id=${selected} onBack=${() => setSelected(null)} showErr=${showErr} confirm=${confirm} reload=${load} />
      <${ConfirmUI} />
    `;
  }

  return html`
    <div>
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <p class="adm-sso-intro">${t('dashboard.ssoIntro')}</p>

      ${connections.length === 0 && html`<${Empty} text=${t('dashboard.ssoEmpty')} />`}
      ${connections.length > 0 && html`
        <${DataTable}
          scroll=${true}
          headers=${[t('dashboard.ssoColName'), t('dashboard.ssoColDomains'), 'SAML', 'SCIM', t('dashboard.ssoColVisibility'), t('dashboard.ssoColLastLogin'), '']}
          rows=${connections.map(c => [
            html`<strong>${escHtml(c.name)}</strong> <code class="mono adm-sso-code">${escHtml(c.id)}</code>`,
            (c.domains || []).join(', ') || '—',
            ok(c.saml_configured),
            ok(c.scim_token_configured),
            c.login_visibility === 'listed' ? t('dashboard.ssoVisListed') : t('dashboard.ssoVisHidden'),
            c.last_login_at ? dt(c.last_login_at) : '—',
            html`<button class="adm-btn-sm" onClick=${() => setSelected(c.id)}>${t('dashboard.ssoOpen')}</button>`,
          ])}
        />
      `}

      <div class="adm-sso-section">
        ${!showCreate && html`<button class="adm-btn-sm" onClick=${() => setShowCreate(true)}>${t('dashboard.ssoCreateBtn')}</button>`}
        ${showCreate && html`
          <div class="adm-card">
            <strong>${t('dashboard.ssoCreateTitle')}</strong>
            <p class="adm-sso-intro">${t('dashboard.ssoCreateIntro')}</p>
            <label class="adm-label">${t('dashboard.ssoFieldId')}</label>
            <input class="adm-input" value=${form.id} placeholder="contoso" onInput=${e => setForm({ ...form, id: e.target.value })} />
            <label class="adm-label">${t('dashboard.ssoFieldName')}</label>
            <input class="adm-input" value=${form.name} placeholder="Contoso Oy" onInput=${e => setForm({ ...form, name: e.target.value })} />
            <label class="adm-label">${t('dashboard.ssoFieldDomains')}</label>
            <input class="adm-input" value=${form.domains} placeholder="contoso.com, contoso.fi" onInput=${e => setForm({ ...form, domains: e.target.value })} />
            <label class="adm-label">${t('dashboard.ssoFieldOrganism')}</label>
            <input class="adm-input" value=${form.organism_id} placeholder="org-…" onInput=${e => setForm({ ...form, organism_id: e.target.value })} />
            <label class="adm-sso-check-row">
              <input type="checkbox" checked=${form.login_visibility === 'listed'}
                onChange=${e => setForm({ ...form, login_visibility: e.target.checked ? 'listed' : 'hidden' })} />
              ${' '}${t('dashboard.ssoVisibilityListed')}
            </label>
            <div class="adm-sso-actions">
              <button class="adm-btn-sm" disabled=${!form.id.trim() || !form.name.trim()} onClick=${doCreate}>${t('dashboard.ssoCreateSubmit')}</button>
              <button class="adm-btn-sm" onClick=${() => setShowCreate(false)}>${t('dashboard.ssoCreateCancel')}</button>
            </div>
          </div>
        `}
      </div>
    </div>
  `;
}
