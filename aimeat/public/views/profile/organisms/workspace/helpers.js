/**
 * @file public/views/profile/organisms/workspace/helpers.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Pure helpers for the organism workspace view — the primary-field map, type-aware
 *   record-field rendering, multi-part document series parsing/grouping, KPI target formatting +
 *   evaluation, and small display utilities. Extracted from workspace.js to satisfy max-file-lines
 *   with no behaviour change.
 * @structure PRIMARY_FIELD, looksMarkdown, renderFieldVal, seriesParse, groupDocs, kpiTargetText,
 *   kpiMeets, firstLine, shortActor, cap, isMobileView, renderSpaceNotice
 * @usage import { PRIMARY_FIELD, groupDocs } from '/views/profile/organisms/workspace/helpers.js';
 * @version-history
 *   2026-09-14 -- A row space reads as a row space: its own notice. It fell into the "backing not
 *     supported" branch, which told the owner to switch it to memory — the one change row spaces
 *     exist to prevent. The repeated name-and-badge head went with it: organism.css hides it inside
 *     an og-page, which is the only place this renders, so it was markup nobody could see.
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   v1.0.0 — 2026-07-13 — Extracted from workspace.js (max-file-lines)
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Markdown } from '/components/Markdown.js';

export const PRIMARY_FIELD = { goal: 'title', plan: 'approach', deliverable: 'title', resource: 'label', decision: 'summary' };

export const looksMarkdown = (s) => /\n/.test(s) || /(^|\s)[-*]\s/.test(s) || /[#`>|]|\[[^\]]+\]\(|\*\*/.test(s);

// Render ONE field value, type-aware + left-aligned + wrapping. Strings that look like markdown (or
// are multi-line) render through the safe Markdown component; plain strings wrap as text; arrays
// become a bullet list; objects pretty-print in a wrapped <pre>. (Was a right-aligned KeyValueRow
// with everything String()'d onto one line — unreadable for real record data.)
export const renderFieldVal = (v) => {
  if (Array.isArray(v)) {
    return html`<ul class="pj-rec-field-list">${v.map((it, i) => html`<li key=${i}>${
      (it && typeof it === 'object') ? html`<pre class="pj-rec-json">${JSON.stringify(it, null, 2)}</pre>` : String(it)
    }</li>`)}</ul>`;
  }
  if (v && typeof v === 'object') return html`<pre class="pj-rec-json">${JSON.stringify(v, null, 2)}</pre>`;
  if (typeof v === 'string') {
    return looksMarkdown(v)
      ? html`<div class="pj-rec-md"><${Markdown} text=${v} /></div>`
      : html`<span class="pj-rec-field-text">${v}</span>`;
  }
  return html`<span class="pj-rec-field-text">${String(v)}</span>`;
};

// ── Series niputus: collapse multi-part documents ("Foo — osa 2", "Foo — part 3") under one
// expandable parent so a 4-part doc reads as ONE line, not four near-identical ones. PURELY a
// display grouping — it never touches the stored sections or the documents themselves. The base
// title is whatever precedes a trailing "— osa N / part N / #N"; a document with no such suffix is
// its own base (so the lead "Foo" groups with "Foo — osa 2/3"). Only bases with ≥2 members collapse.
export const seriesParse = (title) => {
  const m = /^(.*?)[\s—–-]+(?:osa|part|pt\.?|#)\s*(\d+)\s*$/i.exec(String(title || ''));
  return (m && m[1].trim()) ? { base: m[1].trim(), part: parseInt(m[2], 10) } : { base: String(title || '').trim(), part: 0 };
};
export const groupDocs = (list) => {
  const map = new Map(); const order = [];
  for (const d of list) {
    const { base, part } = seriesParse(d.title || d.label || d.id || '');
    const k = base.toLowerCase();
    if (!map.has(k)) { map.set(k, { base, parts: [] }); order.push(k); }
    map.get(k).parts.push({ ...d, _part: part });
  }
  return order.map(k => {
    const g = map.get(k);
    if (g.parts.length < 2) return { single: g.parts[0] };
    g.parts.sort((a, b) => a._part - b._part);
    return { base: g.base, parts: g.parts };
  });
};

// ── Measurability objectives (the manifest's objectives[] + each KPI's resolved current vs target).
export const kpiTargetText = (tg) => {
  if (!tg || typeof tg.op !== 'string') return '';
  if (tg.op === 'between' && Array.isArray(tg.values) && tg.values.length === 2) return `${tg.values[0]}–${tg.values[1]}`;
  const sym = tg.op === '<=' ? '≤' : tg.op === '>=' ? '≥' : tg.op === '==' ? '=' : tg.op;
  return typeof tg.value === 'number' ? `${sym} ${tg.value}` : '';
};
export const kpiMeets = (cur, tg) => {
  if (cur === null || cur === undefined || !tg || typeof tg.op !== 'string') return null;
  const v = tg.value;
  switch (tg.op) {
    case '<': return typeof v === 'number' ? cur < v : null;
    case '<=': return typeof v === 'number' ? cur <= v : null;
    case '>': return typeof v === 'number' ? cur > v : null;
    case '>=': return typeof v === 'number' ? cur >= v : null;
    case '==': return typeof v === 'number' ? cur === v : null;
    case 'between': return (Array.isArray(tg.values) && tg.values.length === 2) ? (cur >= tg.values[0] && cur <= tg.values[1]) : null;
    default: return null;
  }
};

// First non-empty markdown line as a gray preview (heading/list markers stripped).
export const firstLine = (md) => {
  const line = String(md || '').split('\n').map(s => s.trim()).find(s => s && !s.startsWith('```'));
  return line ? line.replace(/^#{1,6}\s+/, '').replace(/^[-*>]\s+/, '').slice(0, 120) : '';
};
export const shortActor = (a) => String(a || '').split('@')[0];
export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
export const isMobileView = () => window.matchMedia('(max-width: 640px)').matches;

// A declared space whose backing isn't memory — never silently hidden, its tab shows a notice.
// Two of those backings are supported and keep their content somewhere else on purpose (tasks in
// the task system, rows in the row store), so each says where to look. Only a backing this build
// does not implement is told to switch to memory: saying that to a row space would undo the very
// thing row spaces are for. The space's own name and kind are the page headline and subtitle above
// this (cover.js), and the section head this used to repeat them in is `display: none` inside an
// og-page (css/views/organism.css), so it is the notice alone.
export const renderSpaceNotice = (ot) => html`
  <div class="pj-section poster-row--thing" key=${ot.name}>
    <div class="pj-space-notice">${ot.backing === 'tasks'
      ? (t('organisms.spaceTasksBacked') || 'This space points at the task system — its items are tasks, not workspace records. Manage them in the Tasks views.')
      : ot.backing === 'rows'
        ? (t('organisms.spaceRowsBacked') || 'This space holds rows the group accumulates. They are appended and never edited, and this page does not list them — they are read with the row tools, which filter and page through them.')
        : (t('organisms.spaceBackingUnsupported') || 'This space’s backing is not supported, so its content is not shown here. Edit the workspace (manifest) and set this space’s backing to "memory" to restore it — files and knowledge packages attach via Sources or document images instead.')}</div>
  </div>`;
