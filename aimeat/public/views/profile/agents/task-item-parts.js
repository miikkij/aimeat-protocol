/**
 * @file public/views/profile/agents/task-item-parts.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pieces one task row is built from: the per-browser blur preference, the status
 *   and to-do label/class helpers, the scope formatter, the to-do progress counter, the eye icon,
 *   the request-changes modal and the memory-entry viewer (JSON tree, image, markdown). Pure
 *   extraction from ./task-item.js so that file stays under the 800-line limit.
 * @version-history
 *   v1.0.0 -- 2026-09-14 -- Extracted from ./task-item.js (max-file-lines) while the Tasks tab
 *     took the poster face. The request-changes modal and the JSON viewer keep their existing
 *     pf-agd- classes on purpose; they are styled by agents-detail.css and are out of that scope.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Modal } from '/components/Modal.js';
import { Markdown } from '/components/Markdown.js';
import { detectImage, ImageView } from '/components/ImageDeliverable.js';
import { swallowed } from '/js/swallowed.js';

// Per-browser "blur the title" preference. Used when screen-recording the tab
// so sensitive task titles can be hidden without affecting other viewers or
// the server. Stored as an array of task IDs in localStorage; survives reloads
// but never leaves this browser.
const BLUR_STORAGE_KEY = 'aimeat.blurredTaskTitles';

function readBlurredSet() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BLUR_STORAGE_KEY));
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch (err) { swallowed('task-item: blurred titles', err); return new Set(); }
}

export function isTaskBlurred(taskId) {
  return readBlurredSet().has(taskId);
}

export function setTaskBlurred(taskId, blurred) {
  const set = readBlurredSet();
  if (blurred) set.add(taskId); else set.delete(taskId);
  // eslint-disable-next-line aimeat/no-silent-catch -- storage full/blocked -- preference just won't persist
  try { localStorage.setItem(BLUR_STORAGE_KEY, JSON.stringify([...set])); } catch { /* storage full/blocked -- preference just won't persist */ }
}

/** The status word, translated when a key exists, else the raw status capitalised. */
export function statusLabel(status) {
  const key = `profile.agents.tasks.${status}`;
  const val = t(key);
  return val !== key ? val : status.charAt(0).toUpperCase() + status.slice(1);
}

/** Which square chip a status wears: green frame when done, coral when failed, the shared sun
 *  ground while it runs, plain ink for everything else. */
export function statusChipClass(status) {
  if (status === 'done') return 'agt-status--done';
  if (status === 'failed') return 'agt-status--failed';
  if (status === 'active') return 'og-chip--sun';
  return '';
}

/** The tick box for one to-do: its modifier class and the glyph inside it. */
export function todoTick(status) {
  if (status === 'done') return { cls: 'agt-tick--done', glyph: '✓' };
  if (status === 'failed') return { cls: 'agt-tick--failed', glyph: '✗' };
  if (status === 'active') return { cls: 'agt-tick--active', glyph: '→' };
  if (status === 'skipped' || status === 'outdated') return { cls: '', glyph: '' };
  return { cls: 'agt-tick--pending', glyph: '' };
}

// Render one task scope entry as readable text. Scope is an array whose entries
// may be plain strings (legacy free-text scopes) or structured provenance objects
// stamped by the scheduler, e.g.
//   { name:'schedule', value:'0 9 * * *', type:'cron', description:'Uutisputki – aamukirjoitus' }
// A naive join()/String() prints "[object Object]" for the structured form, so
// format the parts we know into e.g. "schedule: 0 9 * * * — Uutisputki – aamukirjoitus".
export function formatScopeEntry(s) {
  if (s == null) return '';
  if (typeof s !== 'object') return String(s);
  const head = s.name || s.type || '';
  const val = s.value != null && s.value !== '' ? String(s.value) : '';
  const lead = [head, val].filter(Boolean).join(': ');
  const desc = s.description ? ` — ${s.description}` : '';
  const out = `${lead}${desc}`.trim();
  return out || JSON.stringify(s);
}

export function todoProgress(todos) {
  if (!todos || todos.length === 0) return null;
  const active = todos.filter(td => td.status !== 'outdated');
  if (active.length === 0) return null;
  const done = active.filter(td => td.status === 'done').length;
  return `${done}/${active.length}`;
}

/** The 14px stroke eye that toggles the title blur. Open eye when the title shows,
 *  struck through when it is hidden. */
export function EyeIcon({ hidden }) {
  return html`
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"></path>
      <circle cx="12" cy="12" r="3"></circle>
      ${hidden && html`<path d="M3 3l18 18"></path>`}
    </svg>
  `;
}

// Modal where the owner types the change request shown to the agent. Kept
// inline here (rather than in /components) because the textarea-with-send
// pattern is specific to this view; if a second caller needs it later, lift
// it into a shared component.
export function RequestChangesModal({ open, onClose, onSubmit, submitting }) {
  const [message, setMessage] = useState('');
  useEffect(() => { if (open) setMessage(''); }, [open]);
  function handleSend() {
    const trimmed = message.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  }
  return html`<${Modal} open=${open} onClose=${onClose} title=${t('profile.agents.tasks.requestChangesTitle')}
    footer=${html`
      <button class="btn-ghost" onClick=${onClose} disabled=${submitting}>${t('common.cancel') || 'Cancel'}</button>
      <button class="btn-primary" onClick=${handleSend} disabled=${submitting || !message.trim()}>
        ${submitting ? t('profile.agents.tasks.requestChangesSending') : t('profile.agents.tasks.requestChangesSend')}
      </button>`}>
    <p class="pf-agd-modal-help">${t('profile.agents.tasks.requestChangesHelp')}</p>
    <textarea
      class="pf-agd-revision-textarea"
      placeholder=${t('profile.agents.tasks.requestChangesPlaceholder')}
      value=${message}
      onInput=${e => setMessage(e.target.value)}
      rows=${6}
    ></textarea>
  <//>`;
}

// Parse a memory value into structured JSON when possible. Returns { json } for
// objects (or strings that parse as JSON), or { raw } for plain text/markdown.
function parseMemoryValue(value) {
  if (value === null || value === undefined) return { raw: '' };
  if (typeof value === 'object') return { json: value };
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed && (trimmed[0] === '{' || trimmed[0] === '[')) {
      try { return { json: JSON.parse(trimmed) }; }
      // eslint-disable-next-line aimeat/no-silent-catch -- not JSON after all -- show raw
      catch { /* not JSON after all -- show raw */ }
    }
    return { raw: value };
  }
  return { raw: String(value) };
}

// Recursive structured JSON renderer: objects/arrays become indented key/value
// rows, primitives get type-coloured values. Far easier to scan than raw JSON.
function JsonNode({ value }) {
  if (value === null) return html`<span class="pf-agd-json-null">null</span>`;
  const kind = typeof value;
  if (kind === 'string') return html`<span class="pf-agd-json-str">${value}</span>`;
  if (kind === 'number') return html`<span class="pf-agd-json-num">${value}</span>`;
  if (kind === 'boolean') return html`<span class="pf-agd-json-bool">${value ? 'true' : 'false'}</span>`;
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value || {});
  if (entries.length === 0) return html`<span class="pf-agd-json-empty">${Array.isArray(value) ? '[ ]' : '{ }'}</span>`;
  return html`
    <div class="pf-agd-json-block">
      ${entries.map(([k, v]) => {
        const nested = v !== null && typeof v === 'object';
        return html`
          <div class=${`pf-agd-json-row ${nested ? 'pf-agd-json-row--nested' : ''}`} key=${k}>
            <span class="pf-agd-json-key">${k}</span>
            <${JsonNode} value=${v} />
          </div>
        `;
      })}
    </div>
  `;
}

// One collapsible memory entry. Header (key + JSON badge) toggles the body, which
// renders a structured JSON view when the value is JSON, raw text otherwise.
export function TaskMemoryEntry({ entry }) {
  const [open, setOpen] = useState(false);
  const { json, raw } = parseMemoryValue(entry.value);
  const isJson = json !== undefined;
  // A memory value that IS an image (a /v1/pub URL string, or a { url, mime:image/* } object such as
  // crews.image-maker.images.<id>) renders as a thumbnail instead of a JSON/text blob.
  const image = detectImage(isJson ? json : raw, entry.key);
  return html`
    <div class="pf-agd-task-memory-entry">
      <button class="pf-agd-task-memory-head" onClick=${(e) => { e.stopPropagation(); setOpen(o => !o); }} aria-expanded=${open}>
        <span class="pf-agd-task-memory-caret">${open ? '▼' : '▶'}</span>
        <code class="pf-agd-task-memory-key">${entry.key}</code>
        ${image ? html`<span class="pf-agd-task-memory-badge">IMG</span>` : isJson && html`<span class="pf-agd-task-memory-badge">JSON</span>`}
      </button>
      ${open && html`
        <div class="pf-agd-task-memory-body">
          ${image
            ? html`<${ImageView} desc=${image} />`
            : isJson
              ? html`<${JsonNode} value=${json} />`
              // Non-JSON values (e.g. an agent's latest_output) are usually
              // markdown — render them formatted via the shared safe Markdown
              // component instead of raw text.
              : html`<div class="pf-agd-task-memory-md"><${Markdown} text=${raw} /></div>`}
        </div>
      `}
    </div>
  `;
}
