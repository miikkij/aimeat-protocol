/**
 * @file public/views/profile/memory-tab/file-facts-decision.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The decision behind one content class of a stored file, shown in the file's fold
 *   (memory-tab/file-facts-classes.js) instead of a link to the AI page: the link changed the address
 *   and left the dialog open, and on a cold load the AI page's card did not say which decision was
 *   this file's (browser check of 2026-10-21). Opened, the fold reads GET /v1/ai/decisions/{id} and
 *   shows the model, when it answered, the provider, the review when there is one (confirmed or
 *   overridden, by whom, when), and the probability of yes for each content class it was asked
 *   about (question ids c_<classId>, answers { type: 'noul', value } with value 0..1), the likeliest
 *   first; the classes under 10 % are counted in one line.
 *
 *   Reading a decision needs ai:use; a refusal is shown as the server words it.
 * @structure DecisionFold({ decisionId, classes, title }) · decisionRows · answerRows
 * @usage html`<${DecisionFold} decisionId=${m.decisionId} classes=${classes} title=${label} />`
 * @version-history
 *   v1.0.0 — 2026-10-21 — Initial (browser check of the second round).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { date as fmtDate, time as fmtTime } from '/js/format.js';
import { Folds, FoldRow } from '/components/Folds.js';
import { Facts } from '/components/Facts.js';
import { Note } from '/components/Note.js';
import { Label } from '/components/Mark.js';
import { Space } from '/components/Layout.js';
import { cc, classLabel, percent, readDecision } from '../data-wallet/content-facts.js';

const html = htm.bind(h);
const errText = (e) => e?.error?.message || e?.response?.error?.message || e?.message || cc('decisionFailed');
/** Below this probability a class is counted, not listed. */
const SHOWN_FROM = 0.1;

const when = (iso) => (iso ? `${fmtDate(iso)} ${fmtTime(iso, { hour: '2-digit', minute: '2-digit' })}` : '');

/** The decision's own facts: the model, when, the provider, the review. */
export function decisionRows(row) {
  const review = row.record?.review;
  // The person in person is "you" in the sentence's own grammar (a key of its own); anyone else is named.
  const you = review && review.by === row.ownerGhii;
  const outcome = review?.outcome === 'overridden' ? 'overridden' : 'confirmed';
  return [
    { key: 'model', k: cc('d.model'), v: row.model, mono: true },
    { key: 'when', k: cc('d.when'), v: when(row.createdAt) },
    { key: 'provider', k: cc('d.provider'), v: row.provider, sub: row.providerKind ? cc('d.kind.' + (row.providerKind === 'local' ? 'local' : 'hosted')) : undefined },
    { key: 'review', k: cc('d.review'), missing: !review,
      v: review ? cc(`d.${outcome}${you ? 'You' : ''}`, { by: review.by, when: when(review.at) }) : cc('d.notReviewed'),
      sub: review?.note || undefined },
  ];
}

/** The answers as rows, the likeliest first; the ones under SHOWN_FROM are only counted. */
export function answerRows(row, classes) {
  const all = Object.entries(row.record?.answers || {})
    .filter(([id, a]) => id.startsWith('c_') && typeof a?.value === 'number')
    .map(([id, a]) => ({ id: id.slice(2), p: a.value }))
    .sort((a, b) => b.p - a.p);
  const shown = all.filter((a) => a.p >= SHOWN_FROM);
  return { rows: shown.map((a) => ({ key: a.id, k: classLabel(classes, a.id), v: percent(a.p) })), rest: all.length - shown.length };
}

/**
 * @param {{ decisionId: string, classes: any[], title: string }} props
 */
export function DecisionFold({ decisionId, classes, title }) {
  const [state, setState] = useState(null);
  const load = async (opened) => {
    if (!opened || state) return;
    try { setState({ row: await readDecision(decisionId) }); } catch (e) { setState({ error: errText(e) }); }
  };
  let body;
  if (!state) body = html`<${Note} kind="loading">${t('dwpage.loading')}<//>`;
  else if (state.error || !state.row) body = html`<${Note} kind="message" error>${state.error || cc('decisionFailed')}<//>`;
  else {
    const answers = answerRows(state.row, classes);
    body = html`
      <${Facts} rows=${decisionRows(state.row)} />
      <${Space} above="small">
        <${Label} block>${cc('d.answers')}<//>
        ${answers.rows.length ? html`<${Facts} rows=${answers.rows} />` : null}
        ${answers.rest ? html`<${Note} kind="hint">${cc('d.rest', { n: answers.rest })}<//>` : null}
      <//>`;
  }
  return html`<${Folds}><${FoldRow} kind="toggle" name=${title} onToggle=${load} body=${body} /><//>`;
}

export default DecisionFold;
