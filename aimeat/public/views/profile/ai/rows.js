/**
 * @file public/views/profile/ai/rows.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rows of the AI page: one model role (the role, the chosen model with its price
 *   and context, what it does, the Change door) and what opens under it (the picker: search over
 *   the catalogue, the recommended group first, a row per model with price and context, the link
 *   to its page; for speech, the language and a real measured transcription), and one app in the
 *   spend table (30-day cost, today, the cap written on the row, calls).
 * @structure roleRow · roleOpen · pickerRow · sttPanel · appRow
 * @usage import { roleRow, appRow } from './rows.js';
 * @version-history
 *   v1.13.0 -- 2026-09-26 -- The speech language's radio dots carry the Check line (css/components/check-line.css), a unification: Jouni's decision "Check line".
 *   v1.12.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.11.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.10.0 -- 2026-09-26 -- A table's cells are the Listing's own: figures the figure cell (.listing-n), words the words cell (.listing-desc), a row of servers the Listing; the rules that drew them here go (a unification: the look most tabs use).
 *   v1.9.0 -- 2026-09-25 -- The model picker is the library's Model picker (css/components/model-picker.css), moved unchanged out of ai-poster.css and calibrator-poster.css (UI consolidation phase 5, a move).
 *   v1.8.0 -- 2026-09-25 -- The speech-to-text language and test under an opened role are the Facts (css/components/facts.css), a unification: the look most tabs use.
 *   v1.7.0 -- 2026-09-25 -- A model role's row and an app's row in the spend table are the Listing (listing-row and its name, who, words and doors cells, the open panel), a unification: the look most tabs use.
 *   v1.6.0 — 2026-09-25 — The line a form says after it acted is the Form message; a refusal is its error tone (UI consolidation phase 5, a unification).
 *   v1.5.0 — 2026-09-25 — Code inside a sentence or a value line is the code-inline cut of the Code block (UI consolidation phase 5, a unification).
 *   v1.4.0 — 2026-09-25 — A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.3.0 — 2026-09-25 — The headings over lists wear .poster-day-title, grey (--quiet) over a record (Jouni's decision "Group heading", a unification).
 *   v1.2.0 — 2026-09-25 — The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.1.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { VoiceRecorder } from '/components/VoiceRecorder.js';
import { rankModels, matchesQuery, modelPageUrl } from '/views/profile/openrouter/pricing.js';
import { x, poolFor, findModel, modelWords, priceWords, contextWords, modelTraits, money, compact } from './frame.js';

const STT_LANGS = ['', 'fi', 'en', 'sv', 'de', 'fr', 'es', 'et'];
const RECOMMENDED = 8;

/* ── One model role ───────────────────────────────────────────────────────────────────────────── */

export function roleRow(ctx, role) {
  const open = ctx.openRole === role.id;
  const id = ctx.settings?.[role.field] || '';
  const pool = poolFor(role, ctx.models, ctx.sttModels);
  const model = findModel(id, pool) || findModel(id, ctx.models);
  const keyed = ctx.keyed;
  const unset = !id;
  const modelWord = unset ? html`<span class="is-unset">${x('roleUnset')}</span>` : html`${modelWords(model, id)} <code class="code-inline">${id}</code>`;
  const facts = unset
    ? [role.off === 'default' ? x('roleUsesDefault') : role.id === 'image' ? x('roleImageOff') : x('roleOff')]
    : model
      ? [priceWords(model, role), contextWords(model), modelTraits(model).images && role.pool !== 'vision' ? x('readsImages') : '']
      : [x('roleNotInList')];
  if (role.id === 'stt' && !unset) {
    facts.push(ctx.settings?.sttLanguage ? x('sttLang', { lang: t('profile.openrouter.stt.lang_' + ctx.settings.sttLanguage) }) : x('sttLangAuto'));
    facts.push(ctx.sttResult ? x('sttMeasuredShort', { cost: money(ctx.sttResult.usage?.cost_usd || 0) }) : x('sttNotMeasured'));
  }
  const sub = facts.filter(Boolean).join(' · ');
  return html`
    <div class=${`listing-row ${open ? 'is-open' : ''}`} key=${role.id} id=${'ai-role-' + role.id}>
      <div class="listing-name">${x('role.' + role.id)}<small>${x('roleSub.' + role.id)}</small></div>
      <div class="listing-who">${modelWord}<small>${sub}</small></div>
      <div class="listing-desc">${x('roleWhat.' + role.id)}</div>
      <div class="listing-doors"><button type="button" class="poster-action poster-action--small poster-action--row" disabled=${!keyed} onClick=${() => ctx.toggleRole(role.id)}>${open ? x('close') : x('change')}</button></div>
      ${open ? roleOpen(ctx, role, pool, model, id) : null}
    </div>`;
}

function roleOpen(ctx, role, pool, model, id) {
  const q = (ctx.query || '').trim().toLowerCase();
  const recommended = rankModels(pool, role.pool).slice(0, RECOMMENDED);
  const filtered = pool.filter((m) => matchesQuery(m, q));
  const visible = q ? filtered : (ctx.showAll ? filtered : recommended);
  const lead = id
    ? x('roleLead', { name: modelWords(model, id), price: model ? priceWords(model, role) : '', ctx: model ? contextWords(model) : '' })
    : (role.off === 'default' ? x('roleLeadUnsetDefault') : x('roleLeadUnsetOff'));
  return html`
    <div class="listing-open poster-box poster-box--raised">
      <p class="og-lead">${lead} ${x('roleWhat.' + role.id)}</p>
      ${pool.length ? html`
        <div class="model-picker">
          <input class="og-input" type="search" value=${ctx.query || ''} placeholder=${x('searchModels', { n: pool.length })} aria-label=${x('searchModels', { n: pool.length })} onInput=${(e) => ctx.setQuery(e.target.value)} />
          ${!q && !ctx.showAll ? html`<div class="model-picker-group poster-day-title">${x('recommended')}</div>` : null}
          ${visible.length ? html`<ul class="model-picker-list">${visible.map((m) => pickerRow(ctx, role, m, m.id === id))}</ul>` : html`<div class="poster-quiet model-picker-empty">${x('noMatch')}</div>`}
          <div class="model-picker-more">
            ${!q && !ctx.showAll && filtered.length > visible.length ? html`<button type="button" class="poster-action poster-action--more" onClick=${() => ctx.setShowAll(true)}>${x('showAll', { n: filtered.length })}</button>` : null}
            <span>${x('poolFacts.' + role.pool, { n: pool.length })}</span>
          </div>
        </div>` : html`<p class="poster-quiet ai-empty">${role.pool === 'transcription' ? x('sttNone') : role.pool === 'image' ? x('imageNone') : x('modelsNone')}</p>`}
      ${role.id === 'stt' ? sttPanel(ctx) : null}
      <div class="og-doors listing-open-doors">
        ${id ? html`<button type="button" class="poster-action poster-action--small poster-action--lower" disabled=${ctx.busy === 'role'} onClick=${() => ctx.setRole(role, '')}>${role.off === 'default' ? x('clearToDefault') : x('turnOff')}</button>` : null}
        ${id && ctx.isOpenRouter ? html`<a class="poster-action poster-action--small poster-action--lower" href=${modelPageUrl(id)} target="_blank" rel="noopener">${x('openModelPage')}</a>` : null}
        <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.toggleRole(role.id)}>${x('close')}</button>
      </div>
    </div>`;
}

function pickerRow(ctx, role, m, on) {
  const tr = modelTraits(m);
  const trait = [tr.free ? x('traitFree') : '', tr.varies ? x('traitVaries') : '', tr.images && role.pool !== 'vision' && role.pool !== 'image' ? x('readsImages') : ''].filter(Boolean).join(' · ');
  return html`
    <li class=${`model-picker-row ${on ? 'is-on' : ''}`} key=${m.id}>
      <button type="button" disabled=${ctx.busy === 'role'} onClick=${() => ctx.setRole(role, m.id)}>
        <span><b>${modelWords(m, m.id)}</b><code>${m.id}</code></span>
        <span class="model-picker-trait">${trait}</span>
        <span class="model-picker-price">${priceWords(m, role)}</span>
        <span class="model-picker-ctx">${contextWords(m)}</span>
      </button>
    </li>`;
}

function sttPanel(ctx) {
  const lang = ctx.settings?.sttLanguage || '';
  const r = ctx.sttResult;
  const max = Math.min(30, Number(ctx.settings?.limits?.voice_msg_max_seconds) || 30);
  return html`
    <div class="facts">
      <div class="facts-k poster-label">${x('sttLanguage')}</div>
      <div class="facts-v">
        <div class="ai-radios">
          ${STT_LANGS.map((code) => html`<label class="ai-radio check-line" key=${code || 'auto'}><input type="radio" name="ai-stt-lang" checked=${lang === code} disabled=${ctx.busy === 'role'} onChange=${() => ctx.setSttLanguage(code)} />${code ? t('profile.openrouter.stt.lang_' + code) : x('sttLangDetect')}</label>`)}
        </div>
        <small>${x('sttLanguageHint')}</small>
      </div>
      <div class="facts-k poster-label">${x('sttMeasured')}</div>
      <div class="facts-v">${x('sttMeasuredBody')}<small>${x('sttMeasuredSub', { max, limit: Number(ctx.settings?.limits?.voice_msg_max_seconds) || 300 })}</small>
        <div class="og-doors">
          <${VoiceRecorder} maxSeconds=${max} disabled=${ctx.busy === 'stt' || !ctx.settings?.sttModel} label=${x('sttRecord')} className="poster-action poster-action--small" onRecorded=${(file) => ctx.sttTest(file)} />
          ${ctx.busy === 'stt' ? html`<small class="form-message">${x('sttTesting')}</small>` : null}
        </div>
        ${ctx.sttError ? html`<small class="form-message form-message--error">${ctx.sttError}</small>` : null}
        ${r ? html`<div class="ai-stt-result poster-box">${r.text || x('sttSilent')}<small>${x('sttResultMeta', { seconds: (Number(r.seconds) || 0).toFixed(1), cost: money(r.usage?.cost_usd || 0), model: r.model || ctx.settings?.sttModel || '' })}${r.usage?.cost_exact === false ? ` · ${x('sttCostNotReported')}` : ''}</small></div>` : null}
      </div>
    </div>`;
}

/* ── One app in the spend table ───────────────────────────────────────────────────────────────── */

export function appRow(ctx, row, editing) {
  const cap = ctx.quotas?.[row.app]?.daily_usd;
  const draft = ctx.caps?.[row.app];
  return html`
    <div class="listing-row" key=${row.app}>
      <div class="listing-name"><b>${row.app}</b><small>${[row.tokens ? x('tokensN', { n: compact(row.tokens) }) : '', row.seconds ? x('secondsN', { n: Math.round(row.seconds) }) : ''].filter(Boolean).join(' · ')}</small></div>
      <div class="listing-n">${money(row.cost)}</div>
      <div class="listing-n is-dim">${money(row.today)}</div>
      <div class="listing-n ai-cap">${editing
        ? html`<input class="og-input" type="number" min="0" max="1000" step="0.10" value=${draft ?? ''} placeholder=${x('noCap')} aria-label=${x('colCap')} onInput=${(e) => ctx.setCap(row.app, e.target.value)} />`
        : (cap != null ? html`<b>${money(cap)}</b>` : html`<span class="is-dim">${x('noCap')}</span>`)}</div>
      <div class="listing-n is-dim">${row.calls}</div>
    </div>`;
}
