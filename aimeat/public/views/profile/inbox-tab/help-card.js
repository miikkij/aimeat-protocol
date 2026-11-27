/**
 * @file public/views/profile/inbox-tab/help-card.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The question card inside a message of kind `help-question` (Ask someone who knows):
 *   what the question is, what was tried, its topics and why it came to this person, and what they can
 *   do with it. A helper answers with the thread's own composer (a plain reply is the answer), with
 *   Reply with AI, or with a prompt for their own AI; approves the draft their AI wrote; refers it to
 *   someone else; or passes. The asker sees the question's state and marks it solved, with thanks.
 *   The design canvas board "Viestit" (2026-11-14) is the model.
 *
 *   ONE READ PER CARD: GET /v1/help/threads/:conversationId answers this viewer's side only. Re-read
 *   on `aimeat-live-update`, never on a timer.
 * @structure HelpQuestionCard
 * @usage html`<${HelpQuestionCard} msg=${msg} onReply=${() => onQuote(msg)} onReplyAi=${() => onReplyAi(msg)} />` (message-turn.js)
 * @version-history
 *   v1.0.1 — 2026-11-28 — The answer prompt copies under common.copyForAi, the one name of a prompt copy;
 *     help.card.copyPrompt had the same words.
 *   v1.0.0 — 2026-11-14 — Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';
import { date } from '/js/format.js';
import { helpThread, respondHelp, closeHelp, answerPrompt } from '/js/services/help.js';
import { Box } from '/components/Box.js';
import { Facts } from '/components/Facts.js';
import { Mark, Marks } from '/components/Mark.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Check } from '/components/Check.js';
import { Stack } from '/components/Layout.js';

const html = htm.bind(h);
const x = (key, vars) => t(`help.card.${key}`, vars);

/** The helper's side: the question, why it came, the draft, and what to do with it. */
function HelperSide({ v, onReply, onReplyAi, act, busy }) {
  const [referTo, setReferTo] = useState('');
  const [referring, setReferring] = useState(false);
  const [draft, setDraft] = useState(v.draft?.answer || '');
  useEffect(() => setDraft(v.draft?.answer || ''), [v.draft?.answer]);
  const open = v.state === 'open' || v.state === 'answered';
  return html`
    <${Stack} gap="medium">
      ${v.why?.length ? html`<${Note} kind="hint">${x('why', { topics: v.why.join(', ') })}<//>` : null}
      ${v.my_outcome === 'passed' ? html`<${Note} kind="quiet">${x('youPassed')}<//>` : null}
      ${v.my_outcome === 'referred' ? html`<${Note} kind="quiet">${x('youReferred')}<//>` : null}
      ${v.my_outcome === 'answered' ? html`<${Note} kind="quiet">${x('youAnswered')}<//>` : null}
      ${v.draft && open ? html`
        <${Box} tone="raised" name=${x('draftTitle')}>
          <${TextArea} label=${x('draftLabel')} value=${draft} rows=${5} onInput=${setDraft} />
          <${Actions}>
            <${Loud} control disabled=${busy || !draft.trim()} onClick=${() => act(() => respondHelp(v.question_id, { action: 'approve', answer: draft.trim() }), x('sentDone'))}>${x('approve')}<//>
          <//>
        <//>` : null}
      ${open && v.may?.answer ? html`
        <${Actions}>
          <${Action} small onClick=${onReply}>${x('reply')}<//>
          <${Action} small onClick=${onReplyAi}>${x('replyAi')}<//>
          <${Action} small soft copy=${answerPrompt(v.question_id, v.subject)} copiedLabel=${x('copied')}>${t('common.copyForAi')}<//>
          ${v.may?.refer ? html`<${Action} small soft onClick=${() => setReferring(!referring)}>${x('refer')}<//>` : null}
          ${v.may?.pass ? html`<${Action} small soft onClick=${() => act(() => respondHelp(v.question_id, { action: 'pass' }), x('passedDone'))}>${x('pass')}<//>` : null}
        <//>` : null}
      ${referring ? html`
        <${TextField} label=${x('referLabel')} value=${referTo} onInput=${setReferTo}
          onEnter=${() => referTo.trim() && act(() => respondHelp(v.question_id, { action: 'refer', to: referTo.trim() }), x('referredDone'))}
          actions=${html`<${Action} small disabled=${busy || !referTo.trim()} onClick=${() => act(() => respondHelp(v.question_id, { action: 'refer', to: referTo.trim() }), x('referredDone'))}>${x('referSend')}<//>`} />` : null}
      ${open && v.may?.answer ? html`<${Note} kind="quiet">${x('replyCounts')}<//>` : null}
    <//>`;
}

/** The asker's side: the state, and "solved" once someone answered. */
function AskerSide({ v, act, busy }) {
  const [thanks, setThanks] = useState('');
  const [keep, setKeep] = useState(true);
  const answered = v.state === 'answered';
  const keepable = (v.answers ?? []).some((a) => a.keep_allowed);
  return html`
    <${Stack} gap="medium">
      <${Note} kind="hint">${x(`state.${v.state}`)}${v.waiting && v.state === 'open' ? ` ${x('waiting')}` : ''}<//>
      ${answered ? html`
        <${TextField} label=${x('thanksLabel')} value=${thanks} onInput=${setThanks} />
        ${keepable ? html`<${Check} checked=${keep} onChange=${setKeep}>${x('keep')}<//>` : null}
        <${Actions}>
          <${Loud} control disabled=${busy} onClick=${() => act(() => closeHelp(v.id, { action: 'solved', thanks: thanks.trim(), keep: keepable && keep }), x('solvedDone'))}>${x('solved')}<//>
        <//>` : null}
    <//>`;
}

/** @param {{ msg: any, onReply?: () => void, onReplyAi?: () => void }} props */
export function HelpQuestionCard({ msg, onReply, onReplyAi }) {
  const [v, setV] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setV(await helpThread(msg.conversationId)); setError(''); }
    catch (err) { swallowed('help-card: load', err); setV(null); }
  }, [msg.conversationId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);
  const act = async (fn, done) => {
    setBusy(true); setError('');
    try { await fn(); setNote(done); await load(); }
    catch (err) { swallowed('help-card: action', err); setError(err?.message || x('failed')); }
    finally { setBusy(false); }
  };
  if (!v) return null;
  const rows = [
    v.tried ? { k: x('tried'), v: v.tried } : null,
    v.topics?.length ? { k: x('topics'), v: html`<${Marks}>${v.topics.map((tp) => html`<${Mark} key=${tp}>${tp}<//>`)}<//>` } : null,
    v.deadline ? { k: x('deadline'), v: date(v.deadline) } : null,
  ].filter(Boolean);
  return html`
    <${Box} name=${x('title')} marks=${html`<${Mark} tone="sun">${x('mark')}<//>`}>
      <${Stack} gap="medium">
        ${rows.length ? html`<${Facts} rows=${rows} />` : null}
        ${v.role === 'helper'
          ? html`<${HelperSide} v=${v} onReply=${onReply} onReplyAi=${onReplyAi} act=${act} busy=${busy} />`
          : html`<${AskerSide} v=${v} act=${act} busy=${busy} />`}
        ${note ? html`<${Note} kind="message">${note}<//>` : null}
        ${error ? html`<${Note} kind="message" error>${error}<//>` : null}
      <//>
    <//>`;
}
