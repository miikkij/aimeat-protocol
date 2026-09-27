/**
 * @file cors-tab.form.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sections 02 and 03 of the admin CORS page: the people, then the agents, with a list
 *   of their own. Each is one row (who, the origins as code chips, Edit and Clear), the row opens
 *   into an editor in place, and under the rows the give-a-list form: a picker that narrows as you
 *   type over everyone who has no list yet, an origins field, the quick-add chips, and the one loud
 *   action. The rows come from the overview; the picker's candidates come from the admin shell's
 *   lists, which already carry every person and agent. Every part is a library component; the page
 *   passes data and writes no class.
 * @structure parseOrigins · QuickAdd · OriginsField · InlineEditor · GiveForm · ListSection
 * @version-history
 *   v2.0.0 — 2026-09-27 — Library components only (admin group G2): the Section, the List (cut
 *     name-desc-doors) for the rows, TextField for the origins, the library's PickField for the
 *     picker (moved out of this file), Mark buttons for the quick-add chips, Loud and Action for the
 *     buttons. The page writes no class.
 *   v1.1.0 -- 2026-09-13 -- Compose each list section heading from the shared B1 shape.
 *   v1.0.0 — 2026-09-08 — Initial (the CORS page in the poster face).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Section } from '/components/Section.js';
import { List, Row, Name, Desc, Doors } from '/components/List.js';
import { Action, Loud } from '/components/Action.js';
import { Mark, Label, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { TextField } from '/components/TextField.js';
import { Fields, FormActions } from '/components/Field.js';
import { PickField } from '/components/PickField.js';
import { Row as Line, Stack, Space } from '/components/Layout.js';

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
  return html`
    <${Line} wrap above="medium">
      <${Note} kind="hint" inline>${C('form.quick')}<//>
      ${COMMON_ORIGINS.map(o => html`<${Mark} key=${o} onClick=${() => add(o)}>${o}<//>`)}
    <//>`;
}

function OriginsField({ value, onInput, onEnter }) {
  return html`<${TextField} code value=${value} placeholder=${C('form.origins')} ariaLabel=${C('form.origins')}
    onInput=${onInput} onEnter=${onEnter ? (v, e) => { e.preventDefault(); onEnter(); } : undefined} />`;
}

function InlineEditor({ origins, onSave, onCancel }) {
  const [val, setVal] = useState(origins.join(', '));
  const save = () => { const arr = parseOrigins(val); if (arr.length) onSave(arr); };
  return html`
    <${Stack} gap="none">
      <${OriginsField} value=${val} onInput=${setVal} onEnter=${save} />
      <${QuickAdd} value=${val} onChange=${setVal} />
      <${Space} above="large">
        <${FormActions}>
          <${Loud} control onClick=${save} disabled=${parseOrigins(val).length === 0}>${C('form.save')}<//>
          <${Action} small soft onClick=${onCancel}>${C('form.cancel')}<//>
        <//>
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
  return html`
    <${Space} above="section">
      <${Label} block>${C(kind + '.give')}<//>
      <${Fields} cols=${2}>
        <${PickField} key=${formKey} keep max=${PICK_MAX} items=${candidates} placeholder=${C(kind + '.pick')}
          ariaLabel=${C(kind + '.pick')} emptyLabel=${C('form.allListed')} noMatchLabel=${C('form.noMatch')}
          onPick=${(c) => setPicked(c.id)} onType=${() => { if (picked) setPicked(null); }} />
        <${OriginsField} value=${val} onInput=${setVal} onEnter=${save} />
      <//>
      <${QuickAdd} value=${val} onChange=${setVal} />
      <${Space} above="large">
        <${FormActions}>
          <${Loud} control onClick=${save} disabled=${!ready}>${C('form.save')}<//>
          <${Note} kind="hint" inline>${C('form.rule')}<//>
        <//>
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
  return html`
    <${Section} id=${'adm-cors-' + number} num=${number} title=${C(kind + '.title')}
      doors=${html`<${Action} small soft onClick=${onDoor}>${door}<//>`}>
      <${Note} kind="lead">${C(kind + '.lead')}<//>
      <${List} cols="name-desc-doors" empty=${C(kind + '.none', { n: total })}>
        ${rows.map(r => html`
          <${Row} key=${r.id}>
            <${Name} meta=${r.sub}>${r.name}<//>
            <${Desc}>
              ${editing === r.id
                ? html`<${InlineEditor} origins=${r.origins} onSave=${arr => saveRow(r.id, arr)} onCancel=${() => setEditing(null)} />`
                : html`<${Line} wrap gap="tight">${r.origins.map(o => html`<${Code} key=${o}>${o}<//>`)}<//>`}
            <//>
            <${Doors}>
              ${editing !== r.id ? html`
                <${Action} small row onClick=${() => setEditing(r.id)}>${C('form.edit')}<//>
                <${Action} small row tone="danger" onClick=${() => onClear(r.id)}>${C('form.clear')}<//>` : null}
            <//>
          <//>`)}
      <//>
      <${GiveForm} kind=${kind} candidates=${candidates} onSave=${onSave} />
    <//>`;
}
