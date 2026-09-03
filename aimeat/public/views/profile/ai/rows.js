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
  const modelWord = unset ? html`<span class="is-unset">${x('roleUnset')}</span>` : html`${modelWords(model, id)} <code>${id}</code>`;
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
    <div class=${`ai-r ${open ? 'is-open' : ''}`} key=${role.id} id=${'ai-role-' + role.id}>
      <div class="ai-role">${x('role.' + role.id)}<small>${x('roleSub.' + role.id)}</small></div>
      <div class="ai-model">${modelWord}<small>${sub}</small></div>
      <div class="ai-what">${x('roleWhat.' + role.id)}</div>
      <div class="ai-go"><button type="button" class="og-door" disabled=${!keyed} onClick=${() => ctx.toggleRole(role.id)}>${open ? x('close') : x('change')}</button></div>
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
    <div class="ai-open">
      <p class="ai-lead">${lead} ${x('roleWhat.' + role.id)}</p>
      ${pool.length ? html`
        <div class="ai-pick">
          <input class="og-input" type="search" value=${ctx.query || ''} placeholder=${x('searchModels', { n: pool.length })} aria-label=${x('searchModels', { n: pool.length })} onInput=${(e) => ctx.setQuery(e.target.value)} />
          ${!q && !ctx.showAll ? html`<div class="ai-pick-group">${x('recommended')}</div>` : null}
          ${visible.length ? html`<ul class="ai-pick-list">${visible.map((m) => pickerRow(ctx, role, m, m.id === id))}</ul>` : html`<div class="ai-pick-empty">${x('noMatch')}</div>`}
          <div class="ai-pick-more">
            ${!q && !ctx.showAll && filtered.length > visible.length ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setShowAll(true)}>${x('showAll', { n: filtered.length })}</button>` : null}
            <span>${x('poolFacts.' + role.pool, { n: pool.length })}</span>
          </div>
        </div>` : html`<p class="ai-empty">${role.pool === 'transcription' ? x('sttNone') : role.pool === 'image' ? x('imageNone') : x('modelsNone')}</p>`}
      ${role.id === 'stt' ? sttPanel(ctx) : null}
      <div class="og-doors">
        ${id ? html`<button type="button" class="og-door og-door--quiet" disabled=${ctx.busy === 'role'} onClick=${() => ctx.setRole(role, '')}>${role.off === 'default' ? x('clearToDefault') : x('turnOff')}</button>` : null}
        ${id && ctx.isOpenRouter ? html`<a class="og-door og-door--quiet" href=${modelPageUrl(id)} target="_blank" rel="noopener">${x('openModelPage')}</a>` : null}
        <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.toggleRole(role.id)}>${x('close')}</button>
      </div>
    </div>`;
}

function pickerRow(ctx, role, m, on) {
  const tr = modelTraits(m);
  const trait = [tr.free ? x('traitFree') : '', tr.varies ? x('traitVaries') : '', tr.images && role.pool !== 'vision' && role.pool !== 'image' ? x('readsImages') : ''].filter(Boolean).join(' · ');
  return html`
    <li class=${`ai-pick-row ${on ? 'is-on' : ''}`} key=${m.id}>
      <button type="button" disabled=${ctx.busy === 'role'} onClick=${() => ctx.setRole(role, m.id)}>
        <span><b>${modelWords(m, m.id)}</b><code>${m.id}</code></span>
        <span class="ai-pick-trait">${trait}</span>
        <span class="ai-pick-price">${priceWords(m, role)}</span>
        <span class="ai-pick-ctx">${contextWords(m)}</span>
      </button>
    </li>`;
}

function sttPanel(ctx) {
  const lang = ctx.settings?.sttLanguage || '';
  const r = ctx.sttResult;
  const max = Math.min(30, Number(ctx.settings?.limits?.voice_msg_max_seconds) || 30);
  return html`
    <div class="ai-kv">
      <div class="ai-k">${x('sttLanguage')}</div>
      <div class="ai-v">
        <div class="ai-radios">
          ${STT_LANGS.map((code) => html`<label class="ai-radio" key=${code || 'auto'}><input type="radio" name="ai-stt-lang" checked=${lang === code} disabled=${ctx.busy === 'role'} onChange=${() => ctx.setSttLanguage(code)} />${code ? t('profile.openrouter.stt.lang_' + code) : x('sttLangDetect')}</label>`)}
        </div>
        <small>${x('sttLanguageHint')}</small>
      </div>
      <div class="ai-k">${x('sttMeasured')}</div>
      <div class="ai-v">${x('sttMeasuredBody')}<small>${x('sttMeasuredSub', { max, limit: Number(ctx.settings?.limits?.voice_msg_max_seconds) || 300 })}</small>
        <div class="og-doors">
          <${VoiceRecorder} maxSeconds=${max} disabled=${ctx.busy === 'stt' || !ctx.settings?.sttModel} label=${x('sttRecord')} className="og-door" onRecorded=${(file) => ctx.sttTest(file)} />
          ${ctx.busy === 'stt' ? html`<small class="ai-msg">${x('sttTesting')}</small>` : null}
        </div>
        ${ctx.sttError ? html`<small class="ai-msg is-err">${ctx.sttError}</small>` : null}
        ${r ? html`<div class="ai-stt-result">${r.text || x('sttSilent')}<small>${x('sttResultMeta', { seconds: (Number(r.seconds) || 0).toFixed(1), cost: money(r.usage?.cost_usd || 0), model: r.model || ctx.settings?.sttModel || '' })}${r.usage?.cost_exact === false ? ` · ${x('sttCostNotReported')}` : ''}</small></div>` : null}
      </div>
    </div>`;
}

/* ── One app in the spend table ───────────────────────────────────────────────────────────────── */

export function appRow(ctx, row, editing) {
  const cap = ctx.quotas?.[row.app]?.daily_usd;
  const draft = ctx.caps?.[row.app];
  return html`
    <div class="ai-app" key=${'n' + row.app}><b>${row.app}</b><small>${[row.tokens ? x('tokensN', { n: compact(row.tokens) }) : '', row.seconds ? x('secondsN', { n: Math.round(row.seconds) }) : ''].filter(Boolean).join(' · ')}</small></div>
    <div class="ai-n" key=${'c' + row.app}>${money(row.cost)}</div>
    <div class="ai-n is-dim ai-today" key=${'t' + row.app}>${money(row.today)}</div>
    <div class="ai-cap" key=${'p' + row.app}>${editing
      ? html`<input class="og-input" type="number" min="0" max="1000" step="0.10" value=${draft ?? ''} placeholder=${x('noCap')} aria-label=${x('colCap')} onInput=${(e) => ctx.setCap(row.app, e.target.value)} />`
      : (cap != null ? html`<b class="ai-n">${money(cap)}</b>` : x('noCap'))}</div>
    <div class="ai-n is-dim ai-calls" key=${'k' + row.app}>${row.calls}</div>`;
}
