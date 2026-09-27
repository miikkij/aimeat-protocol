/**
 * @file public/views/appcat/sections/work.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description "Where your work is" (features F299, F300, F302): two stops, the working copy (an AI
 *   proposal waiting, saved at a time, saved earlier, or the same as published; only you can see it)
 *   and the published version (everyone can see it), the screenshot beside them, one sentence of what
 *   to do next, and when a working copy is saved the three verbs right here: Try it safely, Publish as
 *   v{n+1}, Discard working copy. Publishing here never re-uploads the bytes this page holds: the
 *   draft slot on the node is the truth. Under it the size of the bytes held.
 * @structure meta · WorkSection({ d })
 * @usage loaded by the detail view: import('./sections/work.js')
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity (sections-a): the sentence and the size are the Stops' own lead and
 *     foot (the old .wc-explain and .wc-size), the verbs at the column's start as the old row stood,
 *     the screenshot named for a screen reader (a new key, appcat.wc.shotAlt).
 *   v1.0.0 — 2026-09-27 — Initial (appcat detail builder A): the old catalogue's lifecycle band
 *     (detail.js renderDetailView statusHtml, detailWorkTry/Publish/Discard).
 */
import { h } from 'preact';
import htm from 'htm';
import { Stops } from '/components/Stops.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { time } from '/js/format.js';
import { x } from '/views/appcat/i18n.js';
import { workTry, workPublish, workDiscard } from '/views/appcat/detail-state.js';
import { fmtSize } from '/views/appcat/detail-head.js';

const html = htm.bind(h);

export const meta = { id: 'work', title: 'wc.lifecycle', show: () => true };

export default function WorkSection({ d }) {
  const w = d.work;
  const state = w.proposal ? 'pending' : w.hasWork ? 'saved' : 'clean';
  const next = String((d.version || 0) + 1);
  let value;
  let explain;
  if (state === 'pending') {
    value = x('wc.pending');
    explain = x('wc.explainPending');
  } else if (state === 'saved') {
    value = w.savedAt ? x('wc.savedAt', { t: time(w.savedAt) }) : x('wc.savedEarlier');
    explain = x('wc.explainSaved', { v: next });
  } else {
    value = x('wc.sameAsPublished');
    explain = x('wc.explainClean');
  }
  const bytes = w.b64 ? Math.round(w.b64.length * 0.75) : 0;
  const items = [
    { key: 'work', label: x('wc.title'), value, note: x('wc.privateNote'), on: state !== 'clean' },
    { key: 'published', label: x('wc.published'), value: d.version ? 'v' + d.version : 'v?', note: x('wc.visibleToOthers') },
  ];
  return html`<${Stops} items=${items} picture=${{ src: d.shotUrl, alt: x('wc.shotAlt') }} lead=${explain}
      foot=${bytes ? x('detail.size') + ': ' + fmtSize(bytes) : null}>
    ${state === 'saved' ? html`<${Actions} chapter>
      <${Action} small onClick=${workTry}>${x('wc.try')}<//>
      <${Loud} control onClick=${workPublish}>${x('wc.publishAs', { v: next })}<//>
      <${Action} small onClick=${workDiscard}>${x('wc.discardWork')}<//>
    <//>` : null}
  <//>`;
}
