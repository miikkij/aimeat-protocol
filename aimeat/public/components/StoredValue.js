/**
 * @file public/components/StoredValue.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A stored value, read (a special view of the Memory page's record, moved out of
 *   views/profile/memory-tab/cover.js renderValue). The value comes as data and the component picks
 *   the way to show it: a text as prose (Markdown when it reads like Markdown), a flat object as the
 *   Facts (each value keeps its own line breaks), anything else, or the value as written when the
 *   page asks for it, as the Code block that scrolls after 60% of the window. A picture the value
 *   names (detectImage) stands over it. While the value loads it says so. A page passes the value
 *   and never writes a class. Its look is css/components/stored-value.css (the prose and the height
 *   of the code block), css/components/code-block.css and facts.css.
 *
 *   - value: the value; undefined while it loads.
 *   - name: the key the value is stored under (a picture's name can come from it).
 *   - raw: show the value as written (JSON for an object).
 *   - loadingLabel: the words of the loading line.
 * @structure StoredValue({ value, name, raw, loadingLabel }) · looksLikeMarkdown(s)
 * @usage html`<${StoredValue} value=${ctx.valueOf(m)} name=${m.key} raw=${showRaw} loadingLabel=${t('profile.memory.loadingValue')} />`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: memory-tab/cover.js renderValue as a component (.mp-prose,
 *     .mp-raw and the record's facts), page group G3.
 */
import { h } from 'preact';
import htm from 'htm';
import { Markdown } from '/components/Markdown.js';
import { detectImage, ImageView } from '/components/ImageDeliverable.js';
import { Facts } from '/components/Facts.js';
import { Note } from '/components/Note.js';

const html = htm.bind(h);

/** Whether a text reads like Markdown: a heading, a list, bold words or a link. */
export const looksLikeMarkdown = (s) => /(^|\n)#{1,6}\s|(^|\n)[-*]\s|\*\*|\[[^\]]+\]\(/.test(s);

const written = (v) => (typeof v === 'object' && v !== null ? JSON.stringify(v, null, 2) : String(v ?? ''));

/**
 * @param {{ value: any, name?: string, raw?: boolean, loadingLabel?: any }} props
 */
export function StoredValue({ value, name, raw, loadingLabel }) {
  if (value === undefined) return html`<${Note} kind="loading">${loadingLabel}<//>`;
  const im = detectImage(value, name);
  const code = (v) => html`<pre class="code-block stored-value-raw">${written(v)}</pre>`;
  if (raw) return code(value);
  const picture = im ? html`<${ImageView} desc=${im} />` : null;
  if (typeof value === 'string') {
    return html`${picture}<div class="stored-value-prose">${looksLikeMarkdown(value) ? html`<${Markdown} text=${value} />` : value}</div>`;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const rows = Object.entries(value);
    const flat = rows.every(([, x]) => x === null || typeof x !== 'object');
    if (flat && rows.length) return html`${picture}<${Facts} wide rows=${rows.map(([k, x]) => ({ k, v: String(x ?? ''), pre: true }))} />`;
  }
  return html`${picture}${code(value)}`;
}

export default StoredValue;
