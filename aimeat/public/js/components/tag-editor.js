import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

/**
 * TagEditor — inline add/remove tag pills with input.
 * @param {Object} props
 * @param {string[]} props.tags — current tags on the item
 * @param {(tags: string[]) => void} props.onSave — called with updated tag array on add/remove
 * @param {number} [props.maxTags=20] - maximum tags allowed
 */
export default function TagEditor({ tags, onSave, maxTags = 20 }) {
  const [input, setInput] = useState('');

  const addTag = () => {
    const val = input.trim().slice(0, 64);
    if (!val || tags.includes(val) || tags.length >= maxTags) return;
    onSave([...tags, val]);
    setInput('');
  };

  const removeTag = (tag) => {
    onSave(tags.filter(t => t !== tag));
  };

  return html`
    <div class="tag-editor">
      <div class="tag-editor-pills">
        ${tags.map(tag => html`
          <span class="tag-pill tag-removable" key=${tag} onClick=${() => removeTag(tag)}>
            ${tag} <span class="tag-x">\u2715</span>
          </span>
        `)}
      </div>
      <div class="tag-editor-input">
        <input type="text" class="input-field" placeholder=${t('tags.addPlaceholder') || 'Add tag...'}
          value=${input} onInput=${e => setInput(e.target.value)}
          onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
          maxlength="64" />
        <button type="button" class="btn-sm" onClick=${addTag} disabled=${!input.trim() || tags.length >= maxTags}>+</button>
      </div>
    </div>
  `;
}
