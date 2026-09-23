/**
 * @file public/views/profile/contacts/add.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Add fold of the Contacts cover: three roads to the same book. A name or an
 *   email (the picker searches contacts and the member directory; an email is checked exactly,
 *   and a miss turns into the person form with the address filled in); writing a person down
 *   with everything the owner knows and an invitation to join here in the same move; and the
 *   prompt for a chat connected over MCP, which adds, finds, checks and invites with the same
 *   rules. The same form edits a person on their page (personForm).
 * @structure addBody · roads · roadName · personForm · roadChat
 * @usage import { addBody, personForm } from './add.js';
 * @version-history
 *   2026-09-22 -- Composed from the shared set: the roads are boxes in columns (the chosen one on
 *     the sun), the form is Fields with tab-style choices; the email check and the tag commit run
 *     on the field's change event, which fires as the field is left, as the blur did.
 *   v1.0.0 — 2026-08-30 — Initial (design canvas "AIMEAT Kontaktien sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { ContactPicker } from '/components/ContactPicker.js';
import { Columns, Stack, Surface, Text, Action, Field, Chip } from '/components/poster-parts.js';
import { c } from './frame.js';

export const RELATIONS = ['colleague', 'toInvite', 'customer', 'following'];

export function addBody(ctx) {
  const road = (key, k, title, body, door) => html`
    <${Surface} kind="box" tone=${ctx.road === key ? 'sun' : 'plain'} density="compact" key=${key} onClick=${() => ctx.setRoad(key)}>
      <${Stack} density="compact">
        <${Text} kind="mono">${k}<//><${Text} kind="heading">${title}<//><${Text}>${body}<//>
        <${Stack} direction="wrap">${door}<//>
      <//>
    <//>`;
  return html`<${Stack}>
    <${Columns} layout="thirds" collapse="900" density="compact">
      ${road('name', c('roadNameK'), c('roadNameTitle'), c('roadNameBody'), html`<${Action} onClick=${e => { e.stopPropagation(); ctx.setRoad('name'); }}>${c('roadNameDoor')}<//>`)}
      ${road('person', c('roadPersonK'), c('roadPersonTitle'), c('roadPersonBody'), html`<${Action} onClick=${e => { e.stopPropagation(); ctx.setRoad('person'); }}>${c('roadPersonDoor')}<//>`)}
      ${road('chat', c('roadChatK'), c('roadChatTitle'), c('roadChatBody'), html`<${Action} onClick=${e => { e.stopPropagation(); ctx.copyPrompt(); }}>${c('copyPrompt')}<//>`)}
    <//>
    ${ctx.road === 'name' ? roadName(ctx) : ctx.road === 'person' ? html`<${Stack}><${Text} kind="label">${c('writeDown')}<//>${personForm(ctx, { withInvite: true })}<//>` : roadChat(ctx)}
  <//>`;
}

function roadName(ctx) {
  return html`<${Stack}>
    <${Text} kind="label">${c('roadNameTitle')}<//>
    <${Stack} direction="horizontal" align="end">
      <${ContactPicker} value=${ctx.who} onChange=${ctx.setWho} onSubmit=${() => ctx.add()} valueMode="full"
        onEmailUnresolved=${ctx.emailUnresolved} placeholder=${t('contacts.addPlaceholder')} disabled=${ctx.busy} />
      <${Action} kind="primary" disabled=${ctx.busy || !ctx.who.trim()} onClick=${() => ctx.add()}>${c('add')}<//>
    <//>
    <${Text} kind="caption" tone="muted">${c('roadNameHint')}<//>
  <//>`;
}

/** The person form: name, email (checked exactly when the field is left), relation, tags, links,
 *  note, and on the cover the invitation choice. `f` is ctx.form, edited through ctx.setForm. */
export function personForm(ctx, { withInvite = false, editing = false } = {}) {
  const f = ctx.form;
  const set = (patch) => ctx.setForm({ ...f, ...patch });
  const relWord = (k) => c('rel.' + k);
  const relKnown = RELATIONS.map(relWord);
  const relOther = f.relation && !relKnown.includes(f.relation);
  const addTag = () => { const x = (f.tagInput || '').trim(); if (!x) return; set({ tags: [...new Set([...(f.tags || []), x])], tagInput: '' }); };
  const links = f.links || [];
  const setLink = (i, patch) => set({ links: links.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const found = ctx.formResolve;
  const editRow = editing && ctx.view.id ? ctx.rowOf(ctx.view.id) : null;
  const hint = (text) => html`<${Text} kind="caption" tone="muted">${text}<//>`;
  const choice = (on, label, onClick, disabled) => html`<${Action} kind="tab" semantics="radio" selected=${on} disabled=${disabled} onClick=${onClick}>${label}<//>`;
  return html`<${Stack}>
    <${Field} label=${c('fName')} value=${f.name} placeholder=${t('contacts.personName')} onInput=${e => set({ name: e.target.value })} />
    <${Stack} density="compact">
      <${Field} label=${c('fEmail')} type="email" value=${f.email} disabled=${editing && !!editRow?.email} placeholder=${t('contacts.personEmail')} onInput=${e => set({ email: e.target.value })} onChange=${() => (editing ? null : ctx.resolveForm())} />
      ${editing && editRow?.kind === 'ghii' && !editRow.email ? hint(c('emailForCardHint')) : null}
      ${editing || found === null ? null : found?.found ? hint(c('emailFound', { name: found.display_name || found.owner })) : found ? hint(c('emailNotFound')) : null}
    <//>
    <${Stack} density="compact">
      <${Text} kind="label">${c('fRelation')}<//>
      <${Stack} direction="wrap" role="radiogroup" label=${c('fRelation')}>${RELATIONS.map(k => html`<span key=${k}>${choice(f.relation === relWord(k), relWord(k), () => set({ relation: f.relation === relWord(k) ? '' : relWord(k) }))}</span>`)}${choice(!!(relOther || f.relationOther), c('rel.other'), () => set({ relationOther: true, relation: relOther ? f.relation : '' }))}<//>
      ${relOther || f.relationOther ? html`<${Field} value=${f.relation} placeholder=${t('contacts.relationPlaceholder')} onInput=${e => set({ relation: e.target.value })} />` : null}
    <//>
    <${Stack} density="compact">
      ${(f.tags || []).length ? html`<${Stack} direction="wrap" density="compact">${f.tags.map(x => html`<${Action} kind="text" key=${x} title=${c('remove')} onClick=${() => set({ tags: f.tags.filter(y => y !== x) })}><${Chip}>${x} ✗<//><//>`)}<//>` : null}
      <${Field} label=${c('fTags')} value=${f.tagInput || ''} placeholder=${c('tagPlaceholder')} onInput=${e => set({ tagInput: e.target.value })} onKeyDown=${e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } }} onChange=${addTag} />
    <//>
    <${Stack} density="compact">
      <${Text} kind="label">${c('fLinks')}<//>
      ${links.map((l, i) => html`<${Stack} key=${i} direction="horizontal" align="end">
        <${Field} value=${l.label || ''} placeholder=${c('linkLabel')} onInput=${e => setLink(i, { label: e.target.value })} />
        <${Field} value=${l.url || ''} placeholder="https://" onInput=${e => setLink(i, { url: e.target.value })} />
        <${Action} onClick=${() => set({ links: links.filter((_, j) => j !== i) })}>${c('remove')}<//>
      <//>`)}
      ${links.length < 12 ? html`<${Stack} direction="wrap"><${Action} onClick=${() => set({ links: [...links, { label: '', url: '' }] })}>${c('addLink')}<//><//>` : null}
      ${hint(c('linksHint'))}
    <//>
    <${Field} label=${c('fNote')} type="textarea" rows=${2} value=${f.note} placeholder=${t('contacts.notePlaceholder')} onInput=${e => set({ note: e.target.value })} />
    ${withInvite ? html`<${Stack} density="compact">
      <${Text} kind="label">${c('fInvite')}<//>
      <${Stack} direction="wrap" role="radiogroup" label=${c('fInvite')}>${choice(!f.invite, c('inviteNo'), () => set({ invite: false }))}${choice(!!f.invite, c('inviteHere'), () => set({ invite: true }), !!found?.found)}<//>
      ${f.invite ? html`<${Field} value=${f.inviteMessage || ''} placeholder=${c('inviteMessagePlaceholder')} onInput=${e => set({ inviteMessage: e.target.value })} />` : null}
      ${hint(found?.found ? c('inviteHintFound') : c('inviteHint'))}
    <//>` : null}
    <${Stack} direction="wrap" align="center">
      <${Action} kind="primary" disabled=${ctx.busy || !f.name.trim() || !f.email.trim()} onClick=${() => (editing ? ctx.saveEdit() : ctx.savePerson())}>${editing ? c('save') : f.invite ? c('saveAndInvite') : c('save')}<//>
      <${Action} onClick=${() => (editing ? ctx.setEditing(false) : ctx.resetForm())}>${t('common.cancel')}<//>
    <//>
  <//>`;
}

function roadChat(ctx) {
  return html`<${Stack} align="start">
    <${Text} kind="label">${c('roadChatTitle')}<//>
    <${Text}>${c('chatBody')}<//>
    <${Action} kind="primary" onClick=${() => ctx.copyPrompt()}>${c('copyPrompt')}<//>
  <//>`;
}
