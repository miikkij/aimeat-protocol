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
 * @structure SettingField · PartRow · PartsList · AddPart
 * @usage html`<${PartsList} blocks=${blocks} catalog=${catalog} ... />`
 * @version-history
 *   v1.1.0 -- 2026-09-22 -- Composed from the shared component set: each part a shared list row
 *     with its number, icon actions for the arrows and text actions for the rest; the settings as
 *     shared fields; the picker's list a scrolling box of rows. The chevrons carry their own stroke
 *     and are exported for the menu rows.
 *   v1.0.0 — 2026-09-12 — Initial, with the page's editor rewritten around it.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Badge } from './shared.js';
import { Stack, Text, Action, ListRow, Field, Surface } from '/components/poster-parts.js';

const html = htm.bind(h);
const P = (key, params) => t('admin.portal.' + key, params);

/** The two arrows are drawn, not typed: an arrow glyph in a button is not an icon. */
export const CHEVRON_UP = html`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square"><path d="M6 15l6-6 6 6" /></svg>`;
export const CHEVRON_DOWN = html`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square"><path d="M6 9l6 6 6-6" /></svg>`;

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

/** One setting, drawn from what the part declared it to be. The description stays on screen. */
function SettingField({ name, def, value, onChange }) {
  const help = def.description ? html`<${Text} kind="caption" tone="muted">${def.description}<//>` : null;

  if (def.type === 'boolean') {
    return html`<${Stack} density="compact">
      <${Field} type="checkbox" label=${name} value=${value === undefined ? def.default === true : !!value}
        onChange=${(e) => onChange(e.target.checked)} />${help}<//>`;
  }
  if (def.type === 'enum') {
    return html`<${Stack} density="compact">
      <${Field} type="select" label=${name} value=${value ?? def.default ?? ''}
        options=${def.values.map(v => ({ value: v, label: v }))} onChange=${(e) => onChange(e.target.value)} />${help}<//>`;
  }
  if (def.type === 'number') {
    return html`<${Stack} density="compact">
      <${Field} type="number" label=${name} min=${def.min} max=${def.max} width="narrow"
        value=${value ?? def.default ?? ''}
        onInput=${(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />${help}<//>`;
  }
  if (def.type === 'string[]') {
    // A closed list is a set of checkboxes, because the order and the membership are the whole
    // setting and a free-text field would only let the operator get it wrong.
    const current = Array.isArray(value) ? value : [...(def.default ?? [])];
    if (def.values) {
      return html`<${Stack} density="compact">
        <${Text} kind="label">${name}<//>
        <${Stack} direction="wrap" density="compact">
          ${def.values.map(v => html`
            <${Field} key=${v} type="checkbox" label=${v} value=${current.includes(v)}
              onChange=${(e) => onChange(e.target.checked ? [...current, v] : current.filter(x => x !== v))} />`)}
        <//>${help}<//>`;
    }
    return html`<${Stack} density="compact">
      <${Field} label=${name} value=${current.join(', ')}
        onInput=${(e) => onChange(e.target.value.split(',').map(s => s.trim()).filter(Boolean))} />${help}<//>`;
  }
  return html`<${Stack} density="compact">
    <${Field} label=${name} value=${value ?? def.default ?? ''} maxLength=${def.maxLength}
      onInput=${(e) => onChange(e.target.value || undefined)} />${help}<//>`;
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
  const chips = partChips({ block, settings, passage });
  return html`<${ListRow} density="compact" muted=${!!block.hidden} number=${block.hidden ? '' : number}
    name=${partName(def, block.id)} detail=${partSummary(def)} detailKind="text"
    actions=${html`
      <${Action} kind="icon" disabled=${idx === 0} onClick=${() => onMove(idx, -1)} title=${P('parts.moveUp')}
        label=${P('parts.moveUp')}>${CHEVRON_UP}<//>
      <${Action} kind="icon" disabled=${idx === total - 1} onClick=${() => onMove(idx, 1)} title=${P('parts.moveDown')}
        label=${P('parts.moveDown')}>${CHEVRON_DOWN}<//>
      ${editable && html`<${Action} kind="text" expanded=${!!open} onClick=${() => onOpen(open ? null : block.key)}>
        ${open ? P('parts.close') : (block.id === 'common.freeform' ? P('parts.write') : P('parts.settings'))}
      <//>`}
      <${Action} kind="text" onClick=${() => onToggle(idx)}>${block.hidden ? P('parts.show') : P('parts.hide')}<//>
      <${Action} kind="text" tone="danger" onClick=${() => onRemove(idx)}>${P('parts.remove')}<//>`}>
    ${(chips.length > 0 || open) && html`<${Stack} density="compact">
      ${chips.length > 0 && html`<${Stack} direction="wrap" density="compact">${chips}<//>`}
      ${open && html`
        <${Surface} kind="box" density="compact">
          <${Stack}>
            ${block.id === 'common.freeform' && html`
              <${Field} type="textarea" rows=${8} label=${P('parts.yourWords')}
                placeholder=${P('parts.yourWordsPh')}
                value=${passage ?? ''}
                onInput=${(e) => onPassage(block.key, e.target.value)} />`}
            ${settings.map(([name, sdef]) => html`
              <${SettingField} key=${name} name=${name} def=${sdef}
                value=${block.props?.[name]} onChange=${(v) => onProp(idx, name, v)} />`)}
          <//>
        <//>`}
    <//>`}
  <//>`;
}

/** The parts of this page, in the order they appear on it. */
export function PartsList({ blocks, catalog, passages, open, onOpen, onMove, onToggle, onRemove, onProp, onPassage }) {
  const defOf = (id) => catalog.find(b => b.id === id);
  let shown = 0;
  return html`
    <div>
      ${blocks.map((b, idx) => {
        if (!b.hidden) shown += 1;
        return html`<${PartRow} key=${b.key} block=${b} def=${defOf(b.id)} idx=${idx} number=${String(shown)}
          total=${blocks.length} open=${open === b.key} passage=${passages[b.key]}
          onMove=${onMove} onToggle=${onToggle} onRemove=${onRemove} onOpen=${onOpen}
          onProp=${onProp} onPassage=${onPassage} />`;
      })}
      ${blocks.length === 0 && html`<${Text} tone="muted">${P('parts.none')}<//>`}
    </div>`;
}

/**
 * Add a part. A field that narrows as you type rather than a dropdown: the catalogue is thirty
 * entries long and a native select shows one line of each, with no room for the sentence that says
 * what the part is. The list opens under the field when the field is in use.
 */
export function AddPart({ catalog, blocks, onAdd }) {
  const [q, setQ] = useState('');
  const [openList, setOpenList] = useState(false);

  const usedCount = (id) => blocks.filter(b => b.id === id).length;
  const full = (c) => !c.container && c.max_per_surface != null && usedCount(c.id) >= c.max_per_surface;
  const needle = q.trim().toLowerCase();
  const matches = catalog
    .filter(c => !needle
      || partName(c, c.id).toLowerCase().includes(needle)
      || c.id.toLowerCase().includes(needle)
      || (c.summary ?? '').toLowerCase().includes(needle))
    .slice(0, 40);

  const quick = ['common.freeform', 'portal.board', 'common.band']
    .map(id => catalog.find(c => c.id === id))
    .filter(Boolean)
    .filter(c => !full(c));

  const add = (c) => { if (full(c)) return; onAdd(c.id); setQ(''); setOpenList(false); };

  return html`
    <${Stack}>
      <${Field} type="search" value=${q} placeholder=${P('parts.addPh')} ariaLabel=${P('parts.addPh')}
        onInput=${(e) => { setQ(e.target.value); setOpenList(true); }}
        onFocus=${() => setOpenList(true)}
        onBlur=${() => setTimeout(() => setOpenList(false), 150)} />
      ${openList && html`
        <${Surface} kind="box" density="compact" height="scroll">
          ${matches.length === 0 && html`<${Text} tone="muted">${P('parts.addNone')}<//>`}
          ${matches.map(c => html`<${ListRow} key=${c.id} density="compact" muted=${full(c)}
            name=${partName(c, c.id)} onOpen=${full(c) ? undefined : () => add(c)}
            detail=${full(c) ? P('parts.addFull', { n: c.max_per_surface }) : partSummary(c)} detailKind="text" />`)}
        <//>`}
      <${Stack} direction="wrap" align="center" density="compact">
        <${Text} kind="caption" tone="muted">${P('parts.addQuick')}<//>
        ${quick.map(c => html`
          <${Action} key=${c.id} kind="tab" onClick=${() => add(c)}>${partName(c, c.id)}<//>`)}
      <//>
    <//>`;
}
