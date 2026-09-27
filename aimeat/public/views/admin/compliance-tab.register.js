/**
 * @file compliance-tab.register.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sections 04 and 05 of the admin Compliance page: the register as a filterable table
 *   with a who-answered column, one opened entry as a framed sheet with its fields on underlines
 *   and the questions as rows with a yes/no choice, the three ways to start when the register
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
 *   - ClassChip · classWord — the class as a status mark
 *   - AnswerPick — one question's answer: yes/no, or one of its options
 *   - questionRow — one question, its answer and its source, as a reading
 *   - EntrySheet — one opened entry
 *   - RegisterSection — section 04
 *   - QuestionnaireSection — section 05
 * @usage imported by compliance-tab.js
 * @version-history
 *   v3.0.0 — 2026-09-27 — Library components only: the class is a status Mark by its tone, the
 *     filters Tabs and the SearchLine, the table a List with its own cut and More at its foot, the
 *     opened entry a Box with TextFields in Fields and its questions Readings with a Choice (yes/no,
 *     pressed again to take it back) or a Select, the question set a List of codes and words. The
 *     file writes no class.
 *   v2.1.0 — 2026-09-13 — Compose section headings from the shared poster B1 shape.
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
import { Section } from '/components/Section.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Mark, Label } from '/components/Mark.js';
import { Tinted } from '/components/Figure.js';
import { Box } from '/components/Box.js';
import { Readings } from '/components/Readings.js';
import { Tabs } from '/components/Tabs.js';
import { Choice } from '/components/Choice.js';
import { Select } from '/components/Select.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Fields, FormActions } from '/components/Field.js';
import { Row as Line, Columns } from '/components/Layout.js';
import { List, Row, Name, Cell, Doors, SearchLine, More } from '/components/List.js';

const html = htm.bind(h);
const C = (key, params) => t('admin.compliance.' + key, params);
const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/** Class id → the mark's tone. Unclassified is off on purpose: nobody has looked, and a calm colour
 *  there would read as a pass. */
const TONE = { prohibited: 'danger', high: 'danger', limited: 'attention', minimal: 'fine', unclassified: 'off' };

export const classWord = (cls) => tOr('admin.compliance.class.' + cls, cls);

export function ClassChip({ cls }) {
  const c = cls || 'unclassified';
  return html`<${Mark} kind="status" tone=${TONE[c] || 'off'}>${classWord(c)}<//>`;
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

/** A yes/no as the choice; a question with options as a select. Pressing the chosen answer again
 *  clears it, so an answer given by mistake can be taken back. */
function AnswerPick({ q, value, onChange }) {
  if (q.type === 'boolean') {
    return html`<${Choice} clearable ariaLabel=${q.text} value=${value} options=${[[true, C('yes')], [false, C('no')]]}
      onChange=${(v) => onChange(v === '' ? undefined : v)} />`;
  }
  return html`<${Select} fit ariaLabel=${q.text} value=${isBlank(value) ? '' : String(value)} placeholder=${C('pickAnswer')}
    options=${(q.options || []).map(o => ({ value: o.value, label: o.label }))}
    onChange=${(raw) => onChange(raw === '' ? undefined : raw)} />`;
}

/** One question as a reading: the question and its help, the answer, and who gave it. */
function questionRow(q, value, source, onChange, last) {
  const blank = isBlank(value);
  const src = blank ? C('waitsForYou')
    : source === 'evidence' ? C('answerFromEvidence')
    : source === 'ai' ? C('answerFromAi')
    : C('answerFromHuman');
  return {
    key: q.id,
    name: q.text,
    why: q.help || undefined,
    mark: html`<${AnswerPick} q=${q} value=${value} onChange=${onChange} />`,
    value: blank ? html`<${Tinted} tone="notice">${src}<//>` : src,
    last,
  };
}

/**
 * One opened entry: the fields, what decided its class, and the questions.
 *
 * The models and apps fields keep their own text while being typed: the entry holds them as
 * lists, and re-rendering a list joined with ", " on every keystroke eats the comma the person
 * has just typed.
 */
function EntrySheet({ u, questions, onPatch, onAnswer, onRemove, onClose }) {
  const [modelsText, setModelsText] = useState((u.models || []).join(', '));
  const [appsText, setAppsText] = useState((u.apps || []).join(', '));
  const reasons = (u.risk && u.risk.reasons) || [];
  const open = answersOf(u, questions).unanswered;
  return html`
    <${Box} id="adm-cmp-sheet" name=${u.title || u.id} marks=${html` <${ClassChip} cls=${u.risk && u.risk.class} />`}
      end=${html`<${Actions}>
        <${Action} small tone="danger" onClick=${onRemove}>${C('ucRemove')}<//>
        <${Action} small soft onClick=${onClose}>${C('close')}<//>
      <//>`}>
      <${Fields} cols=${2}>
        <${TextField} label=${C('ucTitle')} value=${u.title || ''} onInput=${(v) => onPatch({ title: v })} />
        <${TextField} code label=${C('ucId')} value=${u.id || ''} onInput=${(v) => onPatch({ id: v })} />
        <${TextArea} wide label=${C('ucPurpose')} rows=${3} value=${u.purpose || ''} onInput=${(v) => onPatch({ purpose: v })} />
        <${TextField} code label=${C('ucModels')} hint=${C('ucModelsHint')} placeholder="anthropic/claude-opus-5, google/gemini-3-pro" value=${modelsText}
          onInput=${(v) => { setModelsText(v); onPatch({ models: splitList(v) }); }} />
        <${TextField} code label=${C('ucApps')} placeholder="alice/newsroom.html" value=${appsText}
          onInput=${(v) => { setAppsText(v); onPatch({ apps: splitList(v) }); }} />
        <${TextField} wide label=${C('ucSubjects')} value=${u.dataSubjects || ''} onInput=${(v) => onPatch({ dataSubjects: v })} />
      <//>
      ${reasons.length > 0 ? html`<${Note} kind="hint"><${Tinted} strong>${C('printWhy')}<//> ${reasons.map(reasonText).join(' · ')}<//>` : null}
      <${Label} block>${C('answersTitle')}<//>
      ${open > 0 ? html`<${Note} kind="hint"><${Tinted} tone="notice" strong>${open === 1 ? C('unansweredOne') : C('unansweredMany', { n: num(open) })}<//><//>` : null}
      <${Readings} rows=${questions.map((q, i) => questionRow(q, (u.answers || {})[q.id], (u.answerSources || {})[q.id],
        (v) => onAnswer(q.id, v), i === questions.length - 1))} />
    <//>`;
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
  const draftWords = drafting ? C('drafting') : C('draftAction');

  const empty = html`
    <${Note} kind="lead">${C('registerEmptyLead')}<//>
    <${Readings} rows=${[
      { key: 'one', name: C('way.one'), why: C('way.oneWhy'), end: html`<${Loud} control disabled=${drafting} onClick=${onDraft}>${draftWords}<//>` },
      { key: 'two', name: C('way.two'), why: C('way.twoWhy'), end: html`<${Action} small soft onClick=${() => go('adm-cmp-07')}>${C('toPaste')}<//>` },
      { key: 'three', name: C('way.three'), why: C('way.threeWhy'), end: html`<${Action} small soft onClick=${addOne}>${C('ucAdd')}<//>`, last: true },
    ]} />`;

  const filled = html`
    <${Note} kind="lead">${C('registerNote')}<//>
    <${Line} wrap gap="medium" below="small">
      <${Tabs} tone="filter" value=${cls} onSelect=${pickClass} items=${[
        { value: 'all', label: C('filterAll', { n: num(list.length) }) },
        ...CLASS_ORDER.map(c => ({ value: c, label: classWord(c), count: num(countOf(c)) })),
      ]} />
      <${SearchLine} beside placeholder=${C('search')} value=${query}
        onInput=${(e) => { setQuery(e.currentTarget.value); setShown(PAGE); }} />
    <//>
    <${List} cols="name-state-meta-meta-doors" empty=${C('noneMatch')}
      head=${[C('col.what'), C('col.class'), C('col.models'), C('col.answered'), '']}
      rows=${visible} render=${(u) => {
        const unclassified = ((u.risk && u.risk.class) || 'unclassified') === 'unclassified';
        const isOpen = openId === u.id;
        return html`
          <${Row} key=${u.id} selected=${isOpen}>
            <${Name} desc=${u.purpose || undefined}>${u.title || u.id}<//>
            <${Cell} line><${ClassChip} cls=${u.risk && u.risk.class} /><//>
            <${Cell} meta>${modelsShort(u.models) || C('none')}<//>
            <${Cell} meta>${answeredText(u, questions)}<//>
            <${Doors}><${Action} small soft expanded=${isOpen} onClick=${() => setOpenId(isOpen ? null : u.id)}>
              ${isOpen ? C('close') : unclassified ? C('answer') : C('edit')}<//><//>
          <//>`;
      }} />
    <${More} label=${C('showNext', { n: num(Math.min(PAGE, filtered.length - shown)) })}
      onMore=${filtered.length > shown ? () => setShown(s => s + PAGE) : null}
      note=${C('foot', {
        shown: num(Math.min(shown, filtered.length)), total: num(list.length),
        ai: num(stats.ai), human: num(stats.human), evidence: num(stats.evidence), unanswered: num(stats.unanswered),
      })} />
    ${open ? html`
      <${EntrySheet} key=${openIndex} u=${open} questions=${questions}
        onPatch=${(p) => patch(open.id, p)} onAnswer=${(qid, v) => answer(open.id, qid, v)}
        onRemove=${() => remove(open.id)} onClose=${() => setOpenId(null)} />` : null}`;

  return html`
    <${Section} id="adm-cmp-04" num="04" title=${C('registerTitle')}
      doors=${list.length > 0 ? html`
        <${Action} small soft disabled=${drafting} onClick=${onDraft}>${draftWords}<//>
        <${Action} small soft onClick=${addOne}>${C('ucAdd')}<//>` : null}>
      <${ConfirmUI} />
      ${list.length === 0 ? empty : filled}
      ${list.length > 0 || dirty ? html`
        <${FormActions}>
          <${Loud} control disabled=${!dirty || saving} onClick=${() => onSave(list)}>${saving ? C('saving') : C('save')}<//>
          ${dirty ? html`<${Action} small soft onClick=${() => { setDraft(null); setOpenId(null); }}>${C('discard')}<//>` : null}
          <${Note} kind="meta" inline mono>${C('saveNote')}<//>
        <//>` : null}
    <//>`;
}

/** What a question's answers imply, as marks beside it. */
function impliesChips(q) {
  const s = impliesSummary(q);
  if (s.length === 0) return html`<${Mark} kind="status" tone="off">${C('qs.impliesNone')}<//>`;
  return s.map(({ answer, cls }) => html`
    <${Mark} key=${answer + cls} kind="status" tone=${TONE[cls] || 'off'}>
      ${answer === 'choice' ? C('qs.impliesChoice', { cls: classWord(cls) }) : C('qs.implies', { answer: answer === 'yes' ? C('yes') : C('no'), cls: classWord(cls) })}
    <//>`);
}

export function QuestionnaireSection({ questionnaire }) {
  if (!questionnaire) return null;
  const qs = questionnaire.questions || [];
  const half = Math.ceil(qs.length / 2);
  const col = (items) => html`
    <${List} cols="tag-name" rows=${items} render=${(q) => html`
      <${Row} key=${q.id}>
        <${Cell} sign>${q.id}<//>
        <${Cell} line>${q.text} ${impliesChips(q)}<//>
      <//>`} />`;
  return html`
    <${Section} id="adm-cmp-05" num="05" title=${C('qsTitle')}
      doors=${html`<${Note} kind="meta" inline mono>${C('qsVersion', { v: questionnaire.version || '' })}<//>`}>
      <${Note} kind="lead">${C('qsNote')}<//>
      <${Columns}>
        <div>${col(qs.slice(0, half))}</div>
        <div>${col(qs.slice(half))}</div>
      <//>
    <//>`;
}
