/**
 * @file public/views/profile/agents/task-item-parts.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pieces one task row is built from: the per-browser blur preference, the status
 *   and to-do tone helpers, the scope formatter, the to-do progress counter, the eye icon, the
 *   request-changes dialog and the memory-entry viewer (JSON tree, image, markdown). Pure
 *   extraction from ./task-item.js so that file stays under the 800-line limit.
 * @version-history
 *   v2.0.1 -- 2026-09-22 -- A task's status chip takes the set's success, danger and coral tones
 *     (done, failed, waiting on the owner) besides the sun for a running task.
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set: the request-changes dialog is
 *     a Dialog with a Field, a memory entry is a Fold, the JSON tree is KeyValue rows with toned
 *     mono values, the status and to-do helpers return part tones instead of class names, and the
 *     eye icon draws its own stroke. No pf-agd- or agt- class is left here.
 *   v1.0.0 -- 2026-09-14 -- Extracted from ./task-item.js (max-file-lines) while the Tasks tab
 *     took the poster face. The request-changes modal and the JSON viewer keep their existing
 *     pf-agd- classes on purpose; they are styled by agents-detail.css and are out of that scope.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Dialog, Field, Action, Fold, KeyValue, Stack, Text } from '/components/poster-parts.js';
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

/** Which Chip tone a status wears: the sun while it runs, success when done, danger when it failed,
 *  coral when it waits on the owner (stalled, changes asked for), the plain frame for the rest. */
export function statusChipTone(status) {
  if (status === 'active') return 'sun';
  if (status === 'done') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'stalled' || status === 'revision_requested') return 'coral';
  return 'plain';
}

/** The marker tone of one to-do: success when done, danger when failed, the pulsing sun while it
 *  runs, muted while it waits or was skipped. */
export function todoMarker(status) {
  if (status === 'done') return { tone: 'success', live: false };
  if (status === 'failed') return { tone: 'danger', live: false };
  if (status === 'active') return { tone: 'sun', live: true };
  return { tone: 'muted', live: false };
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

/** The stroke eye that toggles the title blur. Open eye when the title shows, struck through
 *  when it is hidden. It draws its own stroke so it needs no sheet. */
export function EyeIcon({ hidden }) {
  return html`
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="square" aria-hidden="true">
      <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"></path>
      <circle cx="12" cy="12" r="3"></circle>
      ${hidden && html`<path d="M3 3l18 18"></path>`}
    </svg>
  `;
}

// Dialog where the owner types the change request shown to the agent. Kept
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
  return html`<${Dialog} open=${open} onClose=${onClose} title=${t('profile.agents.tasks.requestChangesTitle')}
    actions=${html`
      <${Action} onClick=${onClose} disabled=${submitting}>${t('common.cancel') || 'Cancel'}<//>
      <${Action} kind="primary" onClick=${handleSend} disabled=${submitting || !message.trim()}>
        ${submitting ? t('profile.agents.tasks.requestChangesSending') : t('profile.agents.tasks.requestChangesSend')}
      <//>`}>
    <${Stack}>
      <${Text}>${t('profile.agents.tasks.requestChangesHelp')}<//>
      <${Field} type="textarea" placeholder=${t('profile.agents.tasks.requestChangesPlaceholder')}
        value=${message} onInput=${e => setMessage(e.target.value)} rows=${6} />
    <//>
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

// Recursive structured JSON renderer: objects/arrays become KeyValue rows (a nested value sits in
// the value column, which indents it), primitives are mono words toned by type. Far easier to scan
// than raw JSON.
function JsonNode({ value }) {
  if (value === null) return html`<${Text} kind="mono" tone="muted">null<//>`;
  const kind = typeof value;
  if (kind === 'string') return html`<${Text} kind="mono">${value}<//>`;
  if (kind === 'number') return html`<${Text} kind="mono" tone="info">${value}<//>`;
  if (kind === 'boolean') return html`<${Text} kind="mono" tone="coral">${value ? 'true' : 'false'}<//>`;
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value || {});
  if (entries.length === 0) return html`<${Text} kind="mono" tone="muted">${Array.isArray(value) ? '[ ]' : '{ }'}<//>`;
  return html`
    <${Stack} density="compact">
      ${entries.map(([k, v]) => html`<${KeyValue} key=${k} label=${k} value=${html`<${JsonNode} value=${v} />`} />`)}
    <//>
  `;
}

// One collapsible memory entry. The fold's title is the key, its note says JSON or IMG; the body
// renders a structured JSON view when the value is JSON, an image, or formatted markdown otherwise.
export function TaskMemoryEntry({ entry }) {
  const [open, setOpen] = useState(false);
  const { json, raw } = parseMemoryValue(entry.value);
  const isJson = json !== undefined;
  // A memory value that IS an image (a /v1/pub URL string, or a { url, mime:image/* } object such as
  // crews.image-maker.images.<id>) renders as a thumbnail instead of a JSON/text blob.
  const image = detectImage(isJson ? json : raw, entry.key);
  return html`
    <${Fold} title=${entry.key} sub=${image ? 'IMG' : isJson ? 'JSON' : undefined} open=${open}
      onToggle=${(e) => { e.stopPropagation(); setOpen(o => !o); }}>
      ${image
        ? html`<${ImageView} desc=${image} />`
        : isJson
          ? html`<${JsonNode} value=${json} />`
          // Non-JSON values (e.g. an agent's latest_output) are usually
          // markdown — render them formatted via the shared safe Markdown
          // component instead of raw text.
          : html`<div><${Markdown} text=${raw} /></div>`}
    <//>
  `;
}
