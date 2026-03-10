import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

/**
 * TagCloud — clickable tag filter pills.
 * @param {Object} props
 * @param {string[]} props.tags — all available tags (will be sorted)
 * @param {Set<string>} props.selected — currently active filter tags
 * @param {(tag: string) => void} props.onToggle — called when a tag is clicked
 * @param {() => void} props.onClear — called when clear button is clicked
 */
export default function TagCloud({ tags, selected, onToggle, onClear }) {
  if (!tags || tags.length === 0) return null;
  const sorted = [...tags].sort();
  return html`
    <div class="tag-cloud">
      ${sorted.map(tag => html`
        <button key=${tag}
          class="tag-pill ${selected.has(tag) ? 'active' : ''}"
          onClick=${() => onToggle(tag)}>
          ${tag}
        </button>
      `)}
      ${selected.size > 0 && html`
        <button class="tag-pill tag-clear" onClick=${onClear}>\u2715 ${t('tags.clear') || 'Clear'}</button>
      `}
    </div>
  `;
}
