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
 *   v1.0.0 — 2026-09-08 — Initial (the CORS page in the poster face).
 */
import { h } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';

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
    <div class="adm-cors-quick">
      <span>${C('form.quick')}</span>
      ${COMMON_ORIGINS.map(o => html`<button type="button" class="adm-cors-chip" onClick=${() => add(o)}>${o}</button>`)}
    </div>`;
}

function OriginsField({ value, onInput, onEnter }) {
  return html`
    <div class="adm-cors-fld adm-cors-fld--mono">
      <input type="text" value=${value} placeholder=${C('form.origins')} spellcheck="false"
        onInput=${e => onInput(e.target.value)}
        onKeyDown=${e => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(); } }} />
    </div>`;
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
  return html`
    <div class="adm-cors-pick">
      <div class="adm-cors-fld">
        <input type="text" value=${text} placeholder=${placeholder} autocomplete="off"
          onInput=${e => { setText(e.target.value); setHi(0); setOpen(true); if (picked) onPick(null); }}
          onFocus=${() => setOpen(true)}
          onBlur=${() => setTimeout(() => setOpen(false), 120)}
          onKeyDown=${onKey} />
        <svg viewBox="0 0 24 24" aria-hidden="true" stroke-linecap="square"><path d="M6 9l6 6 6-6"></path></svg>
      </div>
      ${open && html`
        <div class="adm-cors-pick-list">
          ${candidates.length === 0 ? html`<div class="adm-cors-pick-none">${C('form.allListed')}</div>`
            : matches.length === 0 ? html`<div class="adm-cors-pick-none">${C('form.noMatch')}</div>`
            : matches.map((c, i) => html`
              <button type="button" class=${i === hi ? 'on' : ''} onMouseDown=${e => { e.preventDefault(); pick(c); }}>
                <b>${c.name}</b><small>${c.sub}</small>
              </button>`)}
        </div>`}
    </div>`;
}

function InlineEditor({ origins, onSave, onCancel }) {
  const [val, setVal] = useState(origins.join(', '));
  const save = () => { const arr = parseOrigins(val); if (arr.length) onSave(arr); };
  return html`
    <div class="adm-cors-edit">
      <${OriginsField} value=${val} onInput=${setVal} onEnter=${save} />
      <${QuickAdd} value=${val} onChange=${setVal} />
      <div class="adm-cors-edit-acts">
        <button type="button" class="adm-btn" onClick=${save} disabled=${parseOrigins(val).length === 0}>${C('form.save')}</button>
        <button type="button" class="og-door og-door--quiet" onClick=${onCancel}>${C('form.cancel')}</button>
      </div>
    </div>`;
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
    <div class="adm-cors-give">
      <div class="adm-cors-lbl">${C(kind + '.give')}</div>
      <div class="adm-cors-give-grid">
        <${PickField} key=${formKey} candidates=${candidates} placeholder=${C(kind + '.pick')} picked=${picked} onPick=${setPicked} />
        <${OriginsField} value=${val} onInput=${setVal} onEnter=${save} />
      </div>
      <${QuickAdd} value=${val} onChange=${setVal} />
      <div class="adm-cors-give-acts">
        <button type="button" class="adm-btn" onClick=${save} disabled=${!ready}>${C('form.save')}</button>
        <span class="adm-cors-note">${C('form.rule')}</span>
      </div>
    </div>`;
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
    <section class="og-sec" id=${'adm-cors-' + number}>
      <div class="og-sec-h"><h2>${C(kind + '.title')}<small>${number}</small></h2>
        <div class="og-doors"><button type="button" class="og-door og-door--quiet" onClick=${onDoor}>${door}</button></div></div>
      <p class="adm-cors-lead">${C(kind + '.lead')}</p>
      ${rows.length === 0 ? html`<div class="adm-cors-empty">${C(kind + '.none', { n: total })}</div>` : null}
      ${rows.map((r, idx) => html`
        <div class="adm-cors-orow ${idx === rows.length - 1 ? 'adm-cors-orow--last' : ''}" key=${r.id}>
          <span><b>${r.name}</b><span class="adm-why adm-cors-mono">${r.sub}</span></span>
          ${editing === r.id
            ? html`<${InlineEditor} origins=${r.origins} onSave=${arr => saveRow(r.id, arr)} onCancel=${() => setEditing(null)} />`
            : html`<span class="adm-cors-origins">${r.origins.map(o => html`<span class="adm-cors-code">${o}</span>`)}</span>`}
          <span class="adm-cors-acts">
            ${editing !== r.id ? html`
              <button type="button" class="adm-btn-action" onClick=${() => setEditing(r.id)}>${C('form.edit')}</button>
              <button type="button" class="og-door og-door--danger" onClick=${() => onClear(r.id)}>${C('form.clear')}</button>` : null}
          </span>
        </div>`)}
      <${GiveForm} kind=${kind} candidates=${candidates} onSave=${onSave} />
    </section>`;
}
