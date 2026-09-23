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
 *   - Domains — a company's email domains as chips (also used by the detail view)
 * @usage Imported by views/admin/sso-tab.js.
 * @version-history
 *   v1.2.0 — 2026-09-22 — Composed from the shared component set (Section, Steps, ListRow, Field,
 *     Surface): no class of its own, so a theme change reaches it. A field's reason shows while the
 *     field is in use, as on every other form.
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
import { Section, Stack, Steps, ListRow, Field, Chip, Action, Surface, Text } from '/components/poster-parts.js';

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
    <${Section} id="adm-sso-02" title=${S('before.title')} count="02" description=${S('before.lead')}
      actions=${!creating ? html`<${Action} disabled=${node.locked} onClick=${() => setCreating(true)}>${S('now.connect')}<//>` : null}>
      <${Stack}>
        <${Steps} items=${GATHER.map(k => html`<${Stack} density="compact">
          <strong>${S('before.' + k)}</strong>
          <${Text} tone="muted">${S('before.' + k + 'Why')}<//>
        <//>`)} />
        <${Text} kind="caption" tone="muted">${S('before.note')}<//>

        ${creating ? html`<${NewConnection} busy=${busy} onCancel=${() => setCreating(false)} onCreate=${onCreate} />` : null}
      <//>
    <//>`;
}

/** The form in its aside, with the label that names it. */
function NewConnection({ busy, onCancel, onCreate }) {
  return html`
    <${Surface} kind="aside"><${Stack}>
      <${Text} kind="label">${S('form.title')}<//>
      <${CreateForm} busy=${busy} onCancel=${onCancel}
        onCreate=${async (body) => { const ok = await onCreate(body); if (ok) onCancel(); }} />
    <//><//>`;
}

/** The one write this section makes. Refused outright while the page is frozen. */
function CreateForm({ onCreate, onCancel, busy }) {
  const [form, setForm] = useState({ id: '', name: '', domains: '', organism_id: '', listed: true });
  const set = (patch) => setForm({ ...form, ...patch });
  const ready = form.id.trim() && form.name.trim();

  return html`
    <${Stack}>
      <${Field} label=${S('form.id')} value=${form.id} placeholder="contoso" hint=${S('form.idWhy')}
        onInput=${e => set({ id: e.target.value })} />
      <${Field} label=${S('form.name')} value=${form.name} placeholder="Contoso Oy" hint=${S('form.nameWhy')}
        onInput=${e => set({ name: e.target.value })} />
      <${Field} label=${S('form.domains')} value=${form.domains} placeholder="contoso.com, contoso.fi" hint=${S('form.domainsWhy')}
        onInput=${e => set({ domains: e.target.value })} />
      <${Field} label=${S('form.organism')} value=${form.organism_id} placeholder="org-…" hint=${S('form.organismWhy')}
        onInput=${e => set({ organism_id: e.target.value })} />
      <${Field} type="checkbox" label=${S('form.listed')} value=${form.listed} hint=${S('form.listedWhy')}
        onChange=${e => set({ listed: e.target.checked })} />
      <${Stack} direction="wrap" align="center">
        <${Action} disabled=${!ready || busy}
          onClick=${() => onCreate({
    id: form.id.trim(),
    name: form.name.trim(),
    domains: form.domains.split(',').map(s => s.trim()).filter(Boolean),
    login_visibility: form.listed ? 'listed' : 'hidden',
    ...(form.organism_id.trim() ? { organism_id: form.organism_id.trim() } : {}),
  })}>${S('form.submit')}<//>
        <${Action} kind="text" onClick=${onCancel}>${S('form.cancel')}<//>
      <//>
    <//>`;
}

/** The email domains a company may claim, or the chip that says it has none. */
export function Domains({ domains }) {
  return html`<${Stack} direction="wrap" density="compact">
    ${(domains || []).length
    ? domains.map(d => html`<${Chip} key=${d} tone="muted">${d}<//>`)
    : html`<${Chip} tone="muted">${S('org.noDomains')}<//>`}
  <//>`;
}

/** One company: who, what it can do right now, and the one thing in its way. */
function OrgRow({ c, onOpen }) {
  const tone = c.state === 'live' || c.state === 'live_hidden' ? 'success'
    : c.state === 'blocked_by_switch' ? 'danger' : 'warning';
  const chip = c.can_sign_in ? S('org.canSignIn') : S('org.cannotSignIn');

  return html`
    <${ListRow} name=${c.name} detail=${c.id} onOpen=${() => onOpen(c.id)}
      value=${html`<${Stack} density="compact" align="end">
        <${Badge} type=${tone} label=${chip} />
        <${Text} kind="mono" tone="muted">${c.last_login_at ? S('org.lastLogin', { at: when(c.last_login_at) }) : S('org.noLoginYet')}<//>
        <${Text} kind="mono" tone="muted">${c.last_scim_request_at ? S('org.lastScim', { at: when(c.last_scim_request_at) }) : S('org.noScimYet')}<//>
      <//>`}
      actions=${html`
        <${Action} onClick=${() => onOpen(c.id)}>${S('org.open')}<//>
        ${c.can_sign_in
    ? html`<${Action} target="_blank" href=${'/v1/ghii/login/saml/' + encodeURIComponent(c.id)}>${S('org.test')}<//>`
    : html`<${Action} disabled title=${S('org.testOffWhy')}>${S('org.test')}<//>`}`}>
      <${Stack} density="compact">
        <${Domains} domains=${c.domains} />
        <strong>${S('org.state.' + c.state)}</strong>
        <${Text} tone="muted">${S('org.why.' + c.state, { name: c.name })}<//>
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
    <${Section} id="adm-sso-02" title=${S('orgs.title')} count="02" description=${S('orgs.lead')}
      actions=${!creating ? html`<${Action} disabled=${node.locked} onClick=${() => setCreating(true)}>${S('orgs.another')}<//>` : null}>
      <${Stack}>
        <div>${list.map((c) => html`<${OrgRow} key=${c.id} c=${c} onOpen=${onOpen} />`)}</div>

        ${anyBlocked ? html`<${Text} kind="caption" tone="muted">${S('orgs.testOffNote')}<//>` : null}

        ${creating ? html`<${NewConnection} busy=${busy} onCancel=${() => setCreating(false)} onCreate=${onCreate} />` : null}
      <//>
    <//>`;
}
