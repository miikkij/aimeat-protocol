/**
 * @file public/views/profile/ai/rows.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rows of the AI page: one model role (the role, the chosen model with its price
 *   and context, what it does, the Change door) and what opens under it (the picker: search over
 *   the catalogue, the recommended group first, a row per model with price and context, the link
 *   to its page; for speech, the language and a real measured transcription), and one app in the
 *   spend table (30-day cost, today, the cap written on the row, calls).
 * @structure roleRow · roleOpen · pickerRow · sttPanel · appCells
 * @usage import { roleRow, appCells } from './rows.js';
 * @version-history
 *   2026-09-22 -- A role is the shared ListRow and a model in the picker another; the spend table's
 *     row is the cells of the shared Table; radios are shared radio actions. No page classes remain.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { VoiceRecorder } from '/components/VoiceRecorder.js';
import { ListRow, KeyValue, Stack, Surface, Field, Text, Action } from '/components/poster-parts.js';
import { rankModels, matchesQuery, modelPageUrl } from '/views/profile/openrouter/pricing.js';
import { x, poolFor, findModel, modelWords, priceWords, contextWords, modelTraits, money, compact, StatusLine } from './frame.js';

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
    <${ListRow} key=${role.id} id=${'ai-role-' + role.id} name=${x('role.' + role.id)} detail=${x('roleSub.' + role.id)}
      value=${html`<${Stack} density="compact">
        ${unset ? html`<${Text} tone="muted">${x('roleUnset')}<//>` : html`<${Text}>${modelWords(model, id)}<//><${Text} kind="mono">${id}<//>`}
        <${Text} kind="caption" tone="muted">${sub}<//>
      <//>`}
      actions=${html`<${Action} expanded=${open} disabled=${!keyed} onClick=${() => ctx.toggleRole(role.id)}>${open ? x('close') : x('change')}<//>`}>
      <${Stack}>
        <${Text} kind="caption" tone="muted">${x('roleWhat.' + role.id)}<//>
        ${open ? roleOpen(ctx, role, pool, model, id) : null}
      <//>
    <//>`;
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
    <${Surface} kind="record"><${Stack}>
      <${Text} kind="lead">${lead} ${x('roleWhat.' + role.id)}<//>
      ${pool.length ? html`
        <${Stack} density="compact">
          <${Field} type="search" value=${ctx.query || ''} placeholder=${x('searchModels', { n: pool.length })} ariaLabel=${x('searchModels', { n: pool.length })} onInput=${(e) => ctx.setQuery(e.target.value)} />
          ${!q && !ctx.showAll ? html`<${Text} kind="label">${x('recommended')}<//>` : null}
          ${visible.length ? html`<${Surface} kind="plain" density="flush" height="scroll">${visible.map((m) => pickerRow(ctx, role, m, m.id === id))}<//>` : html`<${Text} tone="muted">${x('noMatch')}<//>`}
          <${Stack} direction="wrap" align="center">
            ${!q && !ctx.showAll && filtered.length > visible.length ? html`<${Action} onClick=${() => ctx.setShowAll(true)}>${x('showAll', { n: filtered.length })}<//>` : null}
            <${Text} kind="caption" tone="muted">${x('poolFacts.' + role.pool, { n: pool.length })}<//>
          <//>
        <//>` : html`<${Text} tone="muted">${role.pool === 'transcription' ? x('sttNone') : role.pool === 'image' ? x('imageNone') : x('modelsNone')}<//>`}
      ${role.id === 'stt' ? sttPanel(ctx) : null}
      <${Stack} direction="wrap" align="center">
        ${id ? html`<${Action} disabled=${ctx.busy === 'role'} onClick=${() => ctx.setRole(role, '')}>${role.off === 'default' ? x('clearToDefault') : x('turnOff')}<//>` : null}
        ${id && ctx.isOpenRouter ? html`<${Action} href=${modelPageUrl(id)} target="_blank">${x('openModelPage')}<//>` : null}
        <${Action} onClick=${() => ctx.toggleRole(role.id)}>${x('close')}<//>
      <//>
    <//><//>`;
}

function pickerRow(ctx, role, m, on) {
  const tr = modelTraits(m);
  const trait = [tr.free ? x('traitFree') : '', tr.varies ? x('traitVaries') : '', tr.images && role.pool !== 'vision' && role.pool !== 'image' ? x('readsImages') : ''].filter(Boolean).join(' · ');
  // A choice is stored the moment it is pressed; while one is being stored the rows do not take another.
  const choose = () => { if (ctx.busy !== 'role') ctx.setRole(role, m.id); };
  return html`
    <${ListRow} key=${m.id} density="compact" selected=${on} name=${modelWords(m, m.id)} onOpen=${choose}
      detail=${[m.id, trait].filter(Boolean).join(' · ')}
      value=${html`<${Stack} density="compact"><span>${priceWords(m, role)}</span><span>${contextWords(m)}</span><//>`} />`;
}

function sttPanel(ctx) {
  const lang = ctx.settings?.sttLanguage || '';
  const r = ctx.sttResult;
  const max = Math.min(30, Number(ctx.settings?.limits?.voice_msg_max_seconds) || 30);
  return html`
    <div>
      <${KeyValue} label=${x('sttLanguage')}><${Stack} density="compact">
        <${Stack} direction="wrap" role="radiogroup" label=${x('sttLanguage')}>
          ${STT_LANGS.map((code) => html`<${Action} key=${code || 'auto'} kind="tab" semantics="radio" selected=${lang === code} disabled=${ctx.busy === 'role'} onClick=${() => ctx.setSttLanguage(code)}>${code ? t('profile.openrouter.stt.lang_' + code) : x('sttLangDetect')}<//>`)}
        <//>
        <${Text} kind="caption" tone="muted">${x('sttLanguageHint')}<//>
      <//><//>
      <${KeyValue} label=${x('sttMeasured')}><${Stack} density="compact">
        <span>${x('sttMeasuredBody')}</span>
        <${Text} kind="caption" tone="muted">${x('sttMeasuredSub', { max, limit: Number(ctx.settings?.limits?.voice_msg_max_seconds) || 300 })}<//>
        <${Stack} direction="wrap" align="center">
          <${VoiceRecorder} maxSeconds=${max} disabled=${ctx.busy === 'stt' || !ctx.settings?.sttModel} label=${x('sttRecord')} className="poster-action" onRecorded=${(file) => ctx.sttTest(file)} />
          ${ctx.busy === 'stt' ? html`<${Text} kind="caption" tone="muted">${x('sttTesting')}<//>` : null}
        <//>
        ${ctx.sttError ? html`<${StatusLine} error=${true}>${ctx.sttError}<//>` : null}
        ${r ? html`<${Surface} kind="box" density="compact"><${Stack} density="compact">
          <${Text}>${r.text || x('sttSilent')}<//>
          <${Text} kind="caption" tone="muted">${x('sttResultMeta', { seconds: (Number(r.seconds) || 0).toFixed(1), cost: money(r.usage?.cost_usd || 0), model: r.model || ctx.settings?.sttModel || '' })}${r.usage?.cost_exact === false ? ` · ${x('sttCostNotReported')}` : ''}<//>
        <//><//>` : null}
      <//><//>
    </div>`;
}

/* ── One app in the spend table ───────────────────────────────────────────────────────────────── */

/** One app's cells in the spend Table: the app with its tokens and seconds, 30 days, today, the cap, calls. */
export function appCells(ctx, row, editing) {
  const cap = ctx.quotas?.[row.app]?.daily_usd;
  const draft = ctx.caps?.[row.app];
  const extra = [row.tokens ? x('tokensN', { n: compact(row.tokens) }) : '', row.seconds ? x('secondsN', { n: Math.round(row.seconds) }) : ''].filter(Boolean).join(' · ');
  return [
    html`<${Stack} density="compact"><strong>${row.app}</strong>${extra ? html`<${Text} kind="caption" tone="muted">${extra}<//>` : null}<//>`,
    { text: money(row.cost), mono: true },
    { text: money(row.today), mono: true },
    editing
      ? html`<${Field} type="number" width="narrow" min="0" max="1000" step="0.10" value=${draft ?? ''} placeholder=${x('noCap')} ariaLabel=${x('colCap')} onInput=${(e) => ctx.setCap(row.app, e.target.value)} />`
      : (cap != null ? { text: money(cap), mono: true } : x('noCap')),
    { text: String(row.calls), mono: true },
  ];
}
