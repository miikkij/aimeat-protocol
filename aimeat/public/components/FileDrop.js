/**
 * @file public/components/FileDrop.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Choosing files to upload (C5 of the component plan, the Field family): a dashed drop
 *   area with a big arrow and two lines (drop here, or click), coral while a file is dragged over it
 *   or chosen, and under it one row per chosen file (its mark, the name it will be stored under, its
 *   size, the mark that takes it off). The look is css/components/file-drop.css. A page passes the
 *   chosen files and what happens; it never writes a class.
 *
 *   The drop area owns its behaviour: a press or Enter or Space opens the browser's file window, a
 *   dragged file lights it, a dropped or chosen file reaches `onFiles(files)` (an array of File), and
 *   the same file can be chosen again after it was taken off.
 *   `items`: the chosen files as [{ file, key }] (the rows under the area; `onRename(index, key)` makes
 *   the name a field, `onRemove(index)` adds the mark that takes it off); `multiple`, `accept`,
 *   `disabled`; the words `dropLabel`, `orLabel`, `removeLabel`; `iconOf(file)` (the mark before a row).
 *   `plain`: no area, the browser's own file field in the Text field look (a form that takes one file
 *   among other fields; it keeps the chosen file until the page empties it); `inputRef` reaches its
 *   element. `button` (words): an action link that opens the file window (`soft` for its lower-case
 *   tone), for a page that imports one file with a press. `hidden`: only the file field, which a
 *   page's own action opens through `inputRef` (an import button that stands elsewhere). With
 *   `onChange(event)` a page reads the pick itself, as it did from its own field. Field words (`label`, `hint`, `message`,
 *   `wide`) stand it in a Field (components/Field.js).
 * @structure FileDrop(props)
 * @usage html`<${FileDrop} multiple items=${items} onFiles=${addFiles} onRename=${rename} onRemove=${removeAt} />`
 *        html`<${FileDrop} plain label=${a('fileLabel')} accept=".html,.htm" inputRef=${fileRef} />`
 *        html`<${FileDrop} button=${'+ ' + t('x.upload')} accept=".md,.json" onFiles=${([f]) => upload(f)} />`
 *        html`<${FileDrop} hidden accept=".zip" inputRef=${fileRef} onFiles=${([f]) => doImport(f)} />`
 * @version-history
 *   v1.0.1 — 2026-09-27 — The "or click" line and a row's size draw the component's own names
 *     (.file-drop-or, .file-drop-size) instead of the Settings page's .text-meta (a move, same look).
 *   v1.0.0 — 2026-09-26 — Initial: the drop area of the memory file form (views/profile/memory-tab/
 *     components.js FileUploadForm) and the apps form's file fields as one component (component plan C5).
 */
import { h } from 'preact';
import { useState, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Action, Icon } from '/components/Action.js';
import { TextField } from '/components/TextField.js';
import { useFieldIds, inField } from '/components/Field.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');

export function FileDrop(props) {
  const { id, items = [], onFiles, onRename, onRemove, multiple, accept, disabled, plain, hidden, button, soft,
    inputRef, dropLabel, orLabel, removeLabel, iconOf, ariaLabel, onChange } = props;
  const ids = useFieldIds(id);
  const [over, setOver] = useState(false);
  const input = useRef(null);
  const setRef = useCallback((el) => {
    input.current = el;
    if (typeof inputRef === 'function') inputRef(el);
    else if (inputRef && typeof inputRef === 'object') inputRef.current = el;
  }, [inputRef]);
  const take = (list) => { const files = Array.from(list || []); if (files.length) onFiles?.(files); };
  // A picked file reaches the page; with onFiles the field is emptied after, so the same file can be
  // picked again. A page that reads the event itself (onChange) keeps the field as the browser left it.
  const picked = (e) => {
    if (onChange) { onChange(e); return; }
    take(e.currentTarget.files);
    e.currentTarget.value = '';
  };

  if (hidden || button) {
    const field = html`<input id=${ids.id} ref=${setRef} type="file" class="file-drop-input" accept=${accept} multiple=${multiple}
      tabIndex="-1" aria-hidden="true" onChange=${picked} />`;
    if (!button) return field;
    return html`<${Action} small soft=${soft} disabled=${disabled} title=${ariaLabel}
      onClick=${() => input.current?.click()}>${button}<//>${field}`;
  }

  if (plain) {
    const control = html`<input id=${ids.id} ref=${setRef} type="file" class="og-input file-drop-plain" accept=${accept} multiple=${multiple}
      disabled=${disabled} aria-label=${ariaLabel} aria-describedby=${props.hint ? ids.hintId : undefined}
      onChange=${(e) => { onChange?.(e); take(e.currentTarget.files); }} />`;
    return inField(props, ids, control, false);
  }

  const open = () => { if (!disabled) input.current?.click(); };
  const control = html`
    <div class="file-drop">
      <div class=${cx('file-dropzone', over && 'dragover', items.length > 0 && 'has-file', disabled && 'is-off')}
        role="button" tabIndex=${disabled ? -1 : 0} aria-disabled=${disabled ? 'true' : undefined}
        aria-label=${ariaLabel} aria-describedby=${props.hint ? ids.hintId : undefined}
        onClick=${open}
        onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
        onDragOver=${(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
        onDragLeave=${() => setOver(false)}
        onDrop=${(e) => { e.preventDefault(); setOver(false); if (!disabled) take(e.dataTransfer?.files); }}>
        <input id=${ids.id} ref=${setRef} type="file" class="file-drop-input" multiple=${multiple} accept=${accept} tabIndex="-1"
          onChange=${(e) => { take(e.currentTarget.files); e.currentTarget.value = ''; }} />
        <div class="file-dropzone-empty">
          <span class="file-drop-arrow" aria-hidden="true">\u{2B06}️</span>
          <span>${dropLabel || t('profile.files.dropHere')}</span>
          ${orLabel !== null ? html`<span class="file-drop-or">${orLabel || t('profile.files.orClick')}</span>` : null}
        </div>
      </div>
      ${items.length > 0 ? html`
        <div class="file-upload-list">
          ${items.map((item, i) => html`
            <div class="file-upload-item" key=${item.file.name + item.file.size}>
              <span class="file-drop-mark" aria-hidden="true">${iconOf ? iconOf(item.file) : '\u{1F4C4}'}</span>
              ${onRename
                ? html`<${TextField} value=${item.key} ariaLabel=${item.file.name} onInput=${(v) => onRename(i, v)} />`
                : html`<span class="file-drop-name">${item.key || item.file.name}</span>`}
              <span class="file-drop-size">${Math.round(item.file.size / 1024)} KB</span>
              ${onRemove ? html`<${Icon} small label=${removeLabel || t('field.remove')} onClick=${() => onRemove(i)}>✕<//>` : null}
            </div>`)}
        </div>` : null}
    </div>`;
  return inField(props, ids, control, true);
}

export default FileDrop;
