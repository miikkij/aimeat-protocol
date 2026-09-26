/**
 * @file JsonView.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared "human-readable value" renderer. Renders a JSON object/array as an indented
 *   key/value TREE (type-coloured primitives) — far easier to scan than raw JSON — and renders a
 *   non-JSON string as safe Markdown. Mirrors the agent-tasks memory renderer so structured data
 *   looks the SAME everywhere. The tree's look is css/components/json-view.css (its own class names,
 *   `json-view-*`); the Markdown wrapper `json-view-text` has no rules of its own.
 * @structure parseValue · JsonNode · JsonValue
 * @usage import { JsonValue } from '/components/JsonView.js';  html`<${JsonValue} value=${v} />`
 * @version-history
 *   v1.1.0 — 2026-09-27 — Its own class names (.pf-agd-json-* → .json-view-*, block, row, row--nested,
 *     key, str, num, bool, null, empty; the Markdown wrapper .pf-agd-task-memory-md → .json-view-text,
 *     which no sheet styles); every rule keeps its value (Jouni: components draw only their own class
 *     names, a move).
 *   v1.0.1 — 2026-09-25 — The tree's rules live in css/components/json-view.css (UI consolidation phase 5, a move).
 *   v1.0.0 — 2026-06-15 — extracted the agents-tasks structured JSON/markdown renderer into a shared
 *     component so the Ecosystem-apps "Data this app wrote" view (and others) render values the same way.
 */
import { h } from 'preact';
import htm from 'htm';
import { Markdown } from '/components/Markdown.js';

const html = htm.bind(h);

/** Parse a value into { json } (object, or a string that parses as JSON) or { raw } (text/markdown). */
export function parseValue(value) {
  if (value === null || value === undefined) return { raw: '' };
  if (typeof value === 'object') return { json: value };
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed && (trimmed[0] === '{' || trimmed[0] === '[')) {
      try { return { json: JSON.parse(trimmed) }; }
      // eslint-disable-next-line aimeat/no-silent-catch -- not JSON after all — show raw
      catch { /* not JSON after all — show raw */ }
    }
    return { raw: value };
  }
  return { raw: String(value) };
}

/**
 * Recursive structured renderer: objects/arrays become indented key/value rows, primitives get
 * type-coloured values. Far easier to scan than raw JSON. (Same markup the agent tasks view uses.)
 */
export function JsonNode({ value }) {
  if (value === null) return html`<span class="json-view-null">null</span>`;
  const ty = typeof value;
  if (ty === 'string') return html`<span class="json-view-str">${value}</span>`;
  if (ty === 'number') return html`<span class="json-view-num">${value}</span>`;
  if (ty === 'boolean') return html`<span class="json-view-bool">${value ? 'true' : 'false'}</span>`;
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value || {});
  if (entries.length === 0) {
    return html`<span class="json-view-empty">${Array.isArray(value) ? '[ ]' : '{ }'}</span>`;
  }
  return html`
    <div class="json-view-block">
      ${entries.map(([k, v]) => {
        const nested = v !== null && typeof v === 'object';
        return html`
          <div class=${`json-view-row ${nested ? 'json-view-row--nested' : ''}`} key=${k}>
            <span class="json-view-key">${k}</span>
            <${JsonNode} value=${v} />
          </div>`;
      })}
    </div>`;
}

/** Render any value readably: JSON → the key/value tree; a non-JSON string → safe Markdown. */
export function JsonValue({ value }) {
  const { json, raw } = parseValue(value);
  if (json !== undefined) return html`<${JsonNode} value=${json} />`;
  return html`<div class="json-view-text"><${Markdown} text=${raw} /></div>`;
}
