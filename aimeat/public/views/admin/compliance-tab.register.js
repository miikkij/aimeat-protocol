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
 *   v3.0.0 -- 2026-09-22 -- Composed from the shared component set: the register is the shared
 *     table under a toolbar, the opened entry a record surface with shared fields, a yes/no two tab
 *     actions, the questions compact list rows, the class a shared chip (prohibited on the danger
 *     ground, high coral, limited plain, minimal green, unclassified muted). No classes of its own.
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
import { Section, Columns, Stack, ListRow, Toolbar, Table, Field, Action, Chip, Surface, Text, scrollToId } from '/components/poster-parts.js';

const html = htm.bind(h);
const C = (key, params) => t('admin.compliance.' + key, params);
const go = (id) => scrollToId(id);

/** Class id → the chip's tone. Unclassified is muted on purpose: nobody has looked, and a calm colour
 *  there would read as a pass. */
const TONE = { prohibited: 'danger', high: 'coral', limited: 'plain', minimal: 'success', unclassified: 'muted' };

export const classWord = (cls) => tOr('admin.compliance.class.' + cls, cls);

export function ClassChip({ cls }) {
  const c = cls || 'unclassified';
  return html`<${Chip} tone=${TONE[c] || 'muted'}>${classWord(c)}<//>`;
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

/** A yes/no as two tab actions; a question with options as a select. Pressing the lit half again
 *  clears the answer, so an answer given by mistake can be taken back. */
function Choice({ q, value, onChange }) {
  if (q.type === 'boolean') {
    const pick = (v) => onChange(value === v ? undefined : v);
    return html`<${Stack} direction="horizontal" align="center" density="compact" role="group" label=${q.text}>
      <${Action} kind="tab" selected=${value === true} onClick=${() => pick(true)}>${C('yes')}<//>
      <${Action} kind="tab" selected=${value === false} onClick=${() => pick(false)}>${C('no')}<//>
    <//>`;
  }
  return html`<${Field} type="select" ariaLabel=${q.text} value=${isBlank(value) ? '' : String(value)}
    onChange=${(e) => { const raw = e.currentTarget.value; onChange(raw === '' ? undefined : raw); }}
    options=${[{ value: '', label: C('pickAnswer') }, ...(q.options || []).map(o => ({ value: o.value, label: o.label }))]} />`;
}

function QuestionRow({ q, value, source, onChange }) {
  const blank = isBlank(value);
  const src = blank ? C('waitsForYou')
    : source === 'evidence' ? C('answerFromEvidence')
    : source === 'ai' ? C('answerFromAi')
    : C('answerFromHuman');
  return html`<${ListRow} density="compact" name=${q.text} detail=${q.help || null} detailKind="text"
    value=${html`<${Choice} q=${q} value=${value} onChange=${onChange} />`}
    actions=${html`<${Text} kind="mono" tone=${blank ? 'coral' : 'muted'}>${src}<//>`} />`;
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
  const text = (key, label) => html`<${Field} label=${label} value=${u[key] || ''} onInput=${(e) => onPatch({ [key]: e.currentTarget.value })} />`;
  const reasons = (u.risk && u.risk.reasons) || [];
  const open = answersOf(u, questions).unanswered;
  return html`<${Surface} kind="record" id="adm-cmp-sheet">
    <${Stack}>
      <${Stack} direction="wrap" align="between">
        <${Stack} direction="horizontal" align="center" density="compact">
          <${Text} kind="heading" size="small">${u.title || u.id}<//><${ClassChip} cls=${u.risk && u.risk.class} />
        <//>
        <${Stack} direction="horizontal" align="center">
          <${Action} tone="danger" onClick=${onRemove}>${C('ucRemove')}<//>
          <${Action} onClick=${onClose}>${C('close')}<//>
        <//>
      <//>
      <${Columns} layout="equal" collapse=${600}>
        ${text('title', C('ucTitle'))}
        ${text('id', C('ucId'))}
      <//>
      <${Field} type="textarea" label=${C('ucPurpose')} rows=${3} value=${u.purpose || ''} onInput=${(e) => onPatch({ purpose: e.currentTarget.value })} />
      <${Columns} layout="equal" collapse=${600}>
        <${Stack} density="compact">
          <${Field} label=${C('ucModels')} placeholder="anthropic/claude-opus-5, google/gemini-3-pro" value=${modelsText} passwordManager=${false}
            onInput=${(e) => { setModelsText(e.currentTarget.value); onPatch({ models: splitList(e.currentTarget.value) }); }} />
          <${Text} kind="caption" tone="muted">${C('ucModelsHint')}<//>
        <//>
        <${Field} label=${C('ucApps')} placeholder="alice/newsroom.html" value=${appsText} passwordManager=${false}
          onInput=${(e) => { setAppsText(e.currentTarget.value); onPatch({ apps: splitList(e.currentTarget.value) }); }} />
      <//>
      ${text('dataSubjects', C('ucSubjects'))}
      ${reasons.length > 0 ? html`<${Text} tone="muted"><strong>${C('printWhy')}</strong> ${reasons.map(reasonText).join(' · ')}<//>` : null}
      <${Stack} density="compact">
        <${Text} kind="label">${C('answersTitle')}<//>
        ${open > 0 ? html`<${Text} tone="coral"><strong>${open === 1 ? C('unansweredOne') : C('unansweredMany', { n: num(open) })}</strong><//>` : null}
        <div>
          ${questions.map((q) => html`
            <${QuestionRow} key=${q.id} q=${q} value=${(u.answers || {})[q.id]} source=${(u.answerSources || {})[q.id]}
              onChange=${(v) => onAnswer(q.id, v)} />`)}
        </div>
      <//>
    <//>
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
  const draftDoor = (kind) => html`
    <${Action} kind=${kind} disabled=${drafting} onClick=${onDraft}>${drafting ? C('drafting') : C('draftAction')}<//>`;

  const empty = html`<div>
    <${ListRow} name=${C('way.one')} detail=${C('way.oneWhy')} detailKind="text" actions=${draftDoor('primary')} />
    <${ListRow} name=${C('way.two')} detail=${C('way.twoWhy')} detailKind="text"
      actions=${html`<${Action} onClick=${() => go('adm-cmp-07')}>${C('toPaste')}<//>`} />
    <${ListRow} name=${C('way.three')} detail=${C('way.threeWhy')} detailKind="text"
      actions=${html`<${Action} onClick=${addOne}>${C('ucAdd')}<//>`} />
  </div>`;

  const rows = visible.map(u => {
    const unclassified = ((u.risk && u.risk.class) || 'unclassified') === 'unclassified';
    const isOpen = openId === u.id;
    return [
      html`<${Stack} density="compact"><strong>${u.title || u.id}</strong>${u.purpose ? html`<${Text} kind="caption" tone="muted">${u.purpose}<//>` : null}<//>`,
      html`<${ClassChip} cls=${u.risk && u.risk.class} />`,
      { text: modelsShort(u.models) || C('none'), mono: true },
      { text: answeredText(u, questions), mono: true },
      html`<${Action} expanded=${isOpen} onClick=${() => setOpenId(isOpen ? null : u.id)}>
        ${isOpen ? C('close') : unclassified ? C('answer') : C('edit')}<//>`,
    ];
  });

  const filled = html`<${Stack}>
    <${Toolbar} label=${C('search')}
      filters=${[
        { id: 'all', label: C('filterAll', { n: num(list.length) }), selected: cls === 'all', onClick: () => pickClass('all') },
        ...CLASS_ORDER.map(c => ({ id: c, label: `${classWord(c)} ${num(countOf(c))}`, selected: cls === c, onClick: () => pickClass(c) })),
      ]}
      search=${{ ariaLabel: C('search'), placeholder: C('search'), value: query, onInput: (e) => { setQuery(e.currentTarget.value); setShown(PAGE); } }} />
    ${filtered.length === 0 ? html`<${Text} tone="muted">${C('noneMatch')}<//>` : html`
      <${Table} label=${C('registerTitle')} collapse=${600} density="compact" rows=${rows}
        headers=${[C('col.what'), C('col.class'), C('col.models'), C('col.answered'), '']} />`}
    <${Stack} direction="wrap" align="between">
      ${filtered.length > shown
        ? html`<${Action} onClick=${() => setShown(s => s + PAGE)}>${C('showNext', { n: num(Math.min(PAGE, filtered.length - shown)) })}<//>`
        : html`<span></span>`}
      <${Text} kind="mono" tone="muted">${C('foot', {
        shown: num(Math.min(shown, filtered.length)), total: num(list.length),
        ai: num(stats.ai), human: num(stats.human), evidence: num(stats.evidence), unanswered: num(stats.unanswered),
      })}<//>
    <//>
    ${open ? html`
      <${EntrySheet} key=${openIndex} u=${open} questions=${questions}
        onPatch=${(p) => patch(open.id, p)} onAnswer=${(qid, v) => answer(open.id, qid, v)}
        onRemove=${() => remove(open.id)} onClose=${() => setOpenId(null)} />` : null}
  <//>`;

  return html`<${Section} id="adm-cmp-04" title=${C('registerTitle')} count="04"
    description=${list.length === 0 ? C('registerEmptyLead') : C('registerNote')}
    actions=${list.length > 0 ? html`${draftDoor('secondary')}<${Action} onClick=${addOne}>${C('ucAdd')}<//>` : null}>
    <${ConfirmUI} />
    <${Stack}>
      ${list.length === 0 ? empty : filled}
      ${list.length > 0 || dirty ? html`<${Stack} direction="wrap" align="center">
        <${Action} kind="primary" disabled=${!dirty || saving} onClick=${() => onSave(list)}>${saving ? C('saving') : C('save')}<//>
        ${dirty ? html`<${Action} onClick=${() => { setDraft(null); setOpenId(null); }}>${C('discard')}<//>` : null}
        <${Text} kind="mono" tone="muted">${C('saveNote')}<//>
      <//>` : null}
    <//>
  <//>`;
}

/** What a question's answers imply, as chips beside it. */
function impliesChips(q) {
  const s = impliesSummary(q);
  if (s.length === 0) return html`<${Chip} tone="muted">${C('qs.impliesNone')}<//>`;
  return s.map(({ answer, cls }) => html`
    <${Chip} key=${answer + cls} tone=${TONE[cls] || 'muted'}>
      ${answer === 'choice' ? C('qs.impliesChoice', { cls: classWord(cls) }) : C('qs.implies', { answer: answer === 'yes' ? C('yes') : C('no'), cls: classWord(cls) })}
    <//>`);
}

export function QuestionnaireSection({ questionnaire }) {
  if (!questionnaire) return null;
  const qs = questionnaire.questions || [];
  const half = Math.ceil(qs.length / 2);
  const col = (items) => html`<div>${items.map((q) => html`<${ListRow} key=${q.id} density="compact"
    name=${html`<${Text} kind="mono" tone="coral">${q.id}<//>`} detail=${q.text} detailKind="text">
    <${Stack} direction="wrap" align="center" density="compact">${impliesChips(q)}<//>
  <//>`)}</div>`;
  return html`<${Section} id="adm-cmp-05" title=${C('qsTitle')} count="05" description=${C('qsNote')}
    actions=${html`<${Text} kind="mono" tone="muted">${C('qsVersion', { v: questionnaire.version || '' })}<//>`}>
    <${Columns} layout="equal" collapse=${900}>
      ${col(qs.slice(0, half))}
      ${col(qs.slice(half))}
    <//>
  <//>`;
}
