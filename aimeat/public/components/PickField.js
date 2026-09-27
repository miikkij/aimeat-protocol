/**
 * @file public/components/PickField.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A field that narrows a list as you type and picks one thing from it: the Text field,
 *   and under it, while it has the focus, the things that match what is typed, each with its name
 *   and a grey line under it. The arrow keys move through the matches, Enter picks the one that is
 *   lit, Escape shuts the list; a press on a match picks it. A page passes the things as data and
 *   named options; it never writes a class. The field is TextField (form-fields.css); the list's look
 *   is css/components/pick-field.css (main's CORS and Portal pickers, .adm-cors-pick and .adm-pt-pick).
 *
 *   PickField({ items, onPick, onType, keep, search, match, max, placeholder, ariaLabel, emptyLabel,
 *     noMatchLabel, label, hint })
 *   - items: [{ id, name, sub, disabled }]; a disabled one is shown and cannot be picked (a part the
 *     page already carries as many times as it may).
 *   - onPick(item): the pick. `keep`: the field then shows the picked name, and typing again calls
 *     `onType(text)` so the page can let the pick go (what is saved is always a thing that was picked,
 *     never words that were typed); without `keep` the field empties after a pick.
 *   - search: the field is a search (the magnifier's meaning; Escape empties it). Otherwise the mark
 *     at the field's end says that it opens a list.
 *   - match(item, q): whether an item matches the lower-case words typed; by default its name, sub
 *     and id. max: how many matches show at once (8).
 *   - emptyLabel: the line when there is nothing to pick at all; noMatchLabel: when nothing matches.
 * @structure PickField(props)
 * @usage html`<${PickField} keep items=${people} placeholder=${x('pick')} onPick=${(p) => setWho(p?.id ?? null)}
 *          onType=${() => setWho(null)} emptyLabel=${x('allListed')} noMatchLabel=${x('noMatch')} />`
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial: the CORS page's person and agent picker and the Portal page's
 *     "add a part" picker (main's .adm-cors-pick and .adm-pt-pick, the same field twice) as one
 *     general component, with the CORS picker's keyboard for both (admin group G2).
 */
import { h } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import htm from 'htm';
import { TextField } from '/components/TextField.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');

const byWords = (item, q) => `${item.name ?? ''} ${item.sub ?? ''} ${item.id ?? ''}`.toLowerCase().includes(q);

/** @param {{ items: Array<{ id: any, name: any, sub?: any, disabled?: boolean }>, onPick: (item: any) => void,
 *   onType?: (text: string) => void, keep?: boolean, search?: boolean, match?: (item: any, q: string) => boolean,
 *   max?: number, placeholder?: string, ariaLabel?: string, emptyLabel?: any, noMatchLabel?: any,
 *   label?: any, hint?: any }} props */
export function PickField({ items = [], onPick, onType, keep, search, match = byWords, max = 8, placeholder, ariaLabel,
  emptyLabel, noMatchLabel, label, hint }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [lit, setLit] = useState(0);
  const q = text.trim().toLowerCase();
  const matches = useMemo(() => (q ? items.filter((it) => match(it, q)) : items).slice(0, max), [items, q, match, max]);

  const pick = (it) => {
    if (!it || it.disabled) return;
    setText(keep ? String(it.name ?? '') : '');
    setOpen(false);
    onPick(it);
  };
  const type = (v) => { setText(v); setLit(0); setOpen(true); onType?.(v); };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setLit((i) => Math.min(i + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setLit((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { if (open && matches[lit]) { e.preventDefault(); pick(matches[lit]); } }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return html`
    <div class="pick-field">
      <${TextField} value=${text} search=${search} placeholder=${placeholder} ariaLabel=${ariaLabel}
        label=${label} hint=${hint} autoComplete="off"
        onInput=${type} onFocus=${() => setOpen(true)} onBlur=${() => setTimeout(() => setOpen(false), 120)}
        onKeyDown=${onKeyDown} />
      ${search ? null : html`<svg class="pick-field-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"></path></svg>`}
      ${open ? html`
        <div class="pick-field-list" role="listbox">
          ${items.length === 0 ? html`<div class="pick-field-none">${emptyLabel}</div>`
            : matches.length === 0 ? html`<div class="pick-field-none">${noMatchLabel}</div>`
            : matches.map((it, i) => html`
              <button type="button" key=${it.id} role="option" aria-selected=${i === lit ? 'true' : 'false'}
                class=${cx('pick-field-item', i === lit && 'is-lit')} disabled=${it.disabled}
                onMouseDown=${(e) => { e.preventDefault(); pick(it); }}>
                <b>${it.name}</b>${it.sub !== undefined && it.sub !== null && it.sub !== '' ? html`<small>${it.sub}</small>` : null}
              </button>`)}
        </div>` : null}
    </div>`;
}

export default PickField;
