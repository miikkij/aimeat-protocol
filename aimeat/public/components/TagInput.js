/**
 * @file public/components/TagInput.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A field that holds a list of words as tags (C5 of the component plan, the Field
 *   family): the tags written so far, each a Tag with its remove mark (components/Mark.js, Jouni's
 *   decision "Remove mark"), and the Text field after them where the next word is typed. It shows at
 *   once how what is typed divides into words, where a comma-separated field would not. A page passes
 *   the tags and what happens; it never writes a class. Given a `label` (or a `hint` or a `message`)
 *   it stands in a Field (components/Field.js) whose label names the set.
 *
 *   Keys: Enter or a comma adds the word; Backspace in an empty field takes the last tag off; leaving
 *   the field adds what is in it; Escape empties the field (and, with `addLabel`, closes it).
 *   `tags`, `onChange(tags)`; or `onAdd(tag)` and `onRemove(tag)` when each change is its own save.
 *   Named options: `lowercase` (a tag is kept in small letters), `adder` (a + button after the field,
 *   for a person who does not know Enter adds), `addLabel` (the field is closed until the "+ add"
 *   action beside the tags opens it), `whole` (a press anywhere on a tag takes it off), `removeLabel`
 *   (the remove mark's name for a screen reader and the tooltip), `placeholder`, `disabled`,
 *   `ariaLabel` when it has no `label`.
 * @structure TagInput(props)
 * @usage html`<${TagInput} label=${label('fieldInterests')} tags=${form.interests}
 *          onChange=${(tags) => setForm((f) => ({ ...f, interests: tags }))} placeholder=${t('organisms.addTag')} />`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: views/profile/shared.js TagInput (v1.8.0) moved here with its keys,
 *     and the tag fields of Contacts, the memory file form and an agent's card as its options
 *     (component plan C5).
 */
import { h } from 'preact';
import { useState, useRef, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Mark } from '/components/Mark.js';
import { Action, Icon } from '/components/Action.js';
import { useFieldIds, inField, hasFieldWords } from '/components/Field.js';

const html = htm.bind(h);

export function TagInput(props) {
  const { id, tags = [], onChange, onAdd, onRemove, placeholder, lowercase, adder, addLabel, whole, removeLabel,
    disabled, ariaLabel } = props;
  const ids = useFieldIds(id);
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(!addLabel);
  const field = useRef(null);
  useEffect(() => { if (addLabel && open) field.current?.focus(); }, [addLabel, open]);

  const add = () => {
    let v = draft.trim().replace(/,+$/, '').trim();
    if (lowercase) v = v.toLowerCase();
    setDraft('');
    if (!v || tags.includes(v)) return false;
    if (onAdd) onAdd(v); else onChange?.([...tags, v]);
    return true;
  };
  const remove = (tag) => { if (onRemove) onRemove(tag); else onChange?.(tags.filter((x) => x !== tag)); };
  const close = () => { setDraft(''); if (addLabel) setOpen(false); };
  const onKey = (e) => {
    if (e.isComposing) return;
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Backspace' && !draft && tags.length) remove(tags[tags.length - 1]);
  };
  const onLeave = () => { if (draft.trim()) add(); else if (addLabel) setOpen(false); };
  const what = removeLabel || t('field.remove');
  const named = hasFieldWords(props) && props.label;

  const control = html`
    <div class="tag-input" role="group" aria-label=${named ? undefined : ariaLabel} aria-labelledby=${named ? ids.labelId : undefined}>
      ${tags.map((tag) => html`<${Mark} key=${tag} removeLabel=${what} whole=${whole}
        onRemove=${disabled ? undefined : () => remove(tag)}>${tag}<//>`)}
      ${open ? html`
        <input id=${ids.id} ref=${field} class="og-input tag-input-field" type="text" value=${draft} placeholder=${placeholder ?? t('organisms.addTag')}
          disabled=${disabled} aria-label=${named ? undefined : ariaLabel} aria-describedby=${props.hint ? ids.hintId : undefined}
          onInput=${(e) => setDraft(e.currentTarget.value)} onKeyDown=${onKey} onBlur=${onLeave} />
        ${adder ? html`<${Icon} small label=${t('common.add')} disabled=${disabled || !draft.trim()} onClick=${add}>+<//>` : null}`
      : html`<${Action} small soft disabled=${disabled} onClick=${() => setOpen(true)}>+ ${addLabel}<//>`}
    </div>`;
  return inField(props, ids, control, true);
}

export default TagInput;
