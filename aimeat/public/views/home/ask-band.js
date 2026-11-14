/**
 * @file public/views/home/ask-band.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The home's "Who knows?" band (block home.ask, Ask someone who knows): the person writes
 *   what they want to ask, the node first shows a kept answer and who could answer, and the question is
 *   sent only when they press Send. A copy prompt does the same through their own AI, and one line says
 *   where their questions stand and what they offer as a helper. The design canvas board "Home"
 *   (2026-11-14) is the model.
 *
 *   NOTHING IS SENT ON "FIND". Finding reads kept answers and helpers' chosen topics; the question
 *   leaves only on the second press, after the person has seen who it goes to.
 *
 *   Composed from library components only (Band, BandNote, NamedRow, TextField, Action, Loud, Note,
 *   LineList, Mark).
 * @structure AskBand
 * @usage html`<${AskBand} data=${inbox} props=${props} navigate=${ctx.navigate} />` (views/surface/blocks-home.js AskBlock)
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Band, BandNote } from '/components/Band.js';
import { NamedRow } from '/components/NamedRow.js';
import { TextField } from '/components/TextField.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { LineList } from '/components/LineList.js';
import { HelpTip } from '/components/HelpTip.js';
import { findHelp, askHelp, askPrompt } from '/js/services/help.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);
const x = (key, vars) => t(`home.ask.${key}`, vars);

/** One line: the person's open questions, and what they offer as a helper. */
function StatusLine({ data, showMine, showHelper }) {
  if (!data) return null;
  const parts = [];
  if (showMine) {
    const open = (data.mine ?? []).filter((q) => q.state === 'open' || q.state === 'answered');
    const answered = open.filter((q) => q.state === 'answered').length;
    if (open.length) parts.push(x('statusMine', { n: open.length, answered }));
    const waiting = (data.asked_of_me ?? []).filter((q) => q.my_outcome === 'pending').length;
    if (waiting) parts.push(x('statusWaiting', { n: waiting }));
  }
  if (showHelper && data.me) {
    parts.push(data.me.helper
      ? x('statusHelper', { topics: (data.me.topics ?? []).slice(0, 4).join(', ') || x('noTopics'), cap: data.me.capPerWeek ?? 2 })
      : x('statusNotHelper'));
  }
  if (!parts.length) return null;
  return html`<${BandNote}>${parts.join(' · ')} <a href="/v1/profile?tab=help">${x('open')}</a><//>`;
}

/** @param {{ data: any, props?: Record<string, any> }} p */
export function AskBand({ data, props = {} }) {
  const [say, setSay] = useState('');
  const [found, setFound] = useState(null);
  const [sent, setSent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const showMine = props.showMine !== false;
  const showHelper = props.showHelper !== false;
  const copyPrompt = props.copyPrompt !== false;

  const find = async () => {
    const question = say.trim();
    if (!question) return;
    setBusy(true); setError(''); setSent(null);
    try { setFound(await findHelp({ question })); }
    catch (err) { swallowed('ask-band: find', err); setError(err?.message || x('failed')); }
    finally { setBusy(false); }
  };
  const send = async (toBoard = false) => {
    setBusy(true); setError('');
    try {
      const r = await askHelp({ question: say.trim(), ...(toBoard ? { to_board: true } : {}) });
      setSent(r);
      if (!r?.nobody_found) { setSay(''); setFound(null); }
    } catch (err) { swallowed('ask-band: ask', err); setError(err?.message || x('failed')); }
    finally { setBusy(false); }
  };

  const title = x('title');
  const helpers = found?.helpers ?? [];
  const kept = found?.kept ?? [];
  return html`
    <${Band} title=${html`${title} <${HelpTip} term="concept.help" label=${title} />`}>
      <${BandNote}>${x('lead')}<//>
      <${NamedRow} stack label=${x('askLabel')}>
        <${TextField} label=${x('fieldLabel')} placeholder=${props.placeholder || x('placeholder')}
          value=${say} onInput=${(v) => { setSay(v); setFound(null); }} onEnter=${find}
          actions=${html`<${Loud} control disabled=${busy || !say.trim()} onClick=${find}>${x('find')}<//>`} />
        ${copyPrompt ? html`<${Note} kind="quiet">${x('ownAi')} <${Action} small soft copy=${askPrompt(say.trim())} copiedLabel=${x('copied')}>${x('copyPrompt')}<//><//>` : null}
      <//>
      ${found ? html`
        ${kept.length ? html`
          <${NamedRow} stack label=${x('keptLabel')}>
            <${LineList} rows=${kept.map((k) => ({ id: k.id, name: k.subject, text: k.answer, href: '/v1/profile?tab=help' }))} />
          <//>` : null}
        <${NamedRow} stack label=${x('helpersLabel')}>
          ${helpers.length
            ? html`
              <${LineList} rows=${helpers.slice(0, 3).map((p) => ({ id: p.ghii, name: p.name, text: (p.matched ?? []).join(', '), href: '/v1/profile?tab=help' }))} />
              <${Actions}><${Loud} control disabled=${busy} onClick=${() => send(false)}>${x('send', { name: helpers[0].name })}<//><//>`
            : html`
              <${Note} kind="quiet">${x('nobody')}<//>
              ${found.board_enabled ? html`<${Actions}><${Action} small disabled=${busy} onClick=${() => send(true)}>${x('toBoard')}<//><//>` : null}`}
        <//>` : null}
      ${sent && !sent.nobody_found ? html`<${Note} kind="message">${sent.question?.audience === 'board' ? x('sentBoard') : x('sent', { names: (sent.sent_to ?? []).map((s) => s.name).join(', ') })}<//>` : null}
      ${sent?.nobody_found ? html`<${Note} kind="quiet">${x('nobody')}<//>` : null}
      ${error ? html`<${Note} kind="message" error>${error}<//>` : null}
      <${StatusLine} data=${data} showMine=${showMine} showHelper=${showHelper} />
    <//>`;
}
