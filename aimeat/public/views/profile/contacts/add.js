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
 *   v1.0.0 — 2026-08-30 — Initial (design canvas "AIMEAT Kontaktien sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { ContactPicker } from '/components/ContactPicker.js';
import { c } from './frame.js';

export const RELATIONS = ['colleague', 'toInvite', 'customer', 'following'];

export function addBody(ctx) {
  const road = (key, k, title, body, doors) => html`
    <div class=${`ct-road ${ctx.road === key ? 'on' : ''}`} key=${key} onClick=${() => ctx.setRoad(key)}>
      <span class="ct-road-k">${k}</span><b>${title}</b><p>${body}</p><div class="og-doors">${doors}</div>
    </div>`;
  return html`
    <div class="ct-roads">
      ${road('name', c('roadNameK'), c('roadNameTitle'), c('roadNameBody'), html`<button type="button" class="og-door" onClick=${e => { e.stopPropagation(); ctx.setRoad('name'); }}>${c('roadNameDoor')}</button>`)}
      ${road('person', c('roadPersonK'), c('roadPersonTitle'), c('roadPersonBody'), html`<button type="button" class="og-door" onClick=${e => { e.stopPropagation(); ctx.setRoad('person'); }}>${c('roadPersonDoor')}</button>`)}
      ${road('chat', c('roadChatK'), c('roadChatTitle'), c('roadChatBody'), html`<button type="button" class="og-door" onClick=${e => { e.stopPropagation(); ctx.copyPrompt(); }}>${c('copyPrompt')}</button>`)}
    </div>
    ${ctx.road === 'name' ? roadName(ctx) : ctx.road === 'person' ? html`<div class="ct-form-wrap"><div class="og-label">${c('writeDown')}</div>${personForm(ctx, { withInvite: true })}</div>` : roadChat(ctx)}`;
}

function roadName(ctx) {
  return html`
    <div class="ct-form-wrap">
      <div class="og-label">${c('roadNameTitle')}</div>
      <div class="ct-addrow">
        <${ContactPicker} value=${ctx.who} onChange=${ctx.setWho} onSubmit=${() => ctx.add()} valueMode="full"
          onEmailUnresolved=${ctx.emailUnresolved} placeholder=${t('contacts.addPlaceholder')} disabled=${ctx.busy} />
        <button type="button" class="og-slab" disabled=${ctx.busy || !ctx.who.trim()} onClick=${() => ctx.add()}>${c('add')}</button>
      </div>
      <p class="ct-hint">${c('roadNameHint')}</p>
    </div>`;
}

/** The person form: name, email (checked exactly on blur), relation, tags, links, note, and on
 *  the cover the invitation choice. `f` is ctx.form, edited through ctx.setForm. */
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
  return html`
    <div class="ct-kv ct-form">
      <div class="k">${c('fName')}</div><div class="v"><input class="og-input ct-in--name" value=${f.name} placeholder=${t('contacts.personName')} onInput=${e => set({ name: e.target.value })} /></div>
      <div class="k">${c('fEmail')}</div><div class="v">
        <input class="og-input" type="email" value=${f.email} disabled=${editing && !!editRow?.email} placeholder=${t('contacts.personEmail')} onInput=${e => set({ email: e.target.value })} onBlur=${() => (editing ? null : ctx.resolveForm())} />
        ${editing && editRow?.kind === 'ghii' && !editRow.email ? html`<small class="ct-hint">${c('emailForCardHint')}</small>` : null}
        ${editing || found === null ? null : found?.found ? html`<small class="ct-hint">${c('emailFound', { name: found.display_name || found.owner })}</small>` : found ? html`<small class="ct-hint">${c('emailNotFound')}</small>` : null}
      </div>
      <div class="k">${c('fRelation')}</div><div class="v">
        <div class="og-choice ct-choice">${RELATIONS.map(k => html`<button type="button" key=${k} class=${`og-choice-btn ${f.relation === relWord(k) ? 'on' : ''}`} onClick=${() => set({ relation: f.relation === relWord(k) ? '' : relWord(k) })}>${relWord(k)}</button>`)}<button type="button" class=${`og-choice-btn ${relOther || f.relationOther ? 'on' : ''}`} onClick=${() => set({ relationOther: true, relation: relOther ? f.relation : '' })}>${c('rel.other')}</button></div>
        ${relOther || f.relationOther ? html`<input class="og-input ct-in--short" value=${f.relation} placeholder=${t('contacts.relationPlaceholder')} onInput=${e => set({ relation: e.target.value })} />` : null}
      </div>
      <div class="k">${c('fTags')}</div><div class="v">
        <span class="ct-tags">${(f.tags || []).map(x => html`<button type="button" class="ct-tag ct-tag--x" key=${x} title=${c('remove')} onClick=${() => set({ tags: f.tags.filter(y => y !== x) })}>${x} ✗</button>`)}</span>
        <input class="og-input ct-in--short" value=${f.tagInput || ''} placeholder=${c('tagPlaceholder')} onInput=${e => set({ tagInput: e.target.value })} onKeyDown=${e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } }} onBlur=${addTag} />
      </div>
      <div class="k">${c('fLinks')}</div><div class="v">
        ${links.map((l, i) => html`<div class="ct-linkrow" key=${i}><input class="og-input ct-in--short" value=${l.label || ''} placeholder=${c('linkLabel')} onInput=${e => setLink(i, { label: e.target.value })} /><input class="og-input" value=${l.url || ''} placeholder="https://" onInput=${e => setLink(i, { url: e.target.value })} /><button type="button" class="og-door og-door--quiet" onClick=${() => set({ links: links.filter((_, j) => j !== i) })}>${c('remove')}</button></div>`)}
        ${links.length < 12 ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => set({ links: [...links, { label: '', url: '' }] })}>${c('addLink')}</button>` : null}
        <small class="ct-hint">${c('linksHint')}</small>
      </div>
      <div class="k">${c('fNote')}</div><div class="v"><textarea class="og-textarea" rows="2" value=${f.note} placeholder=${t('contacts.notePlaceholder')} onInput=${e => set({ note: e.target.value })}></textarea></div>
      ${withInvite ? html`
        <div class="k">${c('fInvite')}</div><div class="v">
          <div class="og-choice ct-choice"><button type="button" class=${`og-choice-btn ${!f.invite ? 'on' : ''}`} onClick=${() => set({ invite: false })}>${c('inviteNo')}</button><button type="button" class=${`og-choice-btn ${f.invite ? 'on' : ''}`} disabled=${!!found?.found} onClick=${() => set({ invite: true })}>${c('inviteHere')}</button></div>
          ${f.invite ? html`<input class="og-input" value=${f.inviteMessage || ''} placeholder=${c('inviteMessagePlaceholder')} onInput=${e => set({ inviteMessage: e.target.value })} />` : null}
          <small class="ct-hint">${found?.found ? c('inviteHintFound') : c('inviteHint')}</small>
        </div>` : null}
    </div>
    <div class="og-doors ct-form-doors">
      <button type="button" class="og-slab" disabled=${ctx.busy || !f.name.trim() || !f.email.trim()} onClick=${() => (editing ? ctx.saveEdit() : ctx.savePerson())}>${editing ? c('save') : f.invite ? c('saveAndInvite') : c('save')}</button>
      <button type="button" class="og-door og-door--quiet" onClick=${() => (editing ? ctx.setEditing(false) : ctx.resetForm())}>${t('common.cancel')}</button>
    </div>`;
}

function roadChat(ctx) {
  return html`
    <div class="ct-form-wrap">
      <div class="og-label">${c('roadChatTitle')}</div>
      <p class="ct-prose">${c('chatBody')}</p>
      <div class="og-doors"><button type="button" class="og-slab" onClick=${() => ctx.copyPrompt()}>${c('copyPrompt')}</button></div>
    </div>`;
}
