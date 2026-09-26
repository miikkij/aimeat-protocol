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
 *   v1.10.0 — 2026-09-26 — Every part is a kit component (Roads with the chosen road; the person form as Fields of TextField, Choice, TagInput and TextArea, their labels over the fields; FormActions; Beside for the picker and its Add; Label; Note; Action): the page passes data and writes no class (page group G8).
 *   v1.9.0 — 2026-09-26 — A tag that takes itself off is the removable tag (.tag-removable) and its ✗ the Tag's remove mark (.poster-chip-x): grey, coral while the pointer is on the tag (a unification: Jouni's decision "Remove mark").
 *   v1.8.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.7.0 — 2026-09-25 — The name field is the Text field as it is (.og-input), a unification: the look most tabs use.
 *   v1.6.0 — 2026-09-25 — The paragraph that opens the chat road is the lead (.og-lead), a unification: the look most tabs use.
 *   v1.5.0 — 2026-09-25 — Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.4.0 — 2026-09-25 — Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.3.0 — 2026-09-25 — The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.2.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.1.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   v1.0.0 — 2026-08-30 — Initial (design canvas "AIMEAT Kontaktien sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { ContactPicker } from '/components/ContactPicker.js';
import { Roads, Road } from '/components/Roads.js';
import { Fields, Field, FormActions } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Choice } from '/components/Choice.js';
import { TagInput } from '/components/TagInput.js';
import { Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Space, Beside } from '/components/Layout.js';
import { c } from './frame.js';
import { Hint } from '/components/Hint.js';

export const RELATIONS = ['colleague', 'toInvite', 'customer', 'following'];

/** The chosen road's part under the roads, with its label on a line of its own. */
const part = (label, body) => html`<${Space} above="large"><${Label} block>${label}<//>${body}<//>`;

export function addBody(ctx) {
  // A press on a road chooses it; a press on its door does the door's job (the Road keeps the two apart).
  const road = (key, k, title, body, doors) => html`<${Road} key=${key} chosen=${ctx.road === key} onPick=${() => ctx.setRoad(key)}
    kicker=${k} name=${title} text=${body} doors=${doors} />`;
  return html`
    <${Roads} cols="three">
      ${road('name', c('roadNameK'), c('roadNameTitle'), c('roadNameBody'), html`<${Action} small onClick=${() => ctx.setRoad('name')}>${c('roadNameDoor')}<//>`)}
      ${road('person', c('roadPersonK'), c('roadPersonTitle'), c('roadPersonBody'), html`<${Action} small onClick=${() => ctx.setRoad('person')}>${c('roadPersonDoor')}<//>`)}
      ${road('chat', c('roadChatK'), c('roadChatTitle'), c('roadChatBody'), html`<${Action} small onClick=${() => ctx.copyPrompt()}>${c('copyPrompt')}<//>`)}
    <//>
    ${ctx.road === 'name' ? roadName(ctx) : ctx.road === 'person' ? part(c('writeDown'), personForm(ctx, { withInvite: true })) : roadChat(ctx)}`;
}

function roadName(ctx) {
  return part(c('roadNameTitle'), html`
    <${Beside} above="small" side=${html`<${Loud} control disabled=${ctx.busy || !ctx.who.trim()} onClick=${() => ctx.add()}>${c('add')}<//>`}>
      <${ContactPicker} value=${ctx.who} onChange=${ctx.setWho} onSubmit=${() => ctx.add()} valueMode="full"
        onEmailUnresolved=${ctx.emailUnresolved} placeholder=${t('contacts.addPlaceholder')} disabled=${ctx.busy} />
    <//>
    <${Hint}>${c('roadNameHint')}<//>`);
}

/** The person form: name, email (checked exactly on blur), relation, tags, links, note, and on
 *  the cover the invitation choice. `f` is ctx.form, edited through ctx.setForm. */
export function personForm(ctx, { withInvite = false, editing = false } = {}) {
  const f = ctx.form;
  const set = (patch) => ctx.setForm({ ...f, ...patch });
  const relWord = (k) => c('rel.' + k);
  const relKnown = RELATIONS.map(relWord);
  const relOther = f.relation && !relKnown.includes(f.relation);
  const otherOn = relOther || f.relationOther;
  const links = f.links || [];
  const setLink = (i, patch) => set({ links: links.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const found = ctx.formResolve;
  const editRow = editing && ctx.view.id ? ctx.rowOf(ctx.view.id) : null;
  const emailHint = editing
    ? (editRow?.kind === 'ghii' && !editRow.email ? c('emailForCardHint') : undefined)
    : (found === null || found === undefined ? undefined : found.found ? c('emailFound', { name: found.display_name || found.owner }) : c('emailNotFound'));
  // A press on the chosen relation takes it back; "other" stays chosen and opens its own field.
  const pickRelation = (v) => {
    if (v === 'other') { set({ relationOther: true, relation: relOther ? f.relation : '' }); return; }
    if (v === '') { if (!otherOn) set({ relation: '' }); return; }
    set({ relation: v });
  };
  return html`
    <${Fields}>
      <${TextField} label=${c('fName')} value=${f.name} placeholder=${t('contacts.personName')} onInput=${(v) => set({ name: v })} />
      <${TextField} type="email" label=${c('fEmail')} value=${f.email} disabled=${editing && !!editRow?.email} placeholder=${t('contacts.personEmail')}
        onInput=${(v) => set({ email: v })} onBlur=${() => (editing ? null : ctx.resolveForm())} hint=${emailHint} />
      <${Choice} label=${c('fRelation')} clearable value=${otherOn ? 'other' : f.relation}
        options=${[...RELATIONS.map((k) => [relWord(k), relWord(k)]), ['other', c('rel.other')]]} onChange=${pickRelation} />
      ${otherOn ? html`<${TextField} size="medium" ariaLabel=${c('fRelation')} value=${f.relation} placeholder=${t('contacts.relationPlaceholder')} onInput=${(v) => set({ relation: v })} />` : null}
      <${TagInput} label=${c('fTags')} whole tags=${f.tags || []} onChange=${(tags) => set({ tags })} removeLabel=${c('remove')} placeholder=${c('tagPlaceholder')} />
      <${Field} label=${c('fLinks')} hint=${c('linksHint')} group>
        ${links.map((l, i) => html`
          <${Fields} cols=${2} key=${i}>
            <${TextField} size="medium" ariaLabel=${c('linkLabel')} value=${l.label || ''} placeholder=${c('linkLabel')} onInput=${(v) => setLink(i, { label: v })} />
            <${TextField} ariaLabel=${c('fLinks')} value=${l.url || ''} placeholder="https://" onInput=${(v) => setLink(i, { url: v })}
              actions=${html`<${Action} small soft onClick=${() => set({ links: links.filter((_, j) => j !== i) })}>${c('remove')}<//>`} />
          <//>`)}
        ${links.length < 12 ? html`<${Actions}><${Action} small soft onClick=${() => set({ links: [...links, { label: '', url: '' }] })}>${c('addLink')}<//><//>` : null}
      <//>
      <${TextArea} label=${c('fNote')} rows=${2} value=${f.note} placeholder=${t('contacts.notePlaceholder')} onInput=${(v) => set({ note: v })} />
      ${withInvite ? html`
        <${Choice} label=${c('fInvite')} hint=${found?.found ? c('inviteHintFound') : c('inviteHint')} value=${f.invite ? 'here' : 'no'}
          options=${[{ value: 'no', label: c('inviteNo') }, { value: 'here', label: c('inviteHere'), disabled: !!found?.found }]}
          onChange=${(v) => set({ invite: v === 'here' })}>
        <//>
        ${f.invite ? html`<${TextField} ariaLabel=${c('fInvite')} value=${f.inviteMessage || ''} placeholder=${c('inviteMessagePlaceholder')} onInput=${(v) => set({ inviteMessage: v })} />` : null}` : null}
    <//>
    <${FormActions}>
      <${Loud} control disabled=${ctx.busy || !f.name.trim() || !f.email.trim()} onClick=${() => (editing ? ctx.saveEdit() : ctx.savePerson())}>${editing ? c('save') : f.invite ? c('saveAndInvite') : c('save')}<//>
      <${Action} small soft onClick=${() => (editing ? ctx.setEditing(false) : ctx.resetForm())}>${t('common.cancel')}<//>
    <//>`;
}

function roadChat(ctx) {
  return part(c('roadChatTitle'), html`
    <${Note} kind="lead">${c('chatBody')}<//>
    <${Actions}><${Loud} onClick=${() => ctx.copyPrompt()}>${c('copyPrompt')}<//><//>`);
}
