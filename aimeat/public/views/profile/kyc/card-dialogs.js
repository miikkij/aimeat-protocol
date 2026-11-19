/**
 * @file public/views/profile/kyc/card-dialogs.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The dialogs of one customer card (card.js), one at a time from the card's `dlg`
 *   state: record how the identity was verified; decide a screening hit (a false positive or a
 *   confirmed match, with the ground in words); give the senior approval; review the card; end the
 *   relationship; keep an ended card longer (the officer); and the identify link to copy. A decision
 *   is made here by the person, in person: the server refuses it from an agent.
 * @structure cardDialog(c)
 * @usage html`${cardDialog(card)}` in the page's `after` slot
 * @version-history
 *   v1.0.2 — 2026-11-19 — Each dialog's opening line is the caption's body size, with its own space
 *     under it before the first field; the hit's score is named as the match strength.
 *   v1.0.1 — 2026-11-19 — A hit's reasons in the decide dialog are locale words (hitReasonWords).
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import { h } from 'preact';
import htm from 'htm';
import { Modal } from '/components/Modal.js';
import { Fields } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Choice } from '/components/Choice.js';
import { Check } from '/components/Check.js';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Facts } from '/components/Facts.js';
import { x, word, today, timeWord, hitReasonWords } from './frame.js';

const html = htm.bind(h);

const LEVELS = ['low', 'substantial', 'high'];
const METHODS = ['document', 'ftn', 'eudiw', 'register', 'other'];

/** The footer: the way out, then the one act. */
function footer(c, label, ready, run) {
  const busy = !!c.busy;
  return html`
    <${Action} small soft onClick=${() => c.setDlg(null)}>${x('cancel')}<//>
    <${Loud} control disabled=${!ready || busy} onClick=${run}>${busy ? x('saving') : label}<//>`;
}

const errLine = (d) => (d.error ? html`<${Note} kind="message" error>${d.error}<//>` : null);

/**
 * The open dialog of a card, or null.
 * @param {ReturnType<typeof import('./card.js').useCard>} c
 */
export function cardDialog(c) {
  const d = c.dlg;
  if (!d) return null;
  const set = (patch) => c.setDlg({ ...d, ...patch, error: '' });
  const close = () => c.setDlg(null);
  const name = c.read?.card?.name || '';

  if (d.kind === 'identity') {
    const ready = !!d.verifiedAt && d.verifiedAt <= today();
    const run = () => c.act('identity', {
      level: d.level, method: d.method, verifiedAt: d.verifiedAt, faceToFace: !!d.faceToFace,
      ...(d.evidence.trim() ? { evidence: d.evidence.trim() } : {}),
    }, x('card.identified'));
    return html`
      <${Modal} open size="md" title=${x('dlg.identityTitle')} titleRef=${name} onClose=${close} footer=${footer(c, x('dlg.identitySave'), ready, run)}>
        <${Note} kind="caption" size="body">${x('dlg.identityLead')}<//>
        <${Fields}>
          <${Select} label=${x('dlg.level')} help="kyc.identityLevel" value=${d.level} onChange=${(v) => set({ level: v })}
            options=${LEVELS.map((l) => [l, word('level', l)])} />
          <${Select} label=${x('dlg.method')} value=${d.method} onChange=${(v) => set({ method: v })}
            options=${METHODS.map((m) => [m, word('method', m)])} />
          <${TextField} type="date" label=${x('dlg.verifiedAt')} value=${d.verifiedAt} max=${today()} onInput=${(v) => set({ verifiedAt: v })} />
          <${Check} checked=${!!d.faceToFace} onChange=${(v) => set({ faceToFace: v })} hint=${x('dlg.faceToFaceHint')}>${x('dlg.faceToFace')}<//>
          <${TextField} label=${x('dlg.evidence')} hint=${x('dlg.evidenceHint')} value=${d.evidence} onInput=${(v) => set({ evidence: v })} />
        <//>
        ${errLine(d)}
      <//>`;
  }

  if (d.kind === 'hit') {
    const hit = d.hit;
    const ready = !!d.note.trim();
    const run = () => c.act('hits', { verdict: d.verdict, hit_id: hit.id, source: hit.source, subject: hit.subject, note: d.note.trim() }, x('card.hitDecided'));
    return html`
      <${Modal} open size="md" title=${x('dlg.hitTitle')} titleRef=${hit.listedName} onClose=${close} footer=${footer(c, x('dlg.hitSave'), ready, run)}>
        <${Facts} rows=${[
          { k: x('col.listed'), v: hit.listedName, sub: `${word('source', hit.source)} · ${hit.programme}` },
          { k: x('col.match'), v: x('hits.matchedScore', { name: hit.matchedName, score: Math.round(hit.score * 100) }), sub: (hit.reasons || []).map(hitReasonWords).join(' · ') || undefined },
        ]} />
        <${Note} kind="aside" tone="irreversible">${x('dlg.inPerson')}<//>
        <${Fields}>
          <${Choice} label=${x('dlg.verdict')} value=${d.verdict} onChange=${(v) => set({ verdict: v })}
            options=${[['false-positive', word('verdict', 'false-positive')], { value: 'confirmed', label: word('verdict', 'confirmed'), attention: true }]} />
          <${TextArea} label=${x('dlg.ground')} hint=${x('dlg.groundHint')} rows=${3} value=${d.note} onInput=${(v) => set({ note: v })} />
        <//>
        ${d.verdict === 'confirmed' ? html`<${Note} kind="hint">${x('dlg.confirmedHint')}<//>` : null}
        ${errLine(d)}
      <//>`;
  }

  if (d.kind === 'approve' || d.kind === 'review' || d.kind === 'end') {
    const ready = d.kind === 'end' || !!d.note.trim();
    const done = { approve: x('card.approved'), review: x('card.reviewed'), end: x('card.ended') }[d.kind];
    const run = () => c.act(d.kind, d.note.trim() ? { note: d.note.trim() } : {}, done);
    return html`
      <${Modal} open size="md" title=${x(`dlg.${d.kind}Title`)} titleRef=${name} onClose=${close} footer=${footer(c, x(`dlg.${d.kind}Save`), ready, run)}>
        <${Note} kind="caption" size="body">${x(`dlg.${d.kind}Lead`)}<//>
        ${d.kind === 'approve' ? html`<${Note} kind="aside">${x('dlg.inPerson')}<//>` : null}
        <${TextArea} label=${d.kind === 'end' ? x('dlg.noteOptional') : x('dlg.note')} rows=${3} value=${d.note} onInput=${(v) => set({ note: v })} />
        ${errLine(d)}
      <//>`;
  }

  if (d.kind === 'hold') {
    const card = c.read?.card;
    const ready = !!d.until && !!d.basis.trim();
    const run = () => c.act('hold', { until: d.until, basis: d.basis.trim() }, x('card.held'));
    return html`
      <${Modal} open size="md" title=${x('dlg.holdTitle')} titleRef=${name} onClose=${close} footer=${footer(c, x('dlg.holdSave'), ready, run)}>
        <${Note} kind="caption" size="body">${x('dlg.holdLead', { until: card?.retainUntil || '–' })}<//>
        <${Fields}>
          <${TextField} type="date" label=${x('dlg.holdUntil')} value=${d.until} min=${card?.retainUntil || undefined} onInput=${(v) => set({ until: v })} />
          <${TextArea} label=${x('dlg.holdBasis')} hint=${x('dlg.holdBasisHint')} rows=${2} value=${d.basis} onInput=${(v) => set({ basis: v })} />
        <//>
        ${errLine(d)}
      <//>`;
  }

  if (d.kind === 'link') {
    return html`
      <${Modal} open size="md" title=${x('dlg.linkTitle')} titleRef=${name} onClose=${close}
        footer=${html`<${Action} small soft onClick=${close}>${x('close')}<//><${Loud} control copy=${d.url} copiedLabel=${x('copied')}>${x('dlg.linkCopy')}<//>`}>
        <${Note} kind="caption" size="body">${x('dlg.linkLead')}<//>
        <${TextField} label=${x('dlg.linkLabel')} code readOnly value=${d.url} hint=${x('dlg.linkExpires', { when: timeWord(d.expiresAt) })} />
        <${Note} kind="hint">${x('dlg.linkHint')}<//>
      <//>`;
  }
  return null;
}
