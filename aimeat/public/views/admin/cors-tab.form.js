/**
 * @file cors-tab.form.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sections 02 and 03 of the admin CORS page: the people, then the agents, with a list
 *   of their own. Each is one row (who, the origins as code chips, Edit and Clear), the row opens
 *   into an underline editor in place, and under the rows the give-a-list form: a picker that
 *   narrows as you type over everyone who has no list yet, an origins field, the quick-add chips,
 *   and the one ink slab. The rows come from the overview; the picker's candidates come from the
 *   admin shell's lists, which already carry every person and agent.
 * @structure parseOrigins · QuickAdd · OriginsField · PickField · InlineEditor · GiveForm · ListSection
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set: list rows with the origins as
 *     chips, shared fields, quick-add origins as text actions, the picker's matches as compact list
 *     rows under its field. The set has no floating suggestion list, so the matches open in place
 *     under the field instead of over the page; the page's own sheet (admin-cors.css) is gone.
 *   v1.1.0 -- 2026-09-13 -- Compose each list section heading from the shared B1 shape.
 *   v1.0.0 — 2026-09-08 — Initial (the CORS page in the poster face).
 */
import { h } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Section, Columns, Stack, ListRow, Field, Action, Chip, Text } from '/components/poster-parts.js';

const html = htm.bind(h);
const C = (key, params) => t('admin.cors.' + key, params);

/** The origins the chips offer: the three local ports a developer runs, a stand-in domain, the wildcard. */
const COMMON_ORIGINS = ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080', 'https://yourdomain.com', '*'];
/** How many matches the picker shows at once. */
const PICK_MAX = 8;

/** A comma-separated field as the list the door takes. */
export function parseOrigins(text) {
  return String(text || '').split(',').map(s => s.trim()).filter(Boolean);
}

function QuickAdd({ value, onChange }) {
  const add = (origin) => {
    const parts = parseOrigins(value);
    if (!parts.includes(origin)) parts.push(origin);
    onChange(parts.join(', '));
  };
  return html`<${Stack} direction="wrap" align="center" density="compact">
    <${Text} kind="caption" tone="muted">${C('form.quick')}<//>
    ${COMMON_ORIGINS.map(o => html`<${Action} key=${o} kind="text" onClick=${() => add(o)}>${o}<//>`)}
  <//>`;
}

function OriginsField({ value, onInput, onEnter }) {
  return html`<${Field} ariaLabel=${C('form.origins')} value=${value} placeholder=${C('form.origins')} spellCheck=${false}
    passwordManager=${false}
    onInput=${e => onInput(e.target.value)}
    onKeyDown=${e => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(); } }} />`;
}

/**
 * A field that narrows as you type. `candidates` are { id, name, sub }; a pick fills the field with
 * the name and hands the id up; typing again lets the id go, so what is saved is always something
 * that was picked, never something that was typed.
 */
function PickField({ candidates, placeholder, picked, onPick }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const q = text.trim().toLowerCase();
  const matches = useMemo(() => {
    const all = q ? candidates.filter(c => (c.name + ' ' + c.sub).toLowerCase().includes(q)) : candidates;
    return all.slice(0, PICK_MAX);
  }, [candidates, q]);
  const pick = (c) => { setText(c.name); onPick(c.id); setOpen(false); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi(h => Math.min(h + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { if (open && matches[hi]) { e.preventDefault(); pick(matches[hi]); } }
    else if (e.key === 'Escape') { setOpen(false); }
  };
  // The field has no focus prop of its own; the wrapper hears the focus arrive, which opens the list
  // as it did before. A match is chosen on mouse-down so the field's blur does not close it first.
  return html`<div onFocusIn=${() => setOpen(true)}>
    <${Field} ariaLabel=${placeholder} value=${text} placeholder=${placeholder} autoComplete="off" passwordManager=${false}
      onInput=${e => { setText(e.target.value); setHi(0); setOpen(true); if (picked) onPick(null); }}
      onBlur=${() => setTimeout(() => setOpen(false), 120)}
      onKeyDown=${onKey} />
    ${open && html`<div role="listbox" aria-label=${placeholder} onMouseDown=${e => e.preventDefault()}>
      ${candidates.length === 0 ? html`<${Text} tone="muted">${C('form.allListed')}<//>`
        : matches.length === 0 ? html`<${Text} tone="muted">${C('form.noMatch')}<//>`
        : matches.map((c, i) => html`<${ListRow} key=${c.id} density="compact" selected=${i === hi}
            name=${c.name} detail=${c.sub} onOpen=${() => pick(c)} />`)}
    </div>`}
  </div>`;
}

function InlineEditor({ origins, onSave, onCancel }) {
  const [val, setVal] = useState(origins.join(', '));
  const save = () => { const arr = parseOrigins(val); if (arr.length) onSave(arr); };
  return html`<${Stack} density="compact">
    <${OriginsField} value=${val} onInput=${setVal} onEnter=${save} />
    <${QuickAdd} value=${val} onChange=${setVal} />
    <${Stack} direction="horizontal" align="center">
      <${Action} kind="primary" onClick=${save} disabled=${parseOrigins(val).length === 0}>${C('form.save')}<//>
      <${Action} onClick=${onCancel}>${C('form.cancel')}<//>
    <//>
  <//>`;
}

function GiveForm({ kind, candidates, onSave }) {
  const [picked, setPicked] = useState(null);
  const [val, setVal] = useState('');
  const [formKey, setFormKey] = useState(0);
  const ready = !!picked && parseOrigins(val).length > 0;
  const save = async () => {
    if (!ready) return;
    const ok = await onSave(picked, parseOrigins(val));
    if (ok) { setPicked(null); setVal(''); setFormKey(k => k + 1); }
  };
  return html`<${Stack}>
    <${Text} kind="label">${C(kind + '.give')}<//>
    <${Columns} layout="trailing" collapse=${600}>
      <${PickField} key=${formKey} candidates=${candidates} placeholder=${C(kind + '.pick')} picked=${picked} onPick=${setPicked} />
      <${OriginsField} value=${val} onInput=${setVal} onEnter=${save} />
    <//>
    <${QuickAdd} value=${val} onChange=${setVal} />
    <${Stack} direction="wrap" align="center">
      <${Action} kind="primary" onClick=${save} disabled=${!ready}>${C('form.save')}<//>
      <${Text} kind="caption" tone="muted">${C('form.rule')}<//>
    <//>
  <//>`;
}

/**
 * One section: the rows with a list, the editor in place, the form under them.
 * `rows` are { id, name, sub, origins }; `candidates` are { id, name, sub } with no list yet.
 * `onSave(id, origins)` resolves true when saved; `onClear(id)` asks and clears.
 */
export function ListSection({ kind, number, rows, total, candidates, onSave, onClear, door, onDoor }) {
  const [editing, setEditing] = useState(null);
  const saveRow = async (id, arr) => { if (await onSave(id, arr)) setEditing(null); };
  return html`<${Section} id=${'adm-cors-' + number} title=${C(kind + '.title')} count=${number} description=${C(kind + '.lead')}
    actions=${html`<${Action} onClick=${onDoor}>${door}<//>`}>
    <${Stack}>
      <div>
        ${rows.length === 0 ? html`<${Text} tone="muted">${C(kind + '.none', { n: total })}<//>` : null}
        ${rows.map((r) => html`<${ListRow} key=${r.id} name=${r.name} detail=${r.sub}
          value=${editing === r.id ? null : html`<${Stack} direction="wrap" align="center" density="compact">${r.origins.map(o => html`<${Chip} key=${o}>${o}<//>`)}<//>`}
          actions=${editing !== r.id ? html`
            <${Action} onClick=${() => setEditing(r.id)}>${C('form.edit')}<//>
            <${Action} tone="danger" onClick=${() => onClear(r.id)}>${C('form.clear')}<//>` : null}>
          ${editing === r.id ? html`<${InlineEditor} origins=${r.origins} onSave=${arr => saveRow(r.id, arr)} onCancel=${() => setEditing(null)} />` : null}
        <//>`)}
      </div>
      <${GiveForm} kind=${kind} candidates=${candidates} onSave=${onSave} />
    <//>
  <//>`;
}
