/**
 * @file public/views/admin/portal-tab.parts.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The parts of one page, as rows an operator can read and move (design canvas
 *   "AIMEAT Admin Portal", section 02). A row carries the part's NUMBER, which is its place on the
 *   page and the same number the preview marks it with; the two move arrows; what the part is, in
 *   the words the node sends; the settings it carries, printed as chips so Edit is not the only way
 *   to see what was set; and the three things you can do to it. A hidden part keeps its row, greyed,
 *   and takes no number, because it takes no place on the page.
 *
 *   THE FORM STILL DRAWS ITSELF FROM THE NODE. Every part, its words and its settings come from
 *   GET /v1/site/blocks. Nothing here names a block or restates what one is; a hand-built list would
 *   drift from the registry the day a part is added, and the operator would meet the difference as
 *   a refusal.
 *
 *   Every part is a library component; the page passes data and writes no class.
 * @structure SettingField · PartRow · PartsList · AddPart
 * @usage html`<${PartsList} blocks=${blocks} catalog=${catalog} ... />`
 * @version-history
 *   v2.0.0 — 2026-09-27 — Library components only (admin group G2): the List (cut n-name-doors) with
 *     its opened Panel for the parts, a count Mark for the number, the library's MoveButtons for the arrows,
 *     Check, Select, TextField and TextArea for the settings, the library's PickField for "add a
 *     part", Mark buttons for the quick picks.
 *   v1.0.0 — 2026-09-12 — Initial, with the page's editor rewritten around it.
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Badge } from './shared.js';
import { List, Row, Name, Cell, Doors } from '/components/List.js';
import { Action } from '/components/Action.js';
import { MoveButtons } from '/components/MoveButtons.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Check } from '/components/Check.js';
import { Select } from '/components/Select.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Field } from '/components/Field.js';
import { PickField } from '/components/PickField.js';
import { Row as Line, Stack, Space } from '/components/Layout.js';

const html = htm.bind(h);
const P = (key, params) => t('admin.portal.' + key, params);

/** A part's own name within the page. The id unless that is taken, and then id-2, id-3… */
export function freeKey(blocks, id) {
  const used = new Set(blocks.map(b => b.key));
  if (!used.has(id)) return id;
  for (let n = 2; n < 100; n++) if (!used.has(`${id}-${n}`)) return `${id}-${n}`;
  return `${id}-${Date.now()}`;
}

/** The name an operator reads for a part: the translation when there is one, the raw id otherwise. */
export function partName(def, id) {
  if (!def) return id;
  const label = t(def.label_key);
  return label !== def.label_key ? label : id;
}

/**
 * What the part IS, in the reader's language. The node sends one sentence per part, in English,
 * because the registry is the same on every node and the AI prompt is generated from it. The
 * operator reads the page in their own language, so the translation wins where there is one and
 * the node's own sentence is the fallback: surface.blocks.<id>.summary, beside the label.
 */
export function partSummary(def) {
  if (!def) return P('parts.unknown');
  const key = String(def.label_key).replace(/\.label$/, '.summary');
  const words = t(key);
  return words !== key ? words : (def.summary ?? P('parts.unknown'));
}

/** One setting, drawn from what the part declared it to be. */
function SettingField({ name, def, value, onChange }) {
  if (def.type === 'boolean') {
    return html`<${Check} checked=${value === undefined ? def.default === true : !!value} hint=${def.description}
      onChange=${(on) => onChange(on)}>${name}<//>`;
  }
  if (def.type === 'enum') {
    return html`<${Select} label=${name} hint=${def.description} value=${value ?? def.default ?? ''}
      options=${def.values} onChange=${(v) => onChange(v)} />`;
  }
  if (def.type === 'number') {
    return html`<${TextField} type="number" label=${name} hint=${def.description} min=${def.min} max=${def.max}
      value=${value ?? def.default ?? ''} onInput=${(v) => onChange(v === '' ? undefined : Number(v))} />`;
  }
  if (def.type === 'string[]') {
    // A closed list is a set of checkboxes, because the order and the membership are the whole
    // setting and a free-text field would only let the operator get it wrong.
    const current = Array.isArray(value) ? value : [...(def.default ?? [])];
    if (def.values) {
      return html`<${Field} group label=${name} hint=${def.description}>
        <${Line} wrap>
          ${def.values.map(v => html`
            <${Check} key=${v} inline checked=${current.includes(v)}
              onChange=${(on) => onChange(on ? [...current, v] : current.filter(x => x !== v))}>${v}<//>`)}
        <//>
      <//>`;
    }
    return html`<${TextField} label=${name} hint=${def.description} value=${current.join(', ')}
      onInput=${(v) => onChange(v.split(',').map(s => s.trim()).filter(Boolean))} />`;
  }
  return html`<${TextField} label=${name} hint=${def.description} value=${value ?? def.default ?? ''} maxLength=${def.maxLength}
    onInput=${(v) => onChange(v || undefined)} />`;
}

/** The chips over a row: what is set on this part, and whether it is shown at all. */
function partChips({ block, settings, passage }) {
  const chips = [];
  if (block.hidden) chips.push(html`<${Badge} type="muted" label=${P('parts.chipHidden')} />`);
  if (block.id === 'common.freeform') {
    chips.push(html`<${Badge} type="watch" label=${P('parts.chipYours')} />`);
    chips.push(html`<${Badge} type="muted" label=${P('parts.chipLength', { n: (passage ?? '').length })} />`);
  }
  for (const [name, def] of settings) {
    const value = block.props?.[name];
    if (value === undefined) continue;
    const shown = Array.isArray(value) ? value.length : String(value);
    chips.push(html`<${Badge} key=${name} type="muted" label=${`${name}: ${shown}`} />`);
    if (def && def.type === 'boolean') { /* the value above already reads true/false */ }
  }
  return chips;
}

/** One part: its number, the arrows, what it is, its chips, and what you can do to it. */
function PartRow({ block, def, idx, number, total, open, passage, onMove, onToggle, onRemove, onOpen, onProp, onPassage }) {
  const settings = def ? Object.entries(def.props ?? {}) : [];
  const editable = settings.length > 0 || block.id === 'common.freeform';
  const editor = html`
    <${Stack} gap="small">
      ${block.id === 'common.freeform' && html`
        <${TextArea} code rows=${8} label=${P('parts.yourWords')} placeholder=${P('parts.yourWordsPh')}
          value=${passage ?? ''} onInput=${(v) => onPassage(block.key, v)} />`}
      ${settings.map(([name, sdef]) => html`
        <${SettingField} key=${name} name=${name} def=${sdef}
          value=${block.props?.[name]} onChange=${(v) => onProp(idx, name, v)} />`)}
    <//>`;
  return html`
    <${Row} faded=${block.hidden} open=${open} panel=${editor}>
      <${Cell} line>
        ${block.hidden ? null : html`<${Mark} kind="count">${number}<//>`}
        <${MoveButtons} first=${idx === 0} last=${idx === total - 1} onUp=${() => onMove(idx, -1)} onDown=${() => onMove(idx, 1)}
          upLabel=${P('parts.moveUp')} downLabel=${P('parts.moveDown')} />
      <//>
      <${Name} desc=${partSummary(def)} tag=${partChips({ block, settings, passage })}>${partName(def, block.id)}<//>
      <${Doors}>
        ${editable && html`<${Action} small row soft onClick=${() => onOpen(open ? null : block.key)}>
          ${open ? P('parts.close') : (block.id === 'common.freeform' ? P('parts.write') : P('parts.settings'))}
        <//>`}
        <${Action} small row soft onClick=${() => onToggle(idx)}>
          ${block.hidden ? P('parts.show') : P('parts.hide')}
        <//>
        <${Action} small row soft tone="danger" onClick=${() => onRemove(idx)}>${P('parts.remove')}<//>
      <//>
    <//>`;
}

/** The parts of this page, in the order they appear on it. */
export function PartsList({ blocks, catalog, passages, open, onOpen, onMove, onToggle, onRemove, onProp, onPassage }) {
  const defOf = (id) => catalog.find(b => b.id === id);
  let shown = 0;
  return html`
    <${List} cols="n-name-doors" empty=${P('parts.none')}>
      ${blocks.map((b, idx) => {
        if (!b.hidden) shown += 1;
        return html`<${PartRow} key=${b.key} block=${b} def=${defOf(b.id)} idx=${idx} number=${shown}
          total=${blocks.length} open=${open === b.key} passage=${passages[b.key]}
          onMove=${onMove} onToggle=${onToggle} onRemove=${onRemove} onOpen=${onOpen}
          onProp=${onProp} onPassage=${onPassage} />`;
      })}
    <//>`;
}

/**
 * Add a part. A field that narrows as you type rather than a dropdown: the catalogue is thirty
 * entries long and a native select shows one line of each, with no room for the sentence that says
 * what the part is.
 */
export function AddPart({ catalog, blocks, onAdd }) {
  const usedCount = (id) => blocks.filter(b => b.id === id).length;
  const full = (c) => !c.container && c.max_per_surface != null && usedCount(c.id) >= c.max_per_surface;
  const items = catalog.map(c => ({
    id: c.id,
    name: partName(c, c.id),
    sub: full(c) ? P('parts.addFull', { n: c.max_per_surface }) : partSummary(c),
    disabled: full(c),
    summary: c.summary ?? '',
  }));
  const match = (it, needle) => String(it.name).toLowerCase().includes(needle)
    || it.id.toLowerCase().includes(needle)
    || it.summary.toLowerCase().includes(needle);

  const quick = ['common.freeform', 'portal.board', 'common.band']
    .map(id => catalog.find(c => c.id === id))
    .filter(Boolean)
    .filter(c => !full(c));

  const add = (c) => { if (!c || full(c)) return; onAdd(c.id); };

  return html`
    <${Space} above="large">
      <${PickField} search items=${items} match=${match} max=${40} placeholder=${P('parts.addPh')} ariaLabel=${P('parts.addPh')}
        emptyLabel=${P('parts.addNone')} noMatchLabel=${P('parts.addNone')}
        onPick=${(it) => add(catalog.find(c => c.id === it.id))} />
      <${Line} wrap above="medium">
        <${Note} kind="hint" inline>${P('parts.addQuick')}<//>
        ${quick.map(c => html`<${Mark} key=${c.id} onClick=${() => add(c)}>${partName(c, c.id)}<//>`)}
      <//>
    <//>`;
}
