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
 *   v1.0.0 — 2026-09-12 — Initial, with the page's editor rewritten around it.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Badge } from './shared.js';

const html = htm.bind(h);
const P = (key, params) => t('admin.portal.' + key, params);

/** The two arrows are drawn, not typed: an arrow glyph in a button is not an icon. */
const CHEVRON_UP = html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>`;
const CHEVRON_DOWN = html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>`;

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
  const label = html`<span class="adm-elabel">${name}</span>`;
  const help = html`<p class="adm-pt-note">${def.description}</p>`;

  if (def.type === 'boolean') {
    return html`<div class="adm-mb-sm">
      <label class="adm-flex-center">
        <input type="checkbox" checked=${value === undefined ? def.default === true : !!value}
          onChange=${(e) => onChange(e.target.checked)} />
        ${label}
      </label>${help}</div>`;
  }
  if (def.type === 'enum') {
    return html`<div class="adm-mb-sm">${label}
      <select class="adm-input" value=${value ?? def.default ?? ''} onChange=${(e) => onChange(e.target.value)}>
        ${def.values.map(v => html`<option value=${v} key=${v}>${v}</option>`)}
      </select>${help}</div>`;
  }
  if (def.type === 'number') {
    return html`<div class="adm-mb-sm">${label}
      <input class="adm-input" type="number" min=${def.min} max=${def.max}
        value=${value ?? def.default ?? ''}
        onInput=${(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
      ${help}</div>`;
  }
  if (def.type === 'string[]') {
    // A closed list is a set of checkboxes, because the order and the membership are the whole
    // setting and a free-text field would only let the operator get it wrong.
    const current = Array.isArray(value) ? value : [...(def.default ?? [])];
    if (def.values) {
      return html`<div class="adm-mb-sm">${label}
        <div class="adm-flex adm-flex-wrap">
          ${def.values.map(v => html`
            <label class="adm-flex-center" key=${v}>
              <input type="checkbox" checked=${current.includes(v)}
                onChange=${(e) => onChange(e.target.checked ? [...current, v] : current.filter(x => x !== v))} />
              <span>${v}</span>
            </label>`)}
        </div>${help}</div>`;
    }
    return html`<div class="adm-mb-sm">${label}
      <input class="adm-input" value=${current.join(', ')}
        onInput=${(e) => onChange(e.target.value.split(',').map(s => s.trim()).filter(Boolean))} />
      ${help}</div>`;
  }
  return html`<div class="adm-mb-sm">${label}
    <input class="adm-input" value=${value ?? def.default ?? ''} maxLength=${def.maxLength}
      onInput=${(e) => onChange(e.target.value || undefined)} />
    ${help}</div>`;
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
function PartRow({ block, def, idx, number, total, open, passage, onMove, onToggle, onRemove, onOpen, onProp, onPassage, last }) {
  const settings = def ? Object.entries(def.props ?? {}) : [];
  const editable = settings.length > 0 || block.id === 'common.freeform';
  const cls = ['adm-pt-row', block.hidden ? 'adm-pt-row--hidden' : '', last && !open ? 'adm-pt-row--last' : ''].filter(Boolean).join(' ');
  return html`
    <div class=${cls}>
      <span class=${'adm-pt-num' + (block.hidden ? ' adm-pt-num--off' : '')}>${block.hidden ? '' : number}</span>
      <span class="adm-pt-move">
        <button type="button" disabled=${idx === 0} onClick=${() => onMove(idx, -1)} title=${P('parts.moveUp')}
          aria-label=${P('parts.moveUp')}>${CHEVRON_UP}</button>
        <button type="button" disabled=${idx === total - 1} onClick=${() => onMove(idx, 1)} title=${P('parts.moveDown')}
          aria-label=${P('parts.moveDown')}>${CHEVRON_DOWN}</button>
      </span>
      <span>
        <span class="adm-pt-name">${partName(def, block.id)}</span>
        <span class="adm-why">${partSummary(def)}</span>
        <span class="adm-pt-chips">${partChips({ block, settings, passage })}</span>
      </span>
      <span class="adm-pt-acts">
        ${editable && html`<button type="button" class="og-door og-door--quiet" onClick=${() => onOpen(open ? null : block.key)}>
          ${open ? P('parts.close') : (block.id === 'common.freeform' ? P('parts.write') : P('parts.settings'))}
        </button>`}
        <button type="button" class="og-door og-door--quiet" onClick=${() => onToggle(idx)}>
          ${block.hidden ? P('parts.show') : P('parts.hide')}
        </button>
        <button type="button" class="og-door og-door--quiet og-door--danger" onClick=${() => onRemove(idx)}>${P('parts.remove')}</button>
      </span>
      ${open && html`
        <div class="adm-pt-editor">
          ${block.id === 'common.freeform' && html`
            <label class="adm-elabel">${P('parts.yourWords')}</label>
            <textarea class="adm-pt-textarea" rows="8"
              placeholder=${P('parts.yourWordsPh')}
              value=${passage ?? ''}
              onInput=${(e) => onPassage(block.key, e.target.value)}></textarea>`}
          ${settings.map(([name, sdef]) => html`
            <${SettingField} key=${name} name=${name} def=${sdef}
              value=${block.props?.[name]} onChange=${(v) => onProp(idx, name, v)} />`)}
        </div>`}
    </div>`;
}

/** The parts of this page, in the order they appear on it. */
export function PartsList({ blocks, catalog, passages, open, onOpen, onMove, onToggle, onRemove, onProp, onPassage }) {
  const defOf = (id) => catalog.find(b => b.id === id);
  let shown = 0;
  return html`
    <div>
      ${blocks.map((b, idx) => {
        if (!b.hidden) shown += 1;
        return html`<${PartRow} key=${b.key} block=${b} def=${defOf(b.id)} idx=${idx} number=${shown}
          total=${blocks.length} open=${open === b.key} passage=${passages[b.key]}
          onMove=${onMove} onToggle=${onToggle} onRemove=${onRemove} onOpen=${onOpen}
          onProp=${onProp} onPassage=${onPassage} last=${idx === blocks.length - 1} />`;
      })}
      ${blocks.length === 0 && html`<p class="adm-pt-empty">${P('parts.none')}</p>`}
    </div>`;
}

/**
 * Add a part. A field that narrows as you type rather than a dropdown: the catalogue is thirty
 * entries long and a native select shows one line of each, with no room for the sentence that says
 * what the part is.
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
    <div class="adm-pt-pick">
      <div class="adm-pt-fld">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
        <input type="text" value=${q} placeholder=${P('parts.addPh')}
          onInput=${(e) => { setQ(e.target.value); setOpenList(true); }}
          onFocus=${() => setOpenList(true)}
          onBlur=${() => setTimeout(() => setOpenList(false), 150)} />
      </div>
      ${openList && html`
        <div class="adm-pt-pick-list">
          ${matches.length === 0 && html`<div class="adm-pt-pick-none">${P('parts.addNone')}</div>`}
          ${matches.map(c => html`
            <button type="button" key=${c.id} disabled=${full(c)} onClick=${() => add(c)}>
              <b>${partName(c, c.id)}</b>
              <small>${full(c) ? P('parts.addFull', { n: c.max_per_surface }) : partSummary(c)}</small>
            </button>`)}
        </div>`}
      <div class="adm-pt-quick">
        <span>${P('parts.addQuick')}</span>
        ${quick.map(c => html`
          <button type="button" key=${c.id} class="adm-pt-chip" onClick=${() => add(c)}>${partName(c, c.id)}</button>`)}
      </div>
    </div>`;
}
