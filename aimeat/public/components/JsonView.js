/**
 * @file JsonView.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared "human-readable value" renderer. Renders a JSON object/array as an indented
 *   key/value TREE (primitives toned by type) — far easier to scan than raw JSON — and renders a
 *   non-JSON string as safe Markdown. Composed from the shared set (components/poster-parts.js):
 *   the tree is KeyValue rows whose value column holds the nested value, which indents it, the same
 *   way the agent task memory viewer draws one; a whole value sits in a code Surface.
 * @structure parseValue · JsonNode · JsonValue
 * @usage import { JsonValue } from '/components/JsonView.js';  html`<${JsonValue} value=${v} />`
 * @version-history
 *   2026-09-22 -- Composed from the shared component set (Surface, Stack, KeyValue, Text) instead of
 *     the pf-agd-json-* classes, so css/views/agents-detail.css could go. Exports and props unchanged.
 *   v1.0.0 — 2026-06-15 — extracted the agents-tasks structured JSON/markdown renderer into a shared
 *     component so the Ecosystem-apps "Data this app wrote" view (and others) render values the same way.
 */
import { h } from 'preact';
import htm from 'htm';
import { Markdown } from '/components/Markdown.js';
import { Surface, Stack, KeyValue, Text } from '/components/poster-parts.js';

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
 * Recursive structured renderer: objects/arrays become key/value rows (a nested value sits in the
 * value column, which indents it), primitives are mono words toned by type. (The same tree the agent
 * task memory viewer draws.)
 */
export function JsonNode({ value }) {
  if (value === null) return html`<${Text} kind="mono" tone="muted">null<//>`;
  const ty = typeof value;
  if (ty === 'string') return html`<${Text} kind="mono">${value}<//>`;
  if (ty === 'number') return html`<${Text} kind="mono" tone="info">${value}<//>`;
  if (ty === 'boolean') return html`<${Text} kind="mono" tone="coral">${value ? 'true' : 'false'}<//>`;
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value || {});
  if (entries.length === 0) {
    return html`<${Text} kind="mono" tone="muted">${Array.isArray(value) ? '[ ]' : '{ }'}<//>`;
  }
  return html`
    <${Stack} density="compact">
      ${entries.map(([k, v]) => html`<${KeyValue} key=${k} label=${k} value=${html`<${JsonNode} value=${v} />`} />`)}
    <//>`;
}

/** Render any value readably: JSON → the key/value tree in a code surface; a non-JSON string → safe Markdown. */
export function JsonValue({ value }) {
  const { json, raw } = parseValue(value);
  if (json !== undefined) return html`<${Surface} kind="code" density="compact" height="tall"><${JsonNode} value=${json} /><//>`;
  return html`<${Surface} kind="plain" density="flush"><${Markdown} text=${raw} /><//>`;
}
