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
 *   v1.14.0 -- 2026-09-26 -- Every part is a kit component (List Row with its Name, Who, Desc, Num, Doors and Panel; ModelList for the picker; Facts; Check; TextField; Box; Note; Action; VoiceRecorder's small cut): the page passes data and writes no class (page group G8).
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
import { Row, Name, Who, Desc, Num, Doors, Panel } from '/components/List.js';
import { ModelList } from '/components/ModelPicker.js';
import { Facts, FactLine } from '/components/Facts.js';
import { Tinted } from '/components/Figure.js';
import { Box } from '/components/Box.js';
import { TextField } from '/components/TextField.js';
import { Check } from '/components/Check.js';
import { Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Action, Actions } from '/components/Action.js';
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
  // A role with no model says so in grey (main's .is-unset).
  const modelWord = unset ? html`<${Tinted} tone="dim">${x('roleUnset')}<//>` : html`${modelWords(model, id)} <${Code}>${id}<//>`;
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
    <${Row} key=${role.id} open=${open} id=${'ai-role-' + role.id}>
      <${Name} meta=${x('roleSub.' + role.id)}>${x('role.' + role.id)}<//>
      <${Who} sub=${sub}>${modelWord}<//>
      <${Desc}>${x('roleWhat.' + role.id)}<//>
      <${Doors}><${Action} small row disabled=${!keyed} onClick=${() => ctx.toggleRole(role.id)}>${open ? x('close') : x('change')}<//><//>
      ${open ? roleOpen(ctx, role, pool, model, id) : null}
    <//>`;
}

function roleOpen(ctx, role, pool, model, id) {
  const lead = id
    ? x('roleLead', { name: modelWords(model, id), price: model ? priceWords(model, role) : '', ctx: model ? contextWords(model) : '' })
    : (role.off === 'default' ? x('roleLeadUnsetDefault') : x('roleLeadUnsetOff'));
  const doors = html`
    ${id ? html`<${Action} small soft disabled=${ctx.busy === 'role'} onClick=${() => ctx.setRole(role, '')}>${role.off === 'default' ? x('clearToDefault') : x('turnOff')}<//>` : null}
    ${id && ctx.isOpenRouter ? html`<${Action} small soft href=${modelPageUrl(id)} newTab>${x('openModelPage')}<//>` : null}
    <${Action} small soft onClick=${() => ctx.toggleRole(role.id)}>${x('close')}<//>`;
  return html`
    <${Panel} doors=${doors}>
      <${Note} kind="lead">${lead} ${x('roleWhat.' + role.id)}<//>
      ${pool.length ? html`
        <${ModelList} models=${pool} recommended=${rankModels(pool, role.pool).slice(0, RECOMMENDED)} value=${id}
          disabled=${ctx.busy === 'role'} onPick=${(m) => ctx.setRole(role, m.id)}
          match=${(m, q) => matchesQuery(m, q.trim().toLowerCase())}
          query=${ctx.query || ''} onQuery=${(q) => ctx.setQuery(q)} showAll=${ctx.showAll} onShowAll=${(v) => ctx.setShowAll(v)}
          searchLabel=${x('searchModels', { n: pool.length })} recommendedLabel=${x('recommended')} noMatchLabel=${x('noMatch')}
          showAllLabel=${(n) => x('showAll', { n })} facts=${x('poolFacts.' + role.pool, { n: pool.length })}
          describe=${(m) => describe(role, m)} />`
        : html`<${Note} kind="quiet">${role.pool === 'transcription' ? x('sttNone') : role.pool === 'image' ? x('imageNone') : x('modelsNone')}<//>`}
      ${role.id === 'stt' ? sttPanel(ctx) : null}
    <//>`;
}

/** What one model's row in the picker says: its name, its traits, its price and its context. */
function describe(role, m) {
  const tr = modelTraits(m);
  const trait = [tr.free ? x('traitFree') : '', tr.varies ? x('traitVaries') : '', tr.images && role.pool !== 'vision' && role.pool !== 'image' ? x('readsImages') : ''].filter(Boolean).join(' · ');
  return { name: modelWords(m, m.id), trait, price: priceWords(m, role), context: contextWords(m) };
}

function sttPanel(ctx) {
  const lang = ctx.settings?.sttLanguage || '';
  const r = ctx.sttResult;
  const max = Math.min(30, Number(ctx.settings?.limits?.voice_msg_max_seconds) || 30);
  const langs = STT_LANGS.map((code) => html`<${Check} radio inline name="ai-stt-lang" key=${code || 'auto'} checked=${lang === code} disabled=${ctx.busy === 'role'} onChange=${() => ctx.setSttLanguage(code)}>${code ? t('profile.openrouter.stt.lang_' + code) : x('sttLangDetect')}<//>`);
  const result = r ? html`<${Box} tone="row">${r.text || x('sttSilent')}<${Note} kind="meta">${x('sttResultMeta', { seconds: (Number(r.seconds) || 0).toFixed(1), cost: money(r.usage?.cost_usd || 0), model: r.model || ctx.settings?.sttModel || '' })}${r.usage?.cost_exact === false ? ` · ${x('sttCostNotReported')}` : ''}<//><//>` : null;
  const measured = html`
    <${FactLine} sub=${x('sttMeasuredSub', { max, limit: Number(ctx.settings?.limits?.voice_msg_max_seconds) || 300 })}>${x('sttMeasuredBody')}<//>
    <${Actions}>
      <${VoiceRecorder} small maxSeconds=${max} disabled=${ctx.busy === 'stt' || !ctx.settings?.sttModel} label=${x('sttRecord')} onRecorded=${(file) => ctx.sttTest(file)} />
      ${ctx.busy === 'stt' ? html`<${Note} kind="message">${x('sttTesting')}<//>` : null}
    <//>
    ${ctx.sttError ? html`<${Note} kind="message" error>${ctx.sttError}<//>` : null}
    ${result}`;
  return html`<${Facts} rows=${[
    { k: x('sttLanguage'), v: langs, sub: x('sttLanguageHint') },
    { k: x('sttMeasured'), v: measured },
  ]} />`;
}

/* ── One app in the spend table ───────────────────────────────────────────────────────────────── */

export function appRow(ctx, row, editing) {
  const cap = ctx.quotas?.[row.app]?.daily_usd;
  const draft = ctx.caps?.[row.app];
  return html`
    <${Row} key=${row.app}>
      <${Name} meta=${[row.tokens ? x('tokensN', { n: compact(row.tokens) }) : '', row.seconds ? x('secondsN', { n: Math.round(row.seconds) }) : ''].filter(Boolean).join(' · ')}>${row.app}<//>
      <${Num}>${money(row.cost)}<//>
      <${Num} dim>${money(row.today)}<//>
      ${editing
        ? html`<${Num}><${TextField} type="number" size="short" min="0" max="1000" step="0.10" value=${draft ?? ''} placeholder=${x('noCap')} ariaLabel=${x('colCap')} onInput=${(v) => ctx.setCap(row.app, v)} /><//>`
        : cap != null ? html`<${Num} strong>${money(cap)}<//>` : html`<${Num} dim>${x('noCap')}<//>`}
      <${Num} dim>${row.calls}<//>
    <//>`;
}
