/**
 * @file public/views/profile/inbox-tab/interactive-form.js
 * @description The two renderers for an interactive message: InteractiveForm (the questions a
 *   broadcast asks, with single/multi select and an "other" free-text box) and InteractiveAnswered
 *   (the read-only summary once the person has answered).
 *
 *   Moved out of components.js by pure extraction when that file passed 800 lines. Nothing changed:
 *   the pair renders and validates exactly as before, and it never touched the composer's state.
 * @usage import { InteractiveForm, InteractiveAnswered } from './interactive-form.js';
 * @version-history
 *   v1.0.0 — 2026-08-18 — Extracted verbatim from components.js (max-file-lines).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { IFORM_OTHER } from './helpers.js';

const html = htm.bind(h);

/** The interactive question form rendered inline in the thread (a federated AskUserQuestion): radio
 *  groups (single-select), checkbox groups (multiSelect), an always-available "Other" freeform, and a
 *  Submit button gated until every `required` question is answered. */
export function InteractiveForm({ spec, submitting, onSubmit }) {
  const questions = spec?.questions || [];
  const [sel, setSel] = useState(() => {
    const init = {};
    for (const q of questions) init[q.id] = { picks: new Set(), other: '' };
    return init;
  });
  const setQ = (qid, updater) => setSel(prev => ({ ...prev, [qid]: updater(prev[qid] || { picks: new Set(), other: '' }) }));
  const pickSingle = (qid, optId) => setQ(qid, s => ({ picks: new Set([optId]), other: optId === IFORM_OTHER ? s.other : '' }));
  const toggleMulti = (qid, optId) => setQ(qid, s => {
    const picks = new Set(s.picks);
    if (picks.has(optId)) picks.delete(optId); else picks.add(optId);
    return { picks, other: picks.has(IFORM_OTHER) ? s.other : '' };
  });
  const setOther = (qid, text) => setQ(qid, s => ({ picks: s.picks, other: text }));

  const answeredOk = (q) => {
    const s = sel[q.id]; if (!s) return false;
    const realPicks = [...s.picks].filter(p => p !== IFORM_OTHER);
    const otherOk = s.picks.has(IFORM_OTHER) && s.other.trim().length > 0;
    return realPicks.length > 0 || otherOk;
  };
  const canSubmit = questions.every(q => !q.required || answeredOk(q));

  const submit = () => {
    if (!canSubmit || submitting) return;
    const answers = {};
    for (const q of questions) {
      const s = sel[q.id] || { picks: new Set(), other: '' };
      const selected = [...s.picks].filter(p => p !== IFORM_OTHER);
      const other = (s.picks.has(IFORM_OTHER) && s.other.trim()) ? s.other.trim() : null;
      answers[q.id] = { selected, other };
    }
    onSubmit?.(answers);
  };

  const renderOpt = (q, optId, label) => {
    const multi = !!q.multiSelect;
    const on = sel[q.id]?.picks.has(optId);
    return html`
      <label class=${`inbox-iform-opt${on ? ' inbox-iform-opt--on' : ''}`} key=${optId}>
        <input type=${multi ? 'checkbox' : 'radio'} name=${`q-${q.id}`} checked=${!!on}
          onChange=${() => multi ? toggleMulti(q.id, optId) : pickSingle(q.id, optId)} />
        <span class="inbox-iform-opt-label">${escHtml(label)}</span>
      </label>`;
  };

  return html`
    <div class="inbox-iform">
      ${questions.map(q => html`
        <div class="inbox-iform-q" key=${q.id}>
          ${q.header ? html`<span class="inbox-iform-chip">${escHtml(q.header)}</span>` : null}
          <div class="inbox-iform-prompt">${escHtml(q.prompt)}${q.required ? html`<span class="inbox-iform-req"> *</span>` : null}</div>
          <div class="inbox-iform-opts" role=${q.multiSelect ? 'group' : 'radiogroup'}>
            ${(q.options || []).map(o => renderOpt(q, o.id, o.label))}
            ${q.allowOther !== false ? html`
              ${renderOpt(q, IFORM_OTHER, t('inbox.answer.other'))}
              ${sel[q.id]?.picks.has(IFORM_OTHER) ? html`
                <input class="inbox-iform-other" type="text" value=${sel[q.id]?.other || ''}
                  placeholder=${t('inbox.answer.otherPlaceholder')} onInput=${e => setOther(q.id, e.target.value)} />` : null}` : null}
          </div>
        </div>`)}
      <button class="btn-primary btn-sm inbox-iform-submit" disabled=${!canSubmit || submitting} onClick=${submit}>
        ${submitting ? t('inbox.sending') : (spec?.submitLabel || t('inbox.answer.send'))}
      </button>
    </div>`;
}

/** Read-only summary shown on a question bubble once it has been answered. */
export function InteractiveAnswered({ spec, answers }) {
  return html`
    <div class="inbox-iform inbox-iform--done">
      ${(spec?.questions || []).map(q => {
        const a = answers[q.id] || { selected: [], other: null };
        const labels = (q.options || []).filter(o => a.selected.includes(o.id)).map(o => o.label);
        if (a.other) labels.push(`${t('inbox.answer.other')}: ${a.other}`);
        return html`
          <div class="inbox-iform-q" key=${q.id}>
            <span class="inbox-iform-chip">${escHtml(q.header || q.prompt)}</span>
            <div class="inbox-iform-answered">✓ ${labels.length ? escHtml(labels.join(', ')) : '—'}</div>
          </div>`;
      })}
    </div>`;
}
