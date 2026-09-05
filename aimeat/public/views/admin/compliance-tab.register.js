/**
 * @file compliance-tab.register.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sections 04 and 05 of the admin Compliance page: the register as a filterable table
 *   with a who-answered column, one opened entry as a framed sheet with its fields on underlines
 *   and the questions as rows with a segmented yes/no, the three ways to start when the register
 *   is empty, and the question set itself with what each answer implies.
 *
 *   THE ANSWER FORM IS BUILT FROM THE QUESTION SET, never from a hardcoded list. That is the visible
 *   half of "the question set is data": an operator who adds a question sees a new row here on the
 *   next load, with no release. A form that named its own fields would quietly stop matching the set
 *   the report classifies against, and the two would disagree with nobody noticing.
 *
 *   A WRITE REPLACES THE WHOLE REGISTER, so the editor always sends every use case it is holding.
 *   The alternative — sending one — deletes the rest, which is the shape of mistake a UI must not
 *   make on the operator's behalf.
 *
 *   EVERY ANSWER SAYS WHO GAVE IT. An answer set here is marked "human"; the node's draft marks
 *   "evidence" and an agent marks "ai". The column in the table and the source beside each
 *   question read that mark, because it is the first thing an auditor asks about an answer.
 *
 *   THE DRAFT STATE LIVES IN THE TAB, NOT HERE. Section 01's "Fill these in for me" and the empty
 *   state's slab both add to the same unsaved list, so the list is the tab's and this section
 *   edits it through setDraft. Every edit is a functional update against the previous list: two
 *   changes inside one batch would otherwise both read the same snapshot and the second would
 *   discard the first, which a real browser showed at typing speed.
 * @structure
 *   - ClassChip · classWord — the class as a square mono chip
 *   - QuestionRow — one question, its choice and its source
 *   - EntrySheet — one opened entry
 *   - RegisterSection — section 04
 *   - QuestionnaireSection — section 05
 * @usage imported by compliance-tab.js
 * @version-history
 *   v2.0.0 — 2026-09-05 — The poster face: the table with filters, the framed sheet, the segmented
 *     choice, the who-answered column, the three ways to start in the empty state.
 *   v1.0.0 — 2026-08-23 — BR-02, ring 1 (node-wide).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t, tOr } from '/js/i18n.js';
import { num } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import {
  PAGE, CLASS_ORDER, answersOf, answerStats, classCounts, orderUsecases, filterUsecases, impliesSummary, modelsShort,
} from './compliance-tab.gaps.js';

const html = htm.bind(h);
const C = (key, params) => t('admin.compliance.' + key, params);
const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/** Class id → the chip's tone. Unclassified is dim on purpose: nobody has looked, and a calm colour
 *  there would read as a pass. */
const TONE = { prohibited: 'bad', high: 'bad', limited: 'warn', minimal: 'ok', unclassified: 'dim' };

export const classWord = (cls) => tOr('admin.compliance.class.' + cls, cls);

export function ClassChip({ cls }) {
  const c = cls || 'unclassified';
  return html`<span class="og-chip adm-cmp-chip--${TONE[c] || 'dim'}">${classWord(c)}</span>`;
}

/** The list of strings behind a comma-separated input, empty entries dropped. */
const splitList = (s) => String(s || '').split(',').map(x => x.trim()).filter(Boolean);

/** One reason the class was reached, in words: the question, the answer, the class it implies. */
function reasonText(r) {
  if (typeof r === 'string') return r;
  const answer = r.answer === 'true' ? C('yes') : r.answer === 'false' ? C('no') : String(r.answer ?? '');
  return `${r.question || r.questionId || ''} ${answer} → ${classWord(r.impliesClass || '')}`;
}
const isBlank = (v) => v === undefined || v === null || v === '';

/** `11 of 12 · AI 9 · you 2`: how far one entry is, and who did the answering. */
function answeredText(u, questions) {
  const a = answersOf(u, questions);
  const head = a.answered === a.total ? num(a.total) : C('answeredOf', { answered: num(a.answered), total: num(a.total) });
  const parts = [];
  if (a.ai) parts.push(C('src.ai', { n: num(a.ai) }));
  if (a.human) parts.push(C('src.you', { n: num(a.human) }));
  if (a.evidence) parts.push(C('src.record', { n: num(a.evidence) }));
  return [head, ...parts].join(' · ');
}

/** A yes/no as the segmented choice; a question with options as an underline select. Pressing the
 *  lit half again clears the answer, so an answer given by mistake can be taken back. */
function Choice({ q, value, onChange }) {
  if (q.type === 'boolean') {
    const pick = (v) => onChange(value === v ? undefined : v);
    return html`<span class="og-choice">
      <button type="button" class="og-choice-btn ${value === true ? 'on' : ''}" onClick=${() => pick(true)}>${C('yes')}</button>
      <button type="button" class="og-choice-btn ${value === false ? 'on' : ''}" onClick=${() => pick(false)}>${C('no')}</button>
    </span>`;
  }
  return html`<select class="adm-cmp-qsel" value=${isBlank(value) ? '' : String(value)}
    onChange=${(e) => { const raw = e.currentTarget.value; onChange(raw === '' ? undefined : raw); }}>
    <option value="">${C('pickAnswer')}</option>
    ${(q.options || []).map(o => html`<option key=${o.value} value=${o.value}>${o.label}</option>`)}
  </select>`;
}

function QuestionRow({ q, value, source, onChange, last }) {
  const blank = isBlank(value);
  const src = blank ? C('waitsForYou')
    : source === 'evidence' ? C('answerFromEvidence')
    : source === 'ai' ? C('answerFromAi')
    : C('answerFromHuman');
  return html`
    <div class="adm-cmp-qrow ${last ? 'adm-cmp-qrow--last' : ''}">
      <span>${q.text}${q.help ? html`<span class="adm-why">${q.help}</span>` : null}</span>
      <${Choice} q=${q} value=${value} onChange=${onChange} />
      <span class="adm-cmp-src ${blank ? 'adm-cmp-src--waits' : ''}">${src}</span>
    </div>`;
}

/**
 * One opened entry: the fields on underlines, what decided its class, and the questions.
 *
 * The models and apps fields keep their own text while being typed: the entry holds them as
 * lists, and re-rendering a list joined with ", " on every keystroke eats the comma the person
 * has just typed.
 */
function EntrySheet({ u, questions, onPatch, onAnswer, onRemove, onClose }) {
  const [modelsText, setModelsText] = useState((u.models || []).join(', '));
  const [appsText, setAppsText] = useState((u.apps || []).join(', '));
  const field = (label, control, wide) => html`
    <div class="og-field ${wide ? 'adm-cmp-field--wide' : ''}"><span class="og-label">${label}</span>${control}</div>`;
  const text = (key, mono) => html`
    <input type="text" class="og-input ${mono ? 'og-input--mono' : ''}" value=${u[key] || ''} onInput=${(e) => onPatch({ [key]: e.currentTarget.value })} />`;
  const reasons = (u.risk && u.risk.reasons) || [];
  const open = answersOf(u, questions).unanswered;
  return html`
    <div class="adm-cmp-sheet" id="adm-cmp-sheet">
      <div class="adm-cmp-sheet-h">
        <div class="adm-cmp-sheet-title">${u.title || u.id}<${ClassChip} cls=${u.risk && u.risk.class} /></div>
        <div class="og-doors">
          <button type="button" class="og-door og-door--danger" onClick=${onRemove}>${C('ucRemove')}</button>
          <button type="button" class="og-door og-door--quiet" onClick=${onClose}>${C('close')}</button>
        </div>
      </div>
      <div class="adm-cmp-fields">
        ${field(C('ucTitle'), text('title'))}
        ${field(C('ucId'), text('id', true))}
        ${field(C('ucPurpose'), html`<textarea class="adm-cmp-fbox" rows="3" value=${u.purpose || ''} onInput=${(e) => onPatch({ purpose: e.currentTarget.value })}></textarea>`, true)}
        ${field(C('ucModels'), html`
          <input type="text" class="og-input og-input--mono" placeholder="anthropic/claude-opus-5, google/gemini-3-pro" value=${modelsText}
            onInput=${(e) => { setModelsText(e.currentTarget.value); onPatch({ models: splitList(e.currentTarget.value) }); }} />
          <span class="adm-why">${C('ucModelsHint')}</span>`)}
        ${field(C('ucApps'), html`
          <input type="text" class="og-input og-input--mono" placeholder="alice/newsroom.html" value=${appsText}
            onInput=${(e) => { setAppsText(e.currentTarget.value); onPatch({ apps: splitList(e.currentTarget.value) }); }} />`)}
        ${field(C('ucSubjects'), text('dataSubjects'), true)}
      </div>
      ${reasons.length > 0 ? html`<p class="adm-cmp-why-line"><b>${C('printWhy')}</b> ${reasons.map(reasonText).join(' · ')}</p>` : null}
      <div class="adm-cmp-qlbl">${C('answersTitle')}</div>
      ${open > 0 ? html`<p class="adm-cmp-why-line adm-cmp-q-waits">${open === 1 ? C('unansweredOne') : C('unansweredMany', { n: num(open) })}</p>` : null}
      ${questions.map((q, i) => html`
        <${QuestionRow} key=${q.id} q=${q} value=${(u.answers || {})[q.id]} source=${(u.answerSources || {})[q.id]}
          onChange=${(v) => onAnswer(q.id, v)} last=${i === questions.length - 1} />`)}
    </div>`;
}

export function RegisterSection({ usecases, questions, draft, setDraft, openId, setOpenId, saving, drafting, onSave, onDraft }) {
  const [cls, setCls] = useState('all');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const { confirm, ConfirmUI } = useConfirm();

  const list = draft ?? usecases;
  const dirty = draft !== null;
  const filtered = filterUsecases(orderUsecases(list), cls, query);
  const visible = filtered.slice(0, shown);
  const counts = classCounts(list);
  const countOf = (c) => (counts.find(x => x.cls === c) || {}).n || 0;
  const stats = answerStats(list, questions);

  const update = (fn) => setDraft((prev) => fn(prev ?? usecases));
  const patch = (id, p) => {
    update(b => b.map(u => (u.id === id ? { ...u, ...p } : u)));
    if (p.id !== undefined) setOpenId(p.id);
  };
  const answer = (id, qid, value) => update(b => b.map(u => {
    if (u.id !== id) return u;
    const answers = { ...(u.answers || {}) };
    const answerSources = { ...(u.answerSources || {}) };
    if (value === undefined) { delete answers[qid]; delete answerSources[qid]; }
    else { answers[qid] = value; answerSources[qid] = 'human'; }
    return { ...u, answers, answerSources };
  }));
  const remove = (id) => confirm(
    C('removeConfirm', { id }),
    () => { update(b => b.filter(u => u.id !== id)); setOpenId(null); },
    { danger: true, title: C('registerTitle') },
  );
  const addOne = () => {
    const id = `uc-${Date.now().toString(36)}`;
    update(b => [...b, { id, title: '', answers: {}, answerSources: {} }]);
    setOpenId(id); setCls('all'); setQuery('');
  };
  const pickClass = (c) => { setCls(c); setShown(PAGE); };

  const open = list.find(u => u.id === openId) || null;
  const openIndex = open ? list.indexOf(open) : -1;
  const draftDoor = (klass) => html`
    <button type="button" class=${klass} disabled=${drafting} onClick=${onDraft}>${drafting ? C('drafting') : C('draftAction')}</button>`;

  const empty = html`
    <p class="adm-cmp-lead">${C('registerEmptyLead')}</p>
    <div class="adm-mrow adm-mrow--two">
      <span><b>${C('way.one')}</b><span class="adm-why">${C('way.oneWhy')}</span></span>
      <span class="adm-cmp-right">${draftDoor('og-slab')}</span>
    </div>
    <div class="adm-mrow adm-mrow--two">
      <span><b>${C('way.two')}</b><span class="adm-why">${C('way.twoWhy')}</span></span>
      <span class="adm-cmp-right"><button type="button" class="og-door og-door--quiet" onClick=${() => go('adm-cmp-07')}>${C('toPaste')}</button></span>
    </div>
    <div class="adm-mrow adm-mrow--two adm-mrow--last">
      <span><b>${C('way.three')}</b><span class="adm-why">${C('way.threeWhy')}</span></span>
      <span class="adm-cmp-right"><button type="button" class="og-door og-door--quiet" onClick=${addOne}>${C('ucAdd')}</button></span>
    </div>`;

  const filled = html`
    <p class="adm-cmp-lead">${C('registerNote')}</p>
    <div class="adm-cmp-filters">
      <button type="button" class="adm-cmp-fchip ${cls === 'all' ? 'on' : ''}" onClick=${() => pickClass('all')}>${C('filterAll', { n: num(list.length) })}</button>
      ${CLASS_ORDER.map(c => html`
        <button key=${c} type="button" class="adm-cmp-fchip ${cls === c ? 'on' : ''}" onClick=${() => pickClass(c)}>${classWord(c)} ${num(countOf(c))}</button>`)}
      <span class="adm-cmp-sep"></span>
      <input type="search" class="adm-cmp-search" placeholder=${C('search')} value=${query}
        onInput=${(e) => { setQuery(e.currentTarget.value); setShown(PAGE); }} />
    </div>
    ${filtered.length === 0 ? html`<div class="adm-cmp-empty adm-cmp-empty--last">${C('noneMatch')}</div>` : html`
      <table class="adm-cmp-tbl">
        <thead><tr><th>${C('col.what')}</th><th>${C('col.class')}</th><th>${C('col.models')}</th><th>${C('col.answered')}</th><th></th></tr></thead>
        <tbody>
          ${visible.map(u => {
            const unclassified = ((u.risk && u.risk.class) || 'unclassified') === 'unclassified';
            const isOpen = openId === u.id;
            return html`
              <tr key=${u.id}>
                <td class="adm-cmp-name"><b>${u.title || u.id}</b>${u.purpose ? html`<span class="adm-why">${u.purpose}</span>` : null}</td>
                <td class="adm-cmp-cell-class"><${ClassChip} cls=${u.risk && u.risk.class} /></td>
                <td class="adm-cmp-cell-mono">${modelsShort(u.models) || C('none')}</td>
                <td class="adm-cmp-cell-mono">${answeredText(u, questions)}</td>
                <td class="og-tbl-door"><button type="button" class="og-door og-door--quiet" onClick=${() => setOpenId(isOpen ? null : u.id)}>
                  ${isOpen ? C('close') : unclassified ? C('answer') : C('edit')}</button></td>
              </tr>`;
          })}
        </tbody>
      </table>`}
    <div class="adm-cmp-foot">
      <div class="og-doors">
        ${filtered.length > shown ? html`
          <button type="button" class="og-door" onClick=${() => setShown(s => s + PAGE)}>${C('showNext', { n: num(Math.min(PAGE, filtered.length - shown)) })}</button>` : null}
      </div>
      <span class="adm-cmp-mono">${C('foot', {
        shown: num(Math.min(shown, filtered.length)), total: num(list.length),
        ai: num(stats.ai), human: num(stats.human), evidence: num(stats.evidence), unanswered: num(stats.unanswered),
      })}</span>
    </div>
    ${open ? html`
      <${EntrySheet} key=${openIndex} u=${open} questions=${questions}
        onPatch=${(p) => patch(open.id, p)} onAnswer=${(qid, v) => answer(open.id, qid, v)}
        onRemove=${() => remove(open.id)} onClose=${() => setOpenId(null)} />` : null}`;

  return html`
    <section class="og-sec adm-cmp-no-print" id="adm-cmp-04">
      <${ConfirmUI} />
      <div class="og-sec-h"><h2>${C('registerTitle')}<small>04</small></h2>
        ${list.length > 0 ? html`<div class="og-doors">
          ${draftDoor('og-door og-door--quiet')}
          <button type="button" class="og-door og-door--quiet" onClick=${addOne}>${C('ucAdd')}</button>
        </div>` : null}
      </div>
      ${list.length === 0 ? empty : filled}
      ${list.length > 0 || dirty ? html`
        <div class="adm-cmp-save">
          <button type="button" class="og-slab" disabled=${!dirty || saving} onClick=${() => onSave(list)}>${saving ? C('saving') : C('save')}</button>
          ${dirty ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => { setDraft(null); setOpenId(null); }}>${C('discard')}</button>` : null}
          <span class="adm-cmp-mono">${C('saveNote')}</span>
        </div>` : null}
    </section>`;
}

/** What a question's answers imply, as chips beside it. */
function impliesChips(q) {
  const s = impliesSummary(q);
  if (s.length === 0) return html`<span class="og-chip adm-cmp-chip--dim">${C('qs.impliesNone')}</span>`;
  return s.map(({ answer, cls }) => html`
    <span key=${answer + cls} class="og-chip adm-cmp-chip--${TONE[cls] || 'dim'}">
      ${answer === 'choice' ? C('qs.impliesChoice', { cls: classWord(cls) }) : C('qs.implies', { answer: answer === 'yes' ? C('yes') : C('no'), cls: classWord(cls) })}
    </span>`);
}

export function QuestionnaireSection({ questionnaire }) {
  if (!questionnaire) return null;
  const qs = questionnaire.questions || [];
  const half = Math.ceil(qs.length / 2);
  const col = (items) => items.map((q, i) => html`
    <div class="adm-cmp-limit ${i === items.length - 1 ? 'adm-cmp-limit--last' : ''}" key=${q.id}>
      <i>${q.id}</i>
      <span>${q.text} ${impliesChips(q)}</span>
    </div>`);
  return html`
    <section class="og-sec adm-cmp-no-print" id="adm-cmp-05">
      <div class="og-sec-h"><h2>${C('qsTitle')}<small>05</small></h2>
        <div class="og-doors"><span class="adm-cmp-mono">${C('qsVersion', { v: questionnaire.version || '' })}</span></div></div>
      <p class="adm-cmp-lead">${C('qsNote')}</p>
      <div class="adm-two">
        <div>${col(qs.slice(0, half))}</div>
        <div>${col(qs.slice(half))}</div>
      </div>
    </section>`;
}
