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
 *
 *   Every part is a library component; the page passes data and writes no class.
 * @structure
 *   - BeforeYouStart — section 02 when nothing is connected
 *   - Organisations — section 02 with connections, and the create form
 * @usage Imported by views/admin/sso-tab.js.
 * @version-history
 *   v2.0.0 — 2026-09-27 — Library components only: Section, the List (the four things to gather as
 *     numbered rows, one row per company), SettingBox, Fields, TextField, Check, FormActions.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.1.0 — 2026-09-13 — Compose existing section headings from shared poster B1.
 *   v1.0.0 — 2026-09-12 — Initial (the Organisation sign-in page in the poster face).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Badge, when } from './shared.js';
import { Section } from '/components/Section.js';
import { List, Row as Item, Name, Desc, Num, Cell, Doors } from '/components/List.js';
import { Figure } from '/components/Figure.js';
import { Action } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { SettingBox } from '/components/Box.js';
import { Fields, FormActions } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { Check } from '/components/Check.js';
import { Stack } from '/components/Layout.js';

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
    <${Section} id="adm-sso-02" num="02" title=${S('before.title')}
      doors=${!creating ? html`
        <${Action} small tone="danger" disabled=${node.locked}
          onClick=${() => setCreating(true)}>${S('now.connect')}<//>` : null}>
      <${Note} kind="lead">${S('before.lead')}<//>
      <${List} cols="n-name-state" keepCols>
        ${GATHER.map((k, i) => html`
          <${Item} key=${k}>
            <${Num}><${Figure} small n=${i + 1} /><//>
            <${Name} desc=${S('before.' + k + 'Why')}>${S('before.' + k)}<//>
            <${Cell} />
          <//>`)}
      <//>
      <${Note} kind="hint">${S('before.note')}<//>

      ${creating ? html`
        <${SettingBox} label=${S('form.title')}>
          <${CreateForm} busy=${busy} onCancel=${() => setCreating(false)}
            onCreate=${async (body) => { const ok = await onCreate(body); if (ok) setCreating(false); }} />
        <//>` : null}
    <//>`;
}

/** The one write this section makes. Refused outright while the page is frozen. */
function CreateForm({ onCreate, onCancel, busy }) {
  const [form, setForm] = useState({ id: '', name: '', domains: '', organism_id: '', listed: true });
  const set = (patch) => setForm({ ...form, ...patch });
  const ready = form.id.trim() && form.name.trim();

  return html`
    <${Stack} gap="large">
      <${Fields}>
        <${TextField} label=${S('form.id')} hint=${S('form.idWhy')} value=${form.id} placeholder="contoso"
          onInput=${v => set({ id: v })} />
        <${TextField} label=${S('form.name')} hint=${S('form.nameWhy')} value=${form.name} placeholder="Contoso Oy"
          onInput=${v => set({ name: v })} />
        <${TextField} label=${S('form.domains')} hint=${S('form.domainsWhy')} value=${form.domains}
          placeholder="contoso.com, contoso.fi" onInput=${v => set({ domains: v })} />
        <${TextField} label=${S('form.organism')} hint=${S('form.organismWhy')} value=${form.organism_id}
          placeholder="org-…" onInput=${v => set({ organism_id: v })} />
      <//>
      <${Check} checked=${form.listed} hint=${S('form.listedWhy')}
        onChange=${checked => set({ listed: checked })}><b>${S('form.listed')}</b><//>
      <${FormActions}>
        <${Action} small disabled=${!ready || busy}
          onClick=${() => onCreate({
    id: form.id.trim(),
    name: form.name.trim(),
    domains: form.domains.split(',').map(s => s.trim()).filter(Boolean),
    login_visibility: form.listed ? 'listed' : 'hidden',
    ...(form.organism_id.trim() ? { organism_id: form.organism_id.trim() } : {}),
  })}>${S('form.submit')}<//>
        <${Action} small soft onClick=${onCancel}>${S('form.cancel')}<//>
      <//>
    <//>`;
}

/** One company: who, what it can do right now, and the one thing in its way. */
function OrgRow({ c, onOpen }) {
  const tone = c.state === 'live' || c.state === 'live_hidden' ? 'success'
    : c.state === 'blocked_by_switch' ? 'danger' : 'warning';
  const chip = c.can_sign_in ? S('org.canSignIn') : S('org.cannotSignIn');

  return html`
    <${Item}>
      <${Name} meta=${c.id} tag=${(c.domains || []).length ? c.domains : S('org.noDomains')}>${c.name}<//>
      <${Desc}><b>${S('org.state.' + c.state)}</b><br />${S('org.why.' + c.state, { name: c.name })}<//>
      <${Cell}>
        <${Stack} gap="tight">
          <${Badge} type=${tone} label=${chip} />
          <${Note} kind="meta" mono>
            ${c.last_login_at ? S('org.lastLogin', { at: when(c.last_login_at) }) : S('org.noLoginYet')}<br />
            ${c.last_scim_request_at ? S('org.lastScim', { at: when(c.last_scim_request_at) }) : S('org.noScimYet')}
          <//>
        <//>
      <//>
      <${Doors}>
        <${Action} small soft onClick=${() => onOpen(c.id)}>${S('org.open')}<//>
        ${c.can_sign_in
    ? html`<${Action} small soft newTab href=${'/v1/ghii/login/saml/' + encodeURIComponent(c.id)}>${S('org.test')}<//>`
    : html`<${Action} small soft disabled title=${S('org.testOffWhy')}>${S('org.test')}<//>`}
      <//>
    <//>`;
}

/** Section 02 with connections. */
export function Organisations({ data, onOpen, onCreate, busy }) {
  const [creating, setCreating] = useState(false);
  const node = data.node;
  const list = data.connections;
  const anyBlocked = list.some(c => c.state === 'blocked_by_switch');

  return html`
    <${Section} id="adm-sso-02" num="02" title=${S('orgs.title')}
      doors=${!creating ? html`
        <${Action} small soft disabled=${node.locked}
          onClick=${() => setCreating(true)}>${S('orgs.another')}<//>` : null}>
      <${Note} kind="lead">${S('orgs.lead')}<//>

      <${List} cols="name-desc-state-doors">
        ${list.map((c) => html`<${OrgRow} key=${c.id} c=${c} onOpen=${onOpen} />`)}
      <//>

      ${anyBlocked ? html`<${Note} kind="hint">${S('orgs.testOffNote')}<//>` : null}

      ${creating ? html`
        <${SettingBox} label=${S('form.title')}>
          <${CreateForm} busy=${busy} onCancel=${() => setCreating(false)}
            onCreate=${async (body) => { const ok = await onCreate(body); if (ok) setCreating(false); }} />
        <//>` : null}
    <//>`;
}
