/**
 * @file sso-tab.list.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 02 of the Organisation sign-in page: the companies connected, and the form
 *   that adds one. With none connected, the preparation that belongs before anybody opens a
 *   console.
 *
 *   A ROW SAYS WHAT THE COMPANY CAN DO, not which boxes are ticked. The old list was a table of
 *   ticks — SAML ✓, SCIM ✓, Listed — which is five facts and no answer. The one an operator wants
 *   is whether somebody at that company can sign in at this moment, and the reason when they
 *   cannot. That reason is usually not on this page: it is the node-wide switch.
 *
 *   "TEST SIGN-IN" IS DISABLED WHEN IT CANNOT WORK. It opens the real door, and while the switch is
 *   off the real door answers 503. A button that leads to an error the page already knows about is
 *   worse than one that says why it is off.
 *
 *   THE FOUR THINGS TO GATHER exist because two of them need a person at the other company, and
 *   that is what turns twenty minutes into a week of messages. The old empty state said none of it.
 * @structure
 *   - BeforeYouStart — section 02 when nothing is connected
 *   - Organisations — section 02 with connections, and the create form
 * @usage Imported by views/admin/sso-tab.js.
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial (the Organisation sign-in page in the poster face).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Badge, when } from './shared.js';

const S = (key, params) => t('admin.sso.' + key, params);

/** The four things an operator needs in hand, two of which need somebody at the company. */
const GATHER = ['shortName', 'domains', 'someone', 'visibility'];

/**
 * Section 02 with nothing connected: what to have ready, and the form.
 *
 * The form lives HERE rather than in its own section because the four things above are its fields:
 * a reader who has just been told what to gather should not then have to find where to put it.
 */
export function BeforeYouStart({ node, onCreate, busy }) {
  const [creating, setCreating] = useState(false);
  return html`
    <section class="og-sec" id="adm-sso-02">
      <div class="og-sec-h">
        <h2>${S('before.title')}<small>02</small></h2>
        <div class="og-doors">
          ${!creating ? html`
            <button type="button" class="og-door og-door--danger" disabled=${node.locked}
              onClick=${() => setCreating(true)}>${S('now.connect')}</button>` : null}
        </div>
      </div>
      <p class="adm-sso-lead">${S('before.lead')}</p>
      ${GATHER.map((k, i) => html`
        <div class="adm-sso-step ${i === GATHER.length - 1 ? 'adm-sso-step--last' : ''}">
          <span class="adm-sso-step-n">${i + 1}</span>
          <span>
            <b>${S('before.' + k)}</b>
            <p>${S('before.' + k + 'Why')}</p>
          </span>
          <span></span>
        </div>`)}
      <p class="adm-sso-note">${S('before.note')}</p>

      ${creating ? html`
        <div class="adm-sso-newbox">
          <span class="adm-sso-newlabel">${S('form.title')}</span>
          <${CreateForm} busy=${busy} onCancel=${() => setCreating(false)}
            onCreate=${async (body) => { const ok = await onCreate(body); if (ok) setCreating(false); }} />
        </div>` : null}
    </section>`;
}

/** The one write this section makes. Refused outright while the page is frozen. */
function CreateForm({ onCreate, onCancel, busy }) {
  const [form, setForm] = useState({ id: '', name: '', domains: '', organism_id: '', listed: true });
  const set = (patch) => setForm({ ...form, ...patch });
  const ready = form.id.trim() && form.name.trim();

  return html`
    <div class="adm-sso-form">
      <div class="adm-sso-fld">
        <label>${S('form.id')}</label>
        <input type="text" value=${form.id} placeholder="contoso"
          onInput=${e => set({ id: e.target.value })} />
        <span class="adm-why">${S('form.idWhy')}</span>
      </div>
      <div class="adm-sso-fld">
        <label>${S('form.name')}</label>
        <input type="text" value=${form.name} placeholder="Contoso Oy"
          onInput=${e => set({ name: e.target.value })} />
        <span class="adm-why">${S('form.nameWhy')}</span>
      </div>
      <div class="adm-sso-fld">
        <label>${S('form.domains')}</label>
        <input type="text" value=${form.domains} placeholder="contoso.com, contoso.fi"
          onInput=${e => set({ domains: e.target.value })} />
        <span class="adm-why">${S('form.domainsWhy')}</span>
      </div>
      <div class="adm-sso-fld">
        <label>${S('form.organism')}</label>
        <input type="text" value=${form.organism_id} placeholder="org-…"
          onInput=${e => set({ organism_id: e.target.value })} />
        <span class="adm-why">${S('form.organismWhy')}</span>
      </div>
      <label class="adm-sso-check">
        <input type="checkbox" checked=${form.listed}
          onChange=${e => set({ listed: e.target.checked })} />
        <span><b>${S('form.listed')}</b><span class="adm-why">${S('form.listedWhy')}</span></span>
      </label>
      <div class="adm-sso-acts">
        <button type="button" class="og-door" disabled=${!ready || busy}
          onClick=${() => onCreate({
    id: form.id.trim(),
    name: form.name.trim(),
    domains: form.domains.split(',').map(s => s.trim()).filter(Boolean),
    login_visibility: form.listed ? 'listed' : 'hidden',
    ...(form.organism_id.trim() ? { organism_id: form.organism_id.trim() } : {}),
  })}>${S('form.submit')}</button>
        <button type="button" class="og-door og-door--quiet" onClick=${onCancel}>${S('form.cancel')}</button>
      </div>
    </div>`;
}

/** One company: who, what it can do right now, and the one thing in its way. */
function OrgRow({ c, onOpen, last }) {
  const tone = c.state === 'live' || c.state === 'live_hidden' ? 'success'
    : c.state === 'blocked_by_switch' ? 'danger' : 'warning';
  const chip = c.can_sign_in ? S('org.canSignIn') : S('org.cannotSignIn');

  return html`
    <div class="adm-sso-org ${last ? 'adm-sso-org--last' : ''}">
      <span>
        <b>${c.name}</b>
        <span class="adm-sso-org-id">${c.id}</span>
        <span class="adm-sso-doms">
          ${(c.domains || []).length
    ? c.domains.map(d => html`<span class="adm-sso-chip">${d}</span>`)
    : html`<span class="adm-sso-chip">${S('org.noDomains')}</span>`}
        </span>
      </span>
      <span>
        <b class="adm-sso-verdict">${S('org.state.' + c.state)}</b>
        <span class="adm-why">${S('org.why.' + c.state, { name: c.name })}</span>
      </span>
      <span>
        <${Badge} type=${tone} label=${chip} />
        <div class="adm-sso-org-when">
          ${c.last_login_at ? S('org.lastLogin', { at: when(c.last_login_at) }) : S('org.noLoginYet')}<br />
          ${c.last_scim_request_at ? S('org.lastScim', { at: when(c.last_scim_request_at) }) : S('org.noScimYet')}
        </div>
      </span>
      <span class="adm-sso-org-acts">
        <button type="button" class="og-door og-door--quiet" onClick=${() => onOpen(c.id)}>${S('org.open')}</button>
        ${c.can_sign_in
    ? html`<a class="og-door og-door--quiet" target="_blank" rel="noopener"
        href=${'/v1/ghii/login/saml/' + encodeURIComponent(c.id)}>${S('org.test')}</a>`
    : html`<span class="og-door og-door--off" title=${S('org.testOffWhy')}>${S('org.test')}</span>`}
      </span>
    </div>`;
}

/** Section 02 with connections. */
export function Organisations({ data, onOpen, onCreate, busy }) {
  const [creating, setCreating] = useState(false);
  const node = data.node;
  const list = data.connections;
  const anyBlocked = list.some(c => c.state === 'blocked_by_switch');

  return html`
    <section class="og-sec" id="adm-sso-02">
      <div class="og-sec-h">
        <h2>${S('orgs.title')}<small>02</small></h2>
        <div class="og-doors">
          ${!creating ? html`
            <button type="button" class="og-door og-door--quiet" disabled=${node.locked}
              onClick=${() => setCreating(true)}>${S('orgs.another')}</button>` : null}
        </div>
      </div>
      <p class="adm-sso-lead">${S('orgs.lead')}</p>

      ${list.map((c, i) => html`<${OrgRow} c=${c} onOpen=${onOpen}
        last=${i === list.length - 1} />`)}

      ${anyBlocked ? html`<p class="adm-sso-note">${S('orgs.testOffNote')}</p>` : null}

      ${creating ? html`
        <div class="adm-sso-newbox">
          <span class="adm-sso-newlabel">${S('form.title')}</span>
          <${CreateForm} busy=${busy} onCancel=${() => setCreating(false)}
            onCreate=${async (body) => { const ok = await onCreate(body); if (ok) setCreating(false); }} />
        </div>` : null}
    </section>`;
}
