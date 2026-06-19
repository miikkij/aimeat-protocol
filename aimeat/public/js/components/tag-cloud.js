import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

/**
 * TagCloud — clickable tag filter pills.
 * @param {Object} props
 * @param {string[]} props.tags — available tags. Pre-sorted order is respected when
 *   `limit` is set (pass most-used first); otherwise sorted alphabetically.
 * @param {Set<string>} props.selected — currently active filter tags
 * @param {(tag: string) => void} props.onToggle — called when a tag is clicked
 * @param {() => void} props.onClear — called when clear button is clicked
 * @param {number} [props.limit] - show only the first N tags behind a "show all" toggle.
 *   Selected tags always stay visible so an active filter can't hide its own pill.
 */
export default function TagCloud({ tags, selected, onToggle, onClear, limit }) {
  const [showAll, setShowAll] = useState(false);
  if (!tags || tags.length === 0) return null;
  const ordered = limit ? [...tags] : [...tags].sort();
  const capped = limit && !showAll && ordered.length > limit;
  const visible = capped ? ordered.filter((tag, i) => i < limit || selected.has(tag)) : ordered;
  return html`
    <div class="tag-cloud">
      ${visible.map(tag => html`
        <button key=${tag}
          class="tag-pill ${selected.has(tag) ? 'active' : ''}"
          onClick=${() => onToggle(tag)}>
          ${tag}
        </button>
      `)}
      ${capped && html`
        <button class="tag-pill tag-more" onClick=${() => setShowAll(true)}>
          ${(t('profile.memory.showAllTags') || 'Show all ({n})').replace('{n}', String(ordered.length))}
        </button>
      `}
      ${limit && showAll && ordered.length > limit && html`
        <button class="tag-pill tag-more" onClick=${() => setShowAll(false)}>${t('profile.memory.fewerTags') || 'Show fewer'}</button>
      `}
      ${selected.size > 0 && html`
        <button class="tag-pill tag-clear" onClick=${onClear}>✕ ${t('tags.clear') || 'Clear'}</button>
      `}
    </div>
  `;
}
