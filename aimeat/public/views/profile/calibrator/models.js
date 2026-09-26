/**
 * @file public/views/profile/calibrator/models.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 03 of a calibration: the judge (this calibration's own choice, or the AI
 *   page's reasoning model) and the models under test, as rows, and the picker that opens under
 *   a row: the same catalogue, the same search and the same recommended group as the AI page, so
 *   a model is chosen the same way everywhere. Without a key on the AI page the rows say so and
 *   point there.
 * @structure secModels · judgeRow · candidateRow · picker
 * @usage import { secModels } from './models.js';
 * @version-history
 *   v2.0.0 -- 2026-09-26 -- The page passes data to the library's components and writes no class: the rows are the List with its Panel, the picker the library's Model list (components/ModelPicker.js ModelList, a taken model dimmed with "already added"), the lines Note (component plan, page group G4).
 *   v1.14.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.13.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.12.0 -- 2026-09-26 -- A grey line that explains is the Hint (.poster-hint); the rule that drew it here goes and its place stays (a unification: the look most tabs use).
 *   v1.11.0 -- 2026-09-26 -- A table's cells are the Listing's own: figures the figure cell (.listing-n), words the words cell (.listing-desc), a row of servers the Listing; the rules that drew them here go (a unification: the look most tabs use).
 *   v1.10.0 -- 2026-09-25 -- The model picker is the library's Model picker (css/components/model-picker.css), moved unchanged out of ai-poster.css and calibrator-poster.css (UI consolidation phase 5, a move).
 *   v1.9.0 -- 2026-09-25 -- The judge and the models under test are the Listing (css/components/listing.css), a unification: the look most tabs use.
 *   v1.8.0 — 2026-09-25 — Code inside a sentence or a value line is the code-inline cut of the Code block (UI consolidation phase 5, a unification).
 *   v1.7.0 — 2026-09-25 — A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.6.0 — 2026-09-25 — Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.5.0 — 2026-09-25 — The headings over lists wear .poster-day-title, grey (--quiet) over a record (Jouni's decision "Group heading", a unification).
 *   v1.4.0 — 2026-09-25 — The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.3.0 — 2026-09-25 — A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.2.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   v1.1.0 — 2026-09-25 — The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.0.0 — 2026-09-04 — Initial (replaces calibrator-llm-editor.js v1.0.0).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { Section } from '/components/Section.js';
import { List, Row, Name, Who, Desc, Doors } from '/components/List.js';
import { Action } from '/components/Action.js';
import { Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { ModelList } from '/components/ModelPicker.js';
import { Row as Line } from '/components/Layout.js';
import { openTab } from '/components/Rail.js';
import { rankModels, matchesQuery, modelPageUrl, answersInText } from '/views/profile/openrouter/pricing.js';
import { modelWords, priceWords, contextWords, findModel } from '../ai/frame.js';
import { x, judgeOf, candidatesOf } from './frame.js';

const RECOMMENDED = 8;
const CHAT_ROLE = { pool: 'chat' };

export function secModels(ctx) {
  const p = ctx.project;
  const judge = judgeOf(p, ctx.settings);
  const candidates = candidatesOf(p);
  const count = x('secModelsSub', { n: candidates.length });
  return html`
    <${Section} id="cal-models" num="03" title=${x('secModels')} count=${count}>
      ${!ctx.keyed ? html`<${Note} kind="quiet"><b>${x('noKeyLead')}</b> ${x('noKeyBody')} <${Action} small soft onClick=${() => openTab('ai')}>${x('openAiPage')}<//><//>` : null}
      <${List} cols="name-who-facts-doors" head=${[x('colRole'), x('colModel'), x('colFacts'), '']}>
        ${judgeRow(ctx, judge)}
        ${candidates.map((m, i) => candidateRow(ctx, m, i))}
        ${ctx.pick === 'add' ? html`<${Row} key="add" open panel=${picker(ctx, 'add', '')} />` : null}
      <//>
      <${Line} gap="medium" above="medium" wrap>
        <${Action} small disabled=${!ctx.keyed || !ctx.models.length} onClick=${() => ctx.setPick(ctx.pick === 'add' ? null : 'add')}>${ctx.pick === 'add' ? x('close') : x('addModel')}<//>
        ${!candidates.length ? html`<${Note} inline>${x('noCandidatesHint')}<//>` : null}
      <//>
      <${Note}>${x('hintModels')}<//>
    <//>`;
}

function judgeRow(ctx, judge) {
  const open = ctx.pick === 'judge';
  const model = findModel(judge.modelId, ctx.models);
  const name = judge.modelId ? modelWords(model, judge.modelId) : x('judgeServerDefault');
  const sub = judge.own ? x('judgeOwn') : judge.source === 'reasoning' ? x('judgeFromAiReasoning') : judge.source === 'default' ? x('judgeFromAiDefault') : x('judgeFromServer');
  const facts = model ? [priceWords(model, CHAT_ROLE), contextWords(model)].filter(Boolean).join(' · ') : '';
  const panel = html`
    <${Note} kind="lead">${judge.own ? x('judgeLeadOwn', { name }) : x('judgeLeadAi', { name })}<//>
    ${picker(ctx, 'judge', judge.own ? judge.modelId : '')}`;
  const doors = html`
    ${judge.own ? html`<${Action} small soft disabled=${ctx.busy === 'models'} onClick=${() => ctx.setJudge(null)}>${x('judgeUseAiPage')}<//>` : null}
    ${judge.modelId && ctx.isOpenRouter ? html`<${Action} small soft href=${modelPageUrl(judge.modelId)} newTab>${x('openModelPage')}<//>` : null}
    <${Action} small soft onClick=${() => ctx.setPick(null)}>${x('close')}<//>`;
  return html`
    <${Row} key="judge" id="cal-judge" open=${open} panel=${panel} panelDoors=${doors}>
      <${Name} meta=${x('judgeSub')}>${x('judge')}<//>
      <${Who} sub=${sub}><b>${name}</b>${judge.modelId ? html`<${Code}>${judge.modelId}<//>` : null}<//>
      <${Desc}>${facts}<//>
      <${Doors}><${Action} small row disabled=${!ctx.keyed} onClick=${() => ctx.setPick(open ? null : 'judge')}>${open ? x('close') : x('change')}<//><//>
    <//>`;
}

function candidateRow(ctx, m, i) {
  const model = findModel(m.modelId, ctx.models);
  const facts = model ? [priceWords(model, CHAT_ROLE), contextWords(model)].filter(Boolean).join(' · ') : (ctx.keyed && ctx.models.length ? x('modelNotInList') : '');
  return html`
    <${Row} key=${m.id}>
      <${Name} meta=${x('candidateSub')}>${x('candidateN', { n: i + 1 })}<//>
      <${Who}><b>${modelWords(model, m.modelId)}</b><${Code}>${m.modelId}<//><//>
      <${Desc}>${facts}<//>
      <${Doors}><${Action} small row soft tone="danger" disabled=${ctx.busy === 'models'} onClick=${() => ctx.removeCandidate(m.id)}>${x('remove')}<//><//>
    <//>`;
}

/** The catalogue under an opened row: search, the recommended group, a row per model (ModelList). */
function picker(ctx, slot, chosenId) {
  const pool = (ctx.models || []).filter(answersInText);
  if (!pool.length) return html`<${Note} kind="quiet">${ctx.keyed ? x('modelsNone') : x('noKeyBody')}<//>`;
  const taken = new Set(slot === 'add' ? candidatesOf(ctx.project).map((m) => m.modelId) : []);
  const act = (m) => (slot === 'judge' ? ctx.setJudge(m) : ctx.addCandidate(m));
  return html`
    <${ModelList} models=${pool} recommended=${rankModels(pool, 'chat').slice(0, RECOMMENDED)} value=${chosenId}
      taken=${[...taken]} disabled=${ctx.busy === 'models'} onPick=${act} match=${matchesQuery}
      query=${ctx.query || ''} onQuery=${(v) => ctx.setQuery(v)} showAll=${!!ctx.showAll} onShowAll=${(v) => ctx.setShowAll(v)}
      searchLabel=${x('searchModels', { n: pool.length })} recommendedLabel=${x('recommended')} noMatchLabel=${x('noMatch')}
      showAllLabel=${(n) => x('showAll', { n })} facts=${x('poolFacts', { n: pool.length })}
      describe=${(m) => ({ name: modelWords(m, m.id), note: taken.has(m.id) ? x('alreadyAdded') : '', price: priceWords(m, CHAT_ROLE), context: contextWords(m) })} />`;
}
