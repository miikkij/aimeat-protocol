/**
 * @file public/views/appcat/sections/ai.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description "Edit with AI" (features F306–F311): the hint, the Art. 50(1) notice (always above the
 *   input, whether or not a key is set: the statement is about what this panel is), the change
 *   request and "Generate change" beside it, disabled until the node says the person has an AI key
 *   (the line under them says how to get one, or to sign in). A run sends the WHOLE source and the
 *   change with the fixed system prompt, pulls the HTML document out of the reply, and holds it as a
 *   proposal: nothing is saved until "Save to working copy" (which records the change as the
 *   checkpoint's note). A published app's proposal can also be tried on its real address, or
 *   published as v{n+1}; an unpublished one only previewed in the sandboxed viewer. "Discard
 *   proposal" drops it.
 *
 *   Kept as the old page behaved: the change request empties once a proposal is made, kept, discarded
 *   or published (the old page drew the section again and the field came back empty), and the line
 *   under the field goes back to empty (or to why the AI cannot be used) when a published proposal
 *   has drawn the section again.
 * @structure meta · AiSection({ d })
 * @usage loaded by the detail view: import('./sections/ai.js')
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity (sections-a): the old page's look (the chapter lead, the notice as a
 *     thin frame with a coral bar, the field underlined with its button beside it, the status line
 *     always in place, the proposal in the heavy frame, the door rows 24px apart) and its behaviour
 *     (the field empties when the section is drawn again; errors in coral).
 *   v1.0.0 — 2026-09-27 — Initial (appcat detail builder A): the old catalogue's detail.js aiHtml,
 *     detailAiRun, detailAiKeep, detailAiTest, detailTestDraftLive, detailPublishTestedDraft and
 *     detailAiDiscard.
 */
import { h } from 'preact';
import { useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { getSession } from '/js/services/auth.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { Tinted } from '/components/Figure.js';
import { TextArea } from '/components/TextField.js';
import { x } from '/views/appcat/i18n.js';
import { aiComplete, editPrompt, extractHtmlFromAi, EDIT_SYSTEM_PROMPT } from '/views/appcat/ai-calls.js';
import { b64ToText, textToB64 } from '/views/appcat/workcopy.js';
import { openViewer, previewTarget } from '/views/appcat/viewer.js';
import { whenBytes, setProposal, discardProposal, keepProposal, stageAndPreview, publishBytes } from '/views/appcat/detail-state.js';

const html = htm.bind(h);

export const meta = { id: 'ai', title: 'detail.editAi', show: () => true };

/** The status line's tone: grey while it works or says a plain thing, green when done, coral on a failure (as the old page coloured it). */
const REPORT_TONE = { ok: 'ok', err: 'refused' };

export default function AiSection({ d }) {
  const w = d.work;
  const [change, setChange] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const available = w.ai === true;
  const next = String((d.version || 0) + 1);

  async function run() {
    const words = change.trim();
    if (!words) { input.current?.focus(); return; }
    if (!getSession()) { setStatus({ text: x('detail.aiLoginNeeded'), tone: '' }); return; }
    const b64 = await whenBytes();
    const source = b64 ? b64ToText(b64) : '';
    if (!source) { setStatus({ text: x('detail.urlCantEdit'), tone: '' }); return; }
    setBusy(true);
    setStatus({ text: x('detail.running'), tone: 'busy' });
    try {
      const { content, budget } = await aiComplete({ prompt: editPrompt(words, source), systemPrompt: EDIT_SYSTEM_PROMPT });
      const found = extractHtmlFromAi(content);
      if (!found) { setStatus({ text: '✘ ' + x('detail.aiNoHtml'), tone: 'err' }); return; }
      setProposal(textToB64(found), words);
      // The old page drew the section again here, so the field came back empty and without the focus.
      setChange('');
      input.current?.blur();
      const usage = budget && budget.spent_today_usd !== undefined
        ? ' · ' + x('detail.aiUsage') + ': $' + Number(budget.spent_today_usd).toFixed(3) : '';
      setStatus({ text: '✔ ' + x('detail.draftReady') + usage, tone: 'ok' });
    } catch (err) {
      setStatus({ text: '✘ ' + (err.code ? '[' + err.code + '] ' : '') + (err.message || x('detail.aiFailed')), tone: 'err' });
    } finally {
      setBusy(false);
    }
  }

  async function keep() {
    if (!getSession()) {
      await keepProposal();
      setChange('');
      setStatus({ text: x('wc.keptLocalOnly'), tone: '' });
      return;
    }
    setStatus({ text: x('wc.saving'), tone: 'busy' });
    try {
      await keepProposal();
      setChange('');
      setStatus({ text: '✔ ' + x('wc.saved'), tone: 'ok' });
    } catch (err) {
      setStatus({ text: '✘ ' + (err.message || x('wc.saveFailed')), tone: 'err' });
    }
  }

  async function tryLive() {
    if (!w.proposal) return;
    setStatus({ text: x('detail.draftUploading'), tone: 'busy' });
    const res = await stageAndPreview(w.proposal);
    setStatus(res.ok ? { text: '✔ ' + x('detail.draftOpened'), tone: 'ok' } : { text: '✘ ' + res.error, tone: 'err' });
  }

  async function publish() {
    if (!w.proposal) return;
    const res = await publishBytes(w.proposal, () => setStatus({ text: x('detail.draftUploading'), tone: 'busy' }));
    if (res.declined) return;
    if (res.data) {
      // Published: the old page drew the section again, which left the line and the field empty.
      setChange('');
      setStatus(null);
      return;
    }
    setStatus({ text: '✘ ' + res.error, tone: 'err' });
  }

  function quickPreview() {
    if (!w.proposal) return;
    openViewer({ title: x('preview.draftTitle', { name: d.meta.name }), html: b64ToText(w.proposal), target: previewTarget(d.owner, d.filename) });
  }

  function discard() {
    discardProposal();
    setChange('');
    setStatus({ text: x('detail.discarded'), tone: '' });
  }

  const shown = status || (available ? null : { text: getSession() ? x('detail.aiUnavailable') : x('detail.aiLoginNeeded'), tone: '' });
  const runDoor = html`<${Actions} chapter><${Loud} control disabled=${!available || busy} onClick=${run}>${x('detail.run')}<//><//>`;
  return html`
    <${Note} kind="lead" chapter>${x('detail.editAiHint')}<//>
    <${Note} kind="aside" tone="disclosure" role="note"><${Tinted} strong>${x('detail.aiInteractionTitle')}<//> ${x('detail.aiInteractionBody')}<//>
    <${TextArea} prompt inputRef=${input} value=${change} onInput=${setChange} placeholder=${x('detail.editAiPh')}
      ariaLabel=${x('detail.editAi')} disabled=${!available} actions=${runDoor} />
    <${Note} kind="report" chapter keep tone=${REPORT_TONE[shown?.tone] || 'busy'}>${shown ? shown.text : ''}<//>
    ${w.proposal ? html`<${Box} tone="proposal">
      <${Note} kind="report" chapter keep tone="busy">${x('detail.draftReady')}<//>
      <${Actions} chapter>
        <${Loud} control onClick=${keep}>${x('wc.save')}<//>
        ${d.published
          ? html`<${Action} small onClick=${tryLive}>${x('wc.try')}<//>
            <${Loud} control onClick=${publish}>${x('wc.publishAs', { v: next })}<//>`
          : html`<${Action} small onClick=${quickPreview}>${x('wc.tryLocal')}<//>`}
        <${Action} small onClick=${discard}>${x('wc.discardProposal')}<//>
      <//>
      <${Note} kind="hint" size="small">${x('wc.verbsHint')}<//>
    <//>` : null}`;
}
