/**
 * @file model-picker.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One model selector, used for every model role (default, reasoning, execution, vision,
 *   speech-to-text). Replaces a flat <select> that rendered the provider's whole catalogue — 336
 *   options on OpenRouter, with no search, no prices and no way to find out what a model is.
 *
 *   Native <select> is kept for short lists (a self-hosted provider with a handful of models): it is
 *   the better control when it fits on a screen. Above the threshold it becomes a searchable list with
 *   a recommended group, the price, the context length, and a link to the model's own page.
 * @structure ModelPicker (the control) · ModelRow (one option) · SELECT_THRESHOLD
 * @usage <${ModelPicker} value=${model} onChange=${setModel} models=${models} modality="chat" />
 * @version-history
 *   v1.12.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.11.0 — 2026-09-26 — The classic AI settings' model picker is the library's Model picker (css/components/model-picker.css): its frame, rows, group, empty line and show-all line; its own picker, row and meta rules go (a unification: the look most tabs use).
 *   v1.10.0 — 2026-09-25 — The last lines that say nothing is there are the quiet sentence (.poster-quiet); the ecosystem's empty frame goes, its second line is the Hint (Jouni's decision "Empty line", a unification).
 *   v1.9.0 — 2026-09-25 — An HTTP status in the node statistics and a model not in the list are the Status (.poster-status fine, attention or danger); the coloured words' rules go (Jouni's decision "Status", a unification).
 *   v1.8.0 — 2026-09-25 — The model's page link (↗) and the agent's mail link are the small icon button (.poster-icon--small); their look goes, the mail icon keeps its drawing size (Jouni's decision "Icon button", a unification).
 *   v1.7.0 — 2026-09-25 — A search field over a list is the Search line (.search-line with the Text field); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.6.0 — 2026-09-25 — Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.5.0 — 2026-09-25 — Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.4.0 — 2026-09-25 — Code inside a sentence or a value line is the code-inline cut of the Code block (UI consolidation phase 5, a unification).
 *   v1.3.0 — 2026-09-25 — Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.2.0 — 2026-09-25 — The headings over lists wear .poster-day-title, grey (--quiet) over a record (Jouni's decision "Group heading", a unification).
 *   v1.1.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   v1.0.0 — 2026-08-01 — Initial version (OpenRouter settings rework).
 */
import { h } from 'preact';
import { useState, useMemo, useRef, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import {
  chatPriceLabel, audioPriceLabel, contextLabel, modelPageUrl, rankModels, matchesQuery, acceptsImages,
} from './pricing.js';

/** Below this many models a plain <select> is the better control, so we keep it. */
const SELECT_THRESHOLD = 25;

function priceLabelFor(model, modality) {
  return (modality === 'transcription' || modality === 'speech')
    ? audioPriceLabel(model, t)
    : chatPriceLabel(model, t);
}

function ModelRow({ model, modality, selected, onPick, showLink }) {
  const price = priceLabelFor(model, modality);
  const ctx = contextLabel(model);
  return html`
    <li class=${`model-picker-row${selected ? ' is-on' : ''}`}>
      <button type="button" onClick=${() => onPick(model.id)} title=${model.id}>
        <span><b>${model.name || model.id}</b><code>${model.id}</code></span>
        <span class="model-picker-price">${price || ''}</span>
        <span class="model-picker-ctx">${ctx ? t('profile.openrouter.price.context', { n: ctx }) : ''}</span>
      </button>
      ${showLink ? html`
        <a class="poster-icon poster-icon--small" href=${modelPageUrl(model.id)} target="_blank" rel="noopener"
           title=${t('profile.openrouter.model.openPage')} aria-label=${t('profile.openrouter.model.openPage')}>↗</a>` : null}
    </li>`;
}

/**
 * @param {object} props
 * @param {string} props.value            currently selected model id ('' = none)
 * @param {(id: string) => void} props.onChange
 * @param {Array<object>} props.models    models already fetched for this modality
 * @param {string} [props.modality]       'chat' | 'vision' | 'transcription' | 'speech'
 * @param {boolean} [props.allowNone]     offer an explicit "not in use" option
 * @param {boolean} [props.allowCustom]   let the user type a model id the catalogue does not list
 * @param {boolean} [props.isOpenRouter]  show links to openrouter.ai
 * @param {boolean} [props.disabled]
 * @param {string} [props.noneLabel]
 */
export function ModelPicker({
  value, onChange, models, modality = 'chat', allowNone = false, allowCustom = false,
  isOpenRouter = true, disabled = false, noneLabel,
}) {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [custom, setCustom] = useState('');
  const listRef = useRef(null);

  // Vision is not its own catalogue — it is the chat catalogue filtered by what each model declares
  // it accepts, which is the only reliable signal (180 of 336 read images, with no naming pattern).
  const pool = useMemo(() => {
    const all = Array.isArray(models) ? models : [];
    return modality === 'vision' ? all.filter(acceptsImages) : all;
  }, [models, modality]);
  const recommended = useMemo(() => rankModels(pool, modality).slice(0, 8), [pool, modality]);
  const filtered = useMemo(() => pool.filter((m) => matchesQuery(m, query)), [pool, query]);

  // A selected model that is not in the fetched list (a custom provider's id, or a model that left
  // the catalogue) must still be visible as the current value rather than silently reading as unset.
  const selectedKnown = pool.some((m) => m.id === value);

  useEffect(() => { if (!query) setShowAll(false); }, [query]);

  // A native <select> is the better control for a short list — but only for CHAT models, where the
  // label alone is enough to choose by. An audio model's price is the thing a person needs to see
  // (its unit is not knowable from the catalogue, so the reported figure and the link to the model's
  // page carry the whole story), and a <select> can show neither. The transcription list is short by
  // nature — 13 models — so this branch would otherwise swallow exactly the case the rich row exists for.
  const richOnly = modality === 'transcription' || modality === 'speech';
  if (!richOnly && pool.length > 0 && pool.length <= SELECT_THRESHOLD && !allowCustom) {
    return html`
      <select class="select-field" value=${value} disabled=${disabled}
              onChange=${(e) => onChange(e.target.value)}>
        ${allowNone ? html`<option value="">${noneLabel || t('profile.openrouter.model.none')}</option>` : null}
        ${pool.map((m) => html`<option key=${m.id} value=${m.id}>${m.name || m.id}</option>`)}
      </select>`;
  }

  const visible = query ? filtered : (showAll ? filtered : recommended);

  return html`
    <div class=${`model-picker pf-or-picker${disabled ? ' pf-or-picker--off' : ''}`}>
      <div class="pf-or-picker-head">
        <span class="pf-or-picked">
          ${value
            ? html`<code class="code-inline">${value}</code>`
            : html`<span class="poster-quiet">${noneLabel || t('profile.openrouter.model.none')}</span>`}
          ${value && !selectedKnown ? html`<span class="poster-status poster-status--attention pf-or-picked-warn">${t('profile.openrouter.model.notInList')}</span>` : null}
        </span>
        ${value && allowNone ? html`
          <button type="button" class="poster-action poster-action--small" disabled=${disabled}
                  onClick=${() => onChange('')}>${t('profile.openrouter.model.clear')}</button>` : null}
      </div>

      <input type="search" class="og-input" value=${query} disabled=${disabled}
             placeholder=${t('profile.openrouter.model.searchPlaceholder', { n: pool.length })}
             onInput=${(e) => setQuery(e.target.value)} />

      ${visible.length === 0
        ? html`<div class="poster-quiet model-picker-empty">${t('profile.openrouter.model.noMatch')}</div>`
        : html`
          <ul class="model-picker-list" ref=${listRef}>
            ${!query && !showAll ? html`<li class="model-picker-group poster-day-title">${t('profile.openrouter.model.recommended')}</li>` : null}
            ${visible.map((m) => html`
              <${ModelRow} key=${m.id} model=${m} modality=${modality} selected=${m.id === value}
                           onPick=${onChange} showLink=${isOpenRouter} />`)}
          </ul>`}

      ${!query && !showAll && filtered.length > recommended.length ? html`
        <div class="model-picker-more"><button type="button" class="poster-action poster-action--more" onClick=${() => setShowAll(true)}>
          ${t('profile.openrouter.model.showAll', { n: filtered.length })}
        </button></div>` : null}

      ${allowCustom ? html`
        <div class="pf-or-mcustom">
          <input type="text" class="og-input" value=${custom} disabled=${disabled}
                 placeholder=${t('profile.openrouter.model.customIdPlaceholder')}
                 onInput=${(e) => setCustom(e.target.value)} />
          <button type="button" class="poster-action poster-action--small" disabled=${disabled || !custom.trim()}
                  onClick=${() => { onChange(custom.trim()); setCustom(''); }}>
            ${t('profile.openrouter.model.customIdUse')}
          </button>
        </div>
        <span class="poster-hint">${t('profile.openrouter.model.customIdHint')}</span>` : null}
    </div>`;
}
