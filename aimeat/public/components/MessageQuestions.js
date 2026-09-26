/**
 * @file public/components/MessageQuestions.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The questions a message asks (a federated AskUserQuestion), as part of the Message
 *   component (component plan C2): each question with its short name as a Tag, its words, a star when
 *   it must be answered, its choices (one of them, or several), an "Other" line to write in, and the
 *   loud action that sends the answers, held until every required question has one. Once answered,
 *   the message shows what was chosen instead. The page passes the question record and what sending
 *   does; it never writes a class. The look is css/components/message.css (.message-questions*).
 * @structure MessageQuestions({ spec, answers, submitting, onSubmit }) · QUESTION_OTHER
 * @usage html`<${MessageQuestions} spec=${msg.interactive} submitting=${busy} onSubmit=${(answers) => …} />`
 *        html`<${MessageQuestions} spec=${msg.interactive} answers=${given.answers} />` (answered)
 *   `answers` given = the read-only summary; `onSubmit(answers)` gets { [questionId]: { selected: [optionId…], other } }.
 * @version-history
 *   v1.0.0 — 2026-09-26 — Moved out of views/profile/inbox-tab/interactive-form.js (InteractiveForm,
 *     InteractiveAnswered) with the same behaviour; the inbox-iform class names became the
 *     component's own (message-questions*).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Mark } from '/components/Mark.js';
import { Loud } from '/components/Action.js';

const html = htm.bind(h);

/** The id of the "Other" choice (never the id of a real choice). */
export const QUESTION_OTHER = '__other__';

/** The questions still to answer: radio groups (one of), checkbox groups (several), an always-there
 *  "Other" line, and a send held until every `required` question is answered. */
function QuestionForm({ spec, submitting, onSubmit }) {
  const questions = spec?.questions || [];
  const [sel, setSel] = useState(() => {
    const init = {};
    for (const q of questions) init[q.id] = { picks: new Set(), other: '' };
    return init;
  });
  const setQ = (qid, updater) => setSel(prev => ({ ...prev, [qid]: updater(prev[qid] || { picks: new Set(), other: '' }) }));
  const pickSingle = (qid, optId) => setQ(qid, s => ({ picks: new Set([optId]), other: optId === QUESTION_OTHER ? s.other : '' }));
  const toggleMulti = (qid, optId) => setQ(qid, s => {
    const picks = new Set(s.picks);
    if (picks.has(optId)) picks.delete(optId); else picks.add(optId);
    return { picks, other: picks.has(QUESTION_OTHER) ? s.other : '' };
  });
  const setOther = (qid, text) => setQ(qid, s => ({ picks: s.picks, other: text }));

  const answeredOk = (q) => {
    const s = sel[q.id]; if (!s) return false;
    const realPicks = [...s.picks].filter(p => p !== QUESTION_OTHER);
    const otherOk = s.picks.has(QUESTION_OTHER) && s.other.trim().length > 0;
    return realPicks.length > 0 || otherOk;
  };
  const canSubmit = questions.every(q => !q.required || answeredOk(q));

  const submit = () => {
    if (!canSubmit || submitting) return;
    const answers = {};
    for (const q of questions) {
      const s = sel[q.id] || { picks: new Set(), other: '' };
      const selected = [...s.picks].filter(p => p !== QUESTION_OTHER);
      const other = (s.picks.has(QUESTION_OTHER) && s.other.trim()) ? s.other.trim() : null;
      answers[q.id] = { selected, other };
    }
    onSubmit?.(answers);
  };

  const renderOpt = (q, optId, label) => {
    const multi = !!q.multiSelect;
    const on = sel[q.id]?.picks.has(optId);
    return html`
      <label class=${`message-questions-opt${on ? ' message-questions-opt--on' : ''}`} key=${optId}>
        <input type=${multi ? 'checkbox' : 'radio'} name=${`q-${q.id}`} checked=${!!on}
          onChange=${() => multi ? toggleMulti(q.id, optId) : pickSingle(q.id, optId)} />
        <span class="message-questions-opt-label">${label}</span>
      </label>`;
  };

  return html`
    <div class="message-questions">
      ${questions.map(q => html`
        <div class="message-questions-q" key=${q.id}>
          ${q.header ? html`<span class="message-questions-tag"><${Mark}>${q.header}<//></span>` : null}
          <div class="message-questions-prompt">${q.prompt}${q.required ? html`<span class="message-questions-req"> *</span>` : null}</div>
          <div class="message-questions-opts" role=${q.multiSelect ? 'group' : 'radiogroup'}>
            ${(q.options || []).map(o => renderOpt(q, o.id, o.label))}
            ${q.allowOther !== false ? html`
              ${renderOpt(q, QUESTION_OTHER, t('inbox.answer.other'))}
              ${sel[q.id]?.picks.has(QUESTION_OTHER) ? html`
                <input class="og-input message-questions-other" type="text" value=${sel[q.id]?.other || ''}
                  placeholder=${t('inbox.answer.otherPlaceholder')} onInput=${e => setOther(q.id, e.target.value)} />` : null}` : null}
          </div>
        </div>`)}
      <span class="message-questions-send"><${Loud} control disabled=${!canSubmit || submitting} onClick=${submit}>
        ${submitting ? t('inbox.sending') : (spec?.submitLabel || t('inbox.answer.send'))}
      <//></span>
    </div>`;
}

/** What was answered, read only. */
function QuestionAnswers({ spec, answers }) {
  return html`
    <div class="message-questions message-questions--done">
      ${(spec?.questions || []).map(q => {
        const a = answers[q.id] || { selected: [], other: null };
        const labels = (q.options || []).filter(o => a.selected.includes(o.id)).map(o => o.label);
        if (a.other) labels.push(`${t('inbox.answer.other')}: ${a.other}`);
        return html`
          <div class="message-questions-q" key=${q.id}>
            <span class="message-questions-tag"><${Mark}>${q.header || q.prompt}<//></span>
            <div class="message-questions-answered">✓ ${labels.length ? labels.join(', ') : '—'}</div>
          </div>`;
      })}
    </div>`;
}

/** The questions: the form, or with `answers` what was answered. */
export function MessageQuestions({ spec, answers, submitting, onSubmit }) {
  if (!spec) return null;
  return answers
    ? html`<${QuestionAnswers} spec=${spec} answers=${answers} />`
    : html`<${QuestionForm} spec=${spec} submitting=${submitting} onSubmit=${onSubmit} />`;
}

export default MessageQuestions;
