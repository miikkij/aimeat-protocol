import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);

/**
 * @file TagList.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Canonical tag/chip row — renders a flex row of tag chips using the
 *   shared `.tag-cloud` + `.tag-pill` classes from css/components/tags.css, with an
 *   optional `+N` overflow pill when the list exceeds `max`. Consolidates the many
 *   per-view bespoke tag clones (mk-tag, hb-tag, pkv-tag, pkg-tag, kpkg-tag,
 *   cap-tag, file-tag, etc.) into one component whose colors come entirely from
 *   theme tokens, so chips flip correctly in dark mode.
 * @structure TagList({ tags, max?, prefix?, onTag? }) — renders
 *   `<div class="tag-cloud">` containing one `<span class="tag-pill">` per tag.
 *   - `tags`  — array of strings (falsy/empty → renders nothing).
 *   - `max`   — when set and `tags.length > max`, only the first `max` chips are
 *               shown followed by a `+N` overflow pill.
 *   - `prefix`— optional decorator wrapping each label (e.g. `'#'` → `#foo`).
 *   - `onTag` — optional click handler `(tag) => void`; when provided chips get a
 *               `tag-pill--clickable` flag and an onClick wiring.
 * @usage
 *   import { TagList } from '/components/index.js';
 *   html`<${TagList} tags=${manifest.tags} max=${5} />`
 *   html`<${TagList} tags=${interests} onTag=${name => goTo('search', { interest: name })} />`
 * @version-history
 *   v1.0.0 — 2026-06-02 — Component unification (#16): created canonical tag/chip
 *     list backed by .tag-pill / .tag-cloud, replacing scattered bespoke tag CSS
 *     clones and a +N overflow pattern.
 */
export function TagList({ tags, max, prefix = '', onTag }) {
  const list = Array.isArray(tags) ? tags : [];
  if (list.length === 0) return null;

  const limited = typeof max === 'number' && list.length > max;
  const shown = limited ? list.slice(0, max) : list;
  const overflow = limited ? list.length - max : 0;
  const clickable = typeof onTag === 'function';

  const chipClass = clickable ? 'tag-pill tag-pill--clickable' : 'tag-pill';

  return html`
    <div class="tag-cloud">
      ${shown.map((tag) => html`
        <span
          key=${tag}
          class=${chipClass}
          onClick=${clickable ? () => onTag(tag) : undefined}
        >${prefix}${tag}</span>
      `)}
      ${overflow > 0 && html`<span class="tag-pill tag-pill--overflow">+${overflow}</span>`}
    </div>
  `;
}
