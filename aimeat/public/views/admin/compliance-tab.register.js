/**
 * @file compliance-tab.register.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The register editor and the question-set view for the admin compliance tab. Split out
 *   of compliance-tab.js by pure extraction so both stay under the file-length ceiling.
 *
 *   THE ANSWER FORM IS BUILT FROM THE QUESTION SET, never from a hardcoded list. That is the visible
 *   half of "the question set is data": an operator who adds a question sees a new field here on the
 *   next load, with no release. A form that named its own fields would quietly stop matching the set
 *   the report classifies against, and the two would disagree with nobody noticing.
 *
 *   A WRITE REPLACES THE WHOLE REGISTER, so the editor always sends every use case it is holding.
 *   The alternative — sending one — deletes the rest, which is the shape of mistake a UI must not
 *   make on the operator's behalf.
 * @structure
 *   - RiskBadge — the class, with the reason it was reached
 *   - UseCaseEditor — one use case, its fields and its answers
 *   - RegisterSection — the list, the add button, the save
 *   - QuestionnaireSection — the set, read-only here, with where to change it
 * @usage imported by compliance-tab.js
 * @version-history
 *   v1.0.0 — 2026-08-23 — BR-02, ring 1 (node-wide).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Empty, DataTable, ExpandableHelp } from './shared.js';

/** Class id → the tone the badge borrows. Unknown ids fall back rather than render unstyled. */
const TONE = {
  prohibited: 'danger', high: 'danger', limited: 'warn', minimal: 'ok', unclassified: 'dim',
};

export function RiskBadge({ risk }) {
  const tone = TONE[risk?.class] || 'dim';
  return html`<span class="adm-cmp-risk adm-cmp-risk--${tone}">${escHtml(risk?.label || risk?.class || '—')}</span>`;
}

/** The list of strings behind a comma-separated input, empty entries dropped. */
const splitList = (s) => String(s || '').split(',').map(x => x.trim()).filter(Boolean);

function AnswerField({ question, value, onChange }) {
  const unanswered = value === undefined || value === null || value === '';
  const options = question.type === 'boolean'
    ? [{ value: 'true', label: t('admin.compliance.yes') }, { value: 'false', label: t('admin.compliance.no') }]
    : (question.options || []).map(o => ({ value: o.value, label: o.label }));
  const current = question.type === 'boolean'
    ? (unanswered ? '' : (value ? 'true' : 'false'))
    : (unanswered ? '' : String(value));
  return html`
    <label class="adm-cmp-q">
      <span class="adm-cmp-q-text">
        ${escHtml(question.text)}
        ${unanswered && html`<span class="adm-cmp-q-todo">${t('admin.compliance.unanswered')}</span>`}
      </span>
      ${question.help && html`<span class="adm-cmp-q-help">${escHtml(question.help)}</span>`}
      <select
        value=${current}
        onChange=${(e) => {
          const raw = e.currentTarget.value;
          if (raw === '') { onChange(undefined); return; }
          onChange(question.type === 'boolean' ? raw === 'true' : raw);
        }}
      >
        <option value="">${t('admin.compliance.pickAnswer')}</option>
        ${options.map(o => html`<option key=${o.value} value=${o.value}>${escHtml(o.label)}</option>`)}
      </select>
    </label>
  `;
}

/**
 * One use case, its fields and its answers.
 *
 * It emits PATCHES rather than a whole next object, and the parent merges them against its own
 * current state. Spreading the `useCase` prop here looked equivalent and was not: the prop is the
 * value captured at render, so two changes inside one batch both read the stale copy and the second
 * silently discards the first. Found by driving a real browser and setting fourteen fields at once —
 * one survived. A person typing quickly, or a paste that fires several input events, hits the same
 * thing.
 */
export function UseCaseEditor({ useCase, questionnaire, onPatch, onAnswer, onRemove }) {
  const set = onPatch;
  return html`
    <div class="adm-cmp-editor">
      <div class="adm-cmp-editor-row">
        <label>
          <span>${t('admin.compliance.ucTitle')}</span>
          <input type="text" value=${useCase.title || ''} onInput=${(e) => set({ title: e.currentTarget.value })} />
        </label>
        <label>
          <span>${t('admin.compliance.ucId')}</span>
          <input type="text" value=${useCase.id || ''} onInput=${(e) => set({ id: e.currentTarget.value })} />
        </label>
      </div>
      <label>
        <span>${t('admin.compliance.ucPurpose')}</span>
        <textarea rows="2" value=${useCase.purpose || ''} onInput=${(e) => set({ purpose: e.currentTarget.value })}></textarea>
      </label>
      <div class="adm-cmp-editor-row">
        <label>
          <span>${t('admin.compliance.ucModels')}</span>
          <input
            type="text" placeholder="anthropic/claude-opus-5, google/gemini-3-pro"
            value=${(useCase.models || []).join(', ')}
            onInput=${(e) => set({ models: splitList(e.currentTarget.value) })}
          />
          <span class="adm-cmp-hint">${t('admin.compliance.ucModelsHint')}</span>
        </label>
        <label>
          <span>${t('admin.compliance.ucApps')}</span>
          <input
            type="text" placeholder="alice/newsroom.html"
            value=${(useCase.apps || []).join(', ')}
            onInput=${(e) => set({ apps: splitList(e.currentTarget.value) })}
          />
        </label>
      </div>
      <label>
        <span>${t('admin.compliance.ucSubjects')}</span>
        <input type="text" value=${useCase.dataSubjects || ''} onInput=${(e) => set({ dataSubjects: e.currentTarget.value })} />
      </label>

      <h4 class="adm-cmp-sub">${t('admin.compliance.answersTitle')}</h4>
      <p class="adm-cmp-note">${t('admin.compliance.answersNote')}</p>
      ${(questionnaire?.questions || []).map(q => html`
        <${AnswerField}
          key=${q.id}
          question=${q}
          value=${(useCase.answers || {})[q.id]}
          onChange=${(v) => onAnswer(q.id, v)}
        />
      `)}

      <button type="button" class="btn-danger" onClick=${onRemove}>${t('admin.compliance.ucRemove')}</button>
    </div>
  `;
}

export function RegisterSection({ usecases, questionnaire, saving, onSave }) {
  const [draft, setDraft] = useState(null);
  const [openId, setOpenId] = useState(null);

  const list = draft ?? usecases;
  const dirty = draft !== null;

  // Every edit is a functional update against the PREVIOUS draft, never against the `list` captured
  // by this render. Two changes inside one batch would otherwise both read the same snapshot and the
  // second would discard the first — measured in a browser, and invisible at human typing speed.
  const patchAt = (i, patch) => setDraft((prev) => (prev ?? usecases).map((u, j) => (j === i ? { ...u, ...patch } : u)));
  const answerAt = (i, questionId, value) => setDraft((prev) => (prev ?? usecases).map((u, j) => {
    if (j !== i) return u;
    const answers = { ...(u.answers || {}) };
    if (value === undefined) delete answers[questionId]; else answers[questionId] = value;
    return { ...u, answers };
  }));
  const removeAt = (i) => setDraft((prev) => (prev ?? usecases).filter((_, j) => j !== i));
  const addOne = () => {
    setDraft((prev) => [...(prev ?? usecases), { id: `uc-${Date.now().toString(36)}`, title: '', answers: {} }]);
    setOpenId(null);
  };

  return html`
    <section class="adm-cmp-section">
      <h3>${t('admin.compliance.registerTitle')}</h3>
      <p class="adm-cmp-note">${t('admin.compliance.registerNote')}</p>

      ${list.length === 0 && html`<${Empty} text=${t('admin.compliance.registerEmpty')} />`}

      ${list.length > 0 && html`
        <${DataTable}
          headers=${[t('admin.compliance.ucTitle'), t('admin.compliance.risk'), t('admin.compliance.ucModels'), '']}
          rows=${list.map((u) => [
            escHtml(u.title || u.id),
            html`<${RiskBadge} risk=${u.risk} />`,
            html`<span class="mono adm-cmp-small">${escHtml((u.models || []).join(', ') || '—')}</span>`,
            html`<button type="button" class="btn-ghost" onClick=${() => setOpenId(openId === u.id ? null : u.id)}>
              ${openId === u.id ? t('admin.compliance.close') : t('admin.compliance.edit')}
            </button>`,
          ])}
        />
      `}

      ${list.map((u, i) => openId === u.id && html`
        <${UseCaseEditor}
          key=${u.id}
          useCase=${u}
          questionnaire=${questionnaire}
          onPatch=${(patch) => patchAt(i, patch)}
          onAnswer=${(qid, v) => answerAt(i, qid, v)}
          onRemove=${() => { removeAt(i); setOpenId(null); }}
        />
      `)}

      <div class="adm-cmp-actions adm-cmp-no-print">
        <button type="button" class="btn-outline" onClick=${addOne}>${t('admin.compliance.ucAdd')}</button>
        <button
          type="button" class="btn-primary"
          disabled=${!dirty || saving}
          onClick=${async () => { await onSave(list); setDraft(null); }}
        >${saving ? t('admin.compliance.saving') : t('admin.compliance.save')}</button>
        ${dirty && html`<button type="button" class="btn-ghost" onClick=${() => { setDraft(null); setOpenId(null); }}>
          ${t('admin.compliance.discard')}
        </button>`}
      </div>
    </section>
  `;
}

export function QuestionnaireSection({ questionnaire }) {
  if (!questionnaire) return null;
  return html`
    <section class="adm-cmp-section">
      <h3>${t('admin.compliance.qsTitle')}</h3>
      <p class="adm-cmp-note">
        ${t('admin.compliance.qsNote')} <span class="mono">${escHtml(questionnaire.version)}</span>
      </p>
      <p class="adm-cmp-note">${escHtml(questionnaire.note || '')}</p>
      <${ExpandableHelp} title=${t('admin.compliance.qsShow')}>
        <ul class="adm-cmp-qs">
          ${(questionnaire.questions || []).map(q => html`
            <li key=${q.id}>
              <span class="adm-cmp-q-text">${escHtml(q.text)}</span>
              <span class="mono adm-cmp-small">${escHtml(q.id)}</span>
              ${Object.entries(q.implies || {}).length > 0 && html`
                <span class="adm-cmp-small">
                  ${Object.entries(q.implies).map(([a, c]) => `${a} → ${c}`).join(' · ')}
                </span>
              `}
            </li>
          `)}
        </ul>
      <//>
    </section>
  `;
}
