/**
 * @file public/views/profile/inbox-tab/interactive-form.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two renderers for an interactive message: InteractiveForm (the questions a
 *   broadcast asks, with single/multi select and an "other" free-text box) and InteractiveAnswered
 *   (the read-only summary once the person has answered).
 *
 *   Moved out of components.js by pure extraction when that file passed 800 lines. Nothing changed:
 *   the pair renders and validates exactly as before, and it never touched the composer's state.
 * @usage import { InteractiveForm, InteractiveAnswered } from './interactive-form.js';
 * @version-history
 *   v1.1.0 -- 2026-09-22 -- Composed from the shared set: each option is a boxed choice (radio
 *     semantics for a single answer, a pressed toggle for many), the "other" box a Field, the
 *     header a Chip. Validation and the answers payload are unchanged.
 *   v1.0.0 — 2026-08-18 — Extracted verbatim from components.js (max-file-lines).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { IFORM_OTHER } from './helpers.js';
import { Action, Chip, Field, Stack, Text } from '/components/poster-parts.js';

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
    const on = !!sel[q.id]?.picks.has(optId);
    return html`<${Action} key=${optId} kind="choice" selected=${on} semantics=${multi ? undefined : 'radio'}
      onClick=${() => (multi ? toggleMulti(q.id, optId) : pickSingle(q.id, optId))}>${label}<//>`;
  };

  return html`
    <${Stack} density="compact">
      ${questions.map(q => html`
        <${Stack} density="compact" key=${q.id}>
          ${q.header ? html`<span><${Chip}>${q.header}<//></span>` : null}
          <${Text}>${q.prompt}${q.required ? ' *' : ''}<//>
          <${Stack} density="compact" role=${q.multiSelect ? 'group' : 'radiogroup'} label=${q.prompt}>
            ${(q.options || []).map(o => renderOpt(q, o.id, o.label))}
            ${q.allowOther !== false ? html`
              ${renderOpt(q, IFORM_OTHER, t('inbox.answer.other'))}
              ${sel[q.id]?.picks.has(IFORM_OTHER) ? html`
                <${Field} value=${sel[q.id]?.other || ''} ariaLabel=${t('inbox.answer.otherPlaceholder')}
                  placeholder=${t('inbox.answer.otherPlaceholder')} onInput=${e => setOther(q.id, e.target.value)} />` : null}` : null}
          <//>
        <//>`)}
      <${Stack} direction="horizontal">
        <${Action} disabled=${!canSubmit || submitting} onClick=${submit}>
          ${submitting ? t('inbox.sending') : (spec?.submitLabel || t('inbox.answer.send'))}
        <//>
      <//>
    <//>`;
}

/** Read-only summary shown on a question bubble once it has been answered. */
export function InteractiveAnswered({ spec, answers }) {
  return html`
    <${Stack} density="compact">
      ${(spec?.questions || []).map(q => {
        const a = answers[q.id] || { selected: [], other: null };
        const labels = (q.options || []).filter(o => a.selected.includes(o.id)).map(o => o.label);
        if (a.other) labels.push(`${t('inbox.answer.other')}: ${a.other}`);
        return html`
          <${Stack} density="compact" key=${q.id}>
            <span><${Chip}>${q.header || q.prompt}<//></span>
            <${Text}>✓ ${labels.length ? labels.join(', ') : '—'}<//>
          <//>`;
      })}
    <//>`;
}
