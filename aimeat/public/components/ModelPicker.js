/**
 * @file public/components/ModelPicker.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Choosing an AI model (C5 of the component plan, the Field family): a select with its
 *   own list, because a provider's catalogue (336 models on OpenRouter) is too long for a drop-down.
 *   The look is the Model picker (css/components/model-picker.css): a framed box, a search field
 *   across its top, the recommended group's heading, one row per model (its name and id, a trait or a
 *   note, the price, the context) with the chosen one on the sun and a taken one dimmed, and a line
 *   with "show all" and how many there are. A page passes the models and what a row says as data; it
 *   never writes a class.
 *
 *   ModelList is the list itself (the AI page's roles, a calibration's models):
 *   `models` (the pool), `recommended` (what shows before a search; the first 8 when not given),
 *   `value` (the chosen id), `taken` (ids that cannot be picked again), `onPick(model)`,
 *   `describe(model)` → { name, trait, note, price, context, href, hrefLabel } (what a row says; the id
 *   is always shown; the trait column (words) or the note column (typewriter) stands only when its
 *   key is there, even empty; `href` adds the ↗ to the model's own page), `match(model, query)`, `query` + `onQuery` and `showAll` + `onShowAll` (when the
 *   page keeps them; otherwise the list keeps its own), `disabled`, `off` (dimmed: nothing to pick
 *   yet), and the words `searchLabel`, `recommendedLabel`, `noMatchLabel`, `showAllLabel` (n → words),
 *   `facts` (the line beside "show all"), `head` and `foot` (what stands inside the frame above the
 *   search and under the list).
 *   Keys: Escape empties the search; the rows are buttons.
 *
 *   ModelPicker is the whole control of the classic AI settings (moved here from
 *   views/profile/openrouter/model-picker.js): a short chat list is the Select, a long one or an audio
 *   one the ModelList with the chosen model above it, "Clear" when `allowNone`, and a field for a model
 *   id the catalogue does not list when `allowCustom`. Field words (`label`, `hint`, `message`) stand
 *   either one in a Field (components/Field.js).
 * @structure ModelList(props) · ModelPicker(props) · SELECT_THRESHOLD
 * @usage html`<${ModelList} models=${pool} recommended=${rankModels(pool, 'chat').slice(0, 8)} value=${id}
 *          onPick=${(m) => ctx.setRole(role, m.id)} describe=${(m) => ({ name: m.name, price: priceWords(m) })}
 *          query=${ctx.query} onQuery=${ctx.setQuery} showAll=${ctx.showAll} onShowAll=${ctx.setShowAll}
 *          searchLabel=${x('searchModels', { n: pool.length })} … />`
 *        html`<${ModelPicker} label=${t('profile.openrouter.model.default')} value=${model} onChange=${setModel} models=${models} />`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the three pickers of Settings (views/profile/openrouter/model-picker.js
 *     v1.12.0, the AI page's roleOpen and a calibration's picker) as one list with the rows as data
 *     (component plan C5).
 */
import { h } from 'preact';
import { useState, useMemo, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Action, Icon } from '/components/Action.js';
import { Mark, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { TextField } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { useFieldIds, inField, hasFieldWords } from '/components/Field.js';
import {
  chatPriceLabel, audioPriceLabel, contextLabel, modelPageUrl, rankModels, matchesQuery, acceptsImages,
} from '/views/profile/openrouter/pricing.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');

/** Below this many chat models a plain select is the better control. */
export const SELECT_THRESHOLD = 25;
const RECOMMENDED = 8;

function byWords(m, q) {
  const s = String(q || '').trim().toLowerCase();
  return !s || String(m.id).toLowerCase().includes(s) || String(m.name || '').toLowerCase().includes(s);
}

function Row({ m, d, on, taken, disabled, onPick }) {
  return html`
    <li class=${cx('model-picker-row', on && 'is-on', taken && 'is-taken', d.href && 'model-picker-row--link')}>
      <button type="button" title=${m.id} disabled=${disabled || taken} onClick=${() => onPick?.(m)}>
        <span><b>${d.name || m.id}</b><code>${m.id}</code></span>
        ${'note' in d ? html`<span class="model-picker-note">${d.note || ''}</span>` : 'trait' in d ? html`<span class="model-picker-trait">${d.trait || ''}</span>` : null}
        <span class="model-picker-price">${d.price || ''}</span>
        <span class="model-picker-ctx">${d.context || ''}</span>
      </button>
      ${d.href ? html`<${Icon} small href=${d.href} newTab label=${d.hrefLabel}>↗<//>` : null}
    </li>`;
}

export function ModelList(props) {
  const {
    models, recommended, value, taken, onPick, describe, match = byWords, disabled, off,
    query: qIn, onQuery, showAll: allIn, onShowAll, searchLabel, recommendedLabel, noMatchLabel, showAllLabel,
    facts, head, foot, id,
  } = props;
  const ids = useFieldIds(id);
  const [qOwn, setQOwn] = useState('');
  const [allOwn, setAllOwn] = useState(false);
  const query = qIn ?? qOwn;
  const showAll = allIn ?? allOwn;
  const setQuery = onQuery || setQOwn;
  const setShowAll = onShowAll || setAllOwn;
  // A search that is emptied goes back to the recommended few.
  useEffect(() => { if (!query && !onShowAll) setAllOwn(false); }, [query, onShowAll]);

  const pool = useMemo(() => (Array.isArray(models) ? models : []), [models]);
  const rec = recommended || pool.slice(0, RECOMMENDED);
  const q = String(query || '').trim().toLowerCase();
  const filtered = useMemo(() => pool.filter((m) => match(m, q)), [pool, q, match]);
  const visible = q ? filtered : (showAll ? filtered : rec);
  const takenSet = new Set(taken || []);
  const say = describe || ((m) => ({ name: m.name }));
  const more = typeof showAllLabel === 'function' ? showAllLabel(filtered.length) : showAllLabel;
  const search = searchLabel || t('profile.openrouter.model.searchPlaceholder', { n: pool.length });

  const named = hasFieldWords(props) && props.label;
  const control = html`
    <div class=${cx('model-picker', off && 'model-picker--off')} id=${ids.id} role="group"
      aria-labelledby=${named ? ids.labelId : undefined} aria-label=${named ? undefined : search}>
      ${head || null}
      <${TextField} search value=${query} disabled=${disabled && off} placeholder=${search} ariaLabel=${search} onInput=${(v) => setQuery(v)} />
      ${!q && !showAll ? html`<div class="model-picker-group poster-day-title">${recommendedLabel || t('profile.openrouter.model.recommended')}</div>` : null}
      ${visible.length
        ? html`<ul class="model-picker-list">${visible.map((m) => html`<${Row} key=${m.id} m=${m} d=${say(m) || {}}
            on=${m.id === value} taken=${takenSet.has(m.id)} disabled=${disabled} onPick=${onPick} />`)}</ul>`
        : html`<div class="poster-quiet model-picker-empty">${noMatchLabel || t('profile.openrouter.model.noMatch')}</div>`}
      ${(!q && !showAll && filtered.length > visible.length) || facts ? html`
        <div class="model-picker-more">
          ${!q && !showAll && filtered.length > visible.length ? html`<${Action} tone="more" onClick=${() => setShowAll(true)}>${more || t('profile.openrouter.model.showAll', { n: filtered.length })}<//>` : null}
          ${facts ? html`<span>${facts}</span>` : null}
        </div>` : null}
      ${foot || null}
    </div>`;
  return inField(props, ids, control, hasFieldWords(props));
}

function priceLabelFor(model, modality) {
  return (modality === 'transcription' || modality === 'speech') ? audioPriceLabel(model, t) : chatPriceLabel(model, t);
}

/**
 * The classic AI settings' model control. value: the chosen id ('' none); onChange(id); models: the
 * catalogue for this modality ('chat' | 'vision' | 'transcription' | 'speech'); allowNone; allowCustom;
 * isOpenRouter (rows link to openrouter.ai); disabled; noneLabel.
 */
export function ModelPicker(props) {
  const { value, onChange, models, modality = 'chat', allowNone = false, allowCustom = false,
    isOpenRouter = true, disabled = false, noneLabel } = props;
  const [custom, setCustom] = useState('');
  // Vision is the chat catalogue filtered by what each model declares it accepts.
  const pool = useMemo(() => {
    const all = Array.isArray(models) ? models : [];
    return modality === 'vision' ? all.filter(acceptsImages) : all;
  }, [models, modality]);
  const recommended = useMemo(() => rankModels(pool, modality).slice(0, RECOMMENDED), [pool, modality]);
  // A chosen model that is not in the fetched list must still show as the value, not as unset.
  const known = pool.some((m) => m.id === value);
  const none = noneLabel || t('profile.openrouter.model.none');

  // A select is the better control for a short chat list; an audio model's price is what a person
  // chooses by, and a select cannot show it, so audio always gets the rows.
  const richOnly = modality === 'transcription' || modality === 'speech';
  if (!richOnly && pool.length > 0 && pool.length <= SELECT_THRESHOLD && !allowCustom) {
    return html`<${Select} ...${props} id=${props.id} value=${value} disabled=${disabled} onChange=${(v) => onChange(v)}
      placeholder=${allowNone ? none : undefined} options=${pool.map((m) => [m.id, m.name || m.id])} />`;
  }

  const head = html`
    <div class="model-picker-head">
      <span class="model-picker-picked">
        ${value ? html`<${Code}>${value}<//>` : html`<${Note} kind="quiet" inline>${none}<//>`}
        ${value && !known ? html`<${Mark} kind="status" tone="attention">${t('profile.openrouter.model.notInList')}<//>` : null}
      </span>
      ${value && allowNone ? html`<${Action} small disabled=${disabled} onClick=${() => onChange('')}>${t('profile.openrouter.model.clear')}<//>` : null}
    </div>`;
  const foot = allowCustom ? html`
    <div class="model-picker-custom">
      <${TextField} value=${custom} disabled=${disabled} placeholder=${t('profile.openrouter.model.customIdPlaceholder')}
        ariaLabel=${t('profile.openrouter.model.customIdPlaceholder')} onInput=${setCustom}
        onEnter=${(v) => { if (v.trim()) { onChange(v.trim()); setCustom(''); } }} />
      <${Action} small disabled=${disabled || !custom.trim()} onClick=${() => { onChange(custom.trim()); setCustom(''); }}>${t('profile.openrouter.model.customIdUse')}<//>
    </div>
    <${Note}>${t('profile.openrouter.model.customIdHint')}<//>` : null;

  return html`<${ModelList} ...${props} models=${pool} recommended=${recommended} value=${value} off=${disabled}
    disabled=${disabled} match=${matchesQuery} onPick=${(m) => onChange(m.id)} head=${head} foot=${foot}
    describe=${(m) => {
      const ctx = contextLabel(m);
      return {
        name: m.name || m.id, price: priceLabelFor(m, modality) || '',
        context: ctx ? t('profile.openrouter.price.context', { n: ctx }) : '',
        href: isOpenRouter ? modelPageUrl(m.id) : undefined, hrefLabel: t('profile.openrouter.model.openPage'),
      };
    }} />`;
}

export default ModelPicker;
