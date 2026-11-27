/**
 * @file public/views/profile/help-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Settings "Ask someone who knows" ("Kysy osaajalta"): the questions members of this node
 *   sent to the person, their own questions, the shared list a helper may take a question from, and
 *   their choices. The screen half of /v1/help/*; the person's AI does the same with the aimeat_help_*
 *   tools, and the page's start hands over the prompt. The design canvas board "Apu-sivu" (2026-11-14)
 *   is the model.
 *
 *   A QUESTION IS ANSWERED IN ITS THREAD. Each row opens the message thread the question lives in,
 *   where the question card and the composer are; this page lists, passes, takes and closes.
 *
 *   Live data by the `aimeat-live-update` event, never on a timer. The page explains itself the
 *   designed way (.claude/rules/page-guidance.md): PageStart "help" and the title's question mark
 *   (concept.help).
 *   The sections stand one under the other (they were tabs), each drawn once it holds something, and
 *   numbered after the filter: the questions sent to the person, their own questions, the shared list,
 *   and their choices as one row that says the current choice and opens in place. With no question at
 *   all, their own questions' one line is the page's empty line.
 * @structure byRank · participationWords · AskedView · MineView · BoardView · HelpTab (default)
 * @usage Registered in views/profile.js as the `help` tab; menu entry in landing-page.cards.js (Activity).
 * @version-history
 *   v1.1.0 -- 2026-11-27 -- The Tabs bar goes: the lists stand as sections 01..03 with the contents
 *     rail, a list drawn only when it holds a question, and "Taking part" is a FoldSection whose row
 *     says the saved choice. A figure strip (every question, the ones that wait for the person's
 *     answer, the answers that wait for them, the shared list) from the inbox the page already reads,
 *     with hideZeros. A question that waits comes first in its list. Every control stays.
 *   v1.0.1 — 2026-11-14 — A row's title and Open open the thread in place (openThread); the hash
 *     link alone left the page where it was (Jouni, 2026-11-14).
 *   v1.0.0 — 2026-11-14 — Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';
import { helpMe, helpInbox, respondHelp, closeHelp, threadHref, openThread } from '/js/services/help.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { PageStart } from '/components/PageStart.js';
import { Section } from '/components/Section.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { List, Row, Name, Desc, Cell, Doors } from '/components/List.js';
import { Action } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Participation } from './help/participation.js';

const html = htm.bind(h);
const x = (key, vars) => t(`help.page.${key}`, vars);
const snippet = (s) => (String(s || '').length > 160 ? `${String(s).slice(0, 157)}…` : String(s || ''));
const STATE_TONE = { open: 'attention', answered: 'fine', solved: 'fine', expired: 'off', cancelled: 'off' };

function StateMark({ state }) {
  // A state the page has no word for shows as the node sent it.
  const word = x(`state.${state}`);
  return html`<${Mark} kind="status" tone=${STATE_TONE[state] || 'off'}>${word === `help.page.state.${state}` ? state : word}<//>`;
}

/** A question sent to the person waits for them while it is open and they have not answered or passed. */
const waitsForAnswer = (q) => q.my_outcome === 'pending' && q.state === 'open';

/** The list in a stable order with what waits for the person first (rank 0 before 1 before 2). */
const byRank = (items, rank) => items.map((q, i) => [q, i]).sort((a, b) => (rank(a[0]) - rank(b[0])) || (a[1] - b[1])).map(([q]) => q);

/** The person's saved choices in one line, for the closed "Taking part" row. */
function participationWords(p) {
  if (!p) return '';
  if (p.helper) {
    const status = p.status === 'busy' ? x('statusBusy') : p.status === 'away' ? x('statusAway') : '';
    return [x('meSubHelper', { cap: p.capPerWeek }), status].filter(Boolean).join(' · ');
  }
  return p.asker !== false ? x('meSubAsker') : x('meSubNone');
}

/** Questions sent to the person. */
function AskedView({ num, items, act }) {
  return html`
    <${Section} id="hp-asked" num=${num} first title=${x('secAsked')} count=${items.length}>
      <${List} cols="name-desc-state-doors" head=${[x('colQuestion'), x('colWhat'), x('colState'), '']} empty=${x('askedEmpty')}
        rows=${items}
        render=${(q) => html`
          <${Row} key=${q.question_id + q.conversation_id}>
            <${Name} meta=${x('from', { name: q.asker_name || '' })} href=${threadHref(q.conversation_id)} onFollow=${(e) => openThread(q.conversation_id, e)}>${q.subject}<//>
            <${Desc}>${q.draft ? x('draftWaits') : snippet(q.question)}<//>
            <${Cell}><${StateMark} state=${q.my_outcome === 'pending' ? q.state : q.my_outcome === 'answered' ? 'answered' : q.state} /><//>
            <${Doors}>
              <${Action} small row onClick=${() => openThread(q.conversation_id)}>${x('openThread')}<//>
              ${waitsForAnswer(q)
                ? html`<${Action} small soft row onClick=${() => act(() => respondHelp(q.question_id, { action: 'pass' }), x('passedDone'))}>${x('pass')}<//>`
                : null}
            <//>
          <//>`} />
    <//>`;
}

/** The person's own questions; with no question anywhere its one line is the page's empty line. */
function MineView({ num, items, act }) {
  return html`
    <${Section} id="hp-mine" num=${num} first=${num === '01'} title=${x('secMine')} count=${items.length}>
      <${List} cols="name-desc-state-doors" head=${[x('colQuestion'), x('colWhat'), x('colState'), '']} empty=${x('mineEmpty')}
        rows=${items}
        render=${(q) => {
          const open = q.state === 'open' || q.state === 'answered';
          const first = (q.conversation_ids ?? [])[0];
          return html`
            <${Row} key=${q.id}>
              <${Name} meta=${q.answers?.length ? x('answeredBy', { names: q.answers.map((a) => a.name).join(', ') }) : (q.waiting ? x('waiting') : '')}
                href=${first ? threadHref(first) : undefined} onFollow=${first ? (e) => openThread(first, e) : undefined}>${q.subject}<//>
              <${Desc}>${snippet(q.question)}<//>
              <${Cell}><${StateMark} state=${q.state} /><//>
              <${Doors}>
                ${first ? html`<${Action} small row onClick=${() => openThread(first)}>${x('openThread')}<//>` : null}
                ${q.state === 'answered' ? html`<${Action} small row onClick=${() => act(() => closeHelp(q.id, { action: 'solved' }), x('solvedDone'))}>${x('solved')}<//>` : null}
                ${open ? html`<${Action} small soft row onClick=${() => act(() => closeHelp(q.id, { action: 'extend' }), x('extendedDone'))}>${x('extend')}<//>` : null}
                ${open ? html`<${Action} small soft tone="danger" row onClick=${() => act(() => closeHelp(q.id, { action: 'cancel' }), x('cancelledDone'))}>${x('cancel')}<//>` : null}
              <//>
            <//>`;
        }} />
    <//>`;
}

/** The shared list: questions nobody was found for, which any helper may take. */
function BoardView({ num, items, act }) {
  return html`
    <${Section} id="hp-board" num=${num} title=${x('secBoard')} count=${items.length}>
      <${Note} kind="hint">${x('boardHint')}<//>
      <${List} cols="name-desc-doors" head=${[x('colQuestion'), x('colWhat'), '']} empty=${x('boardEmpty')}
        rows=${items}
        render=${(q) => html`
          <${Row} key=${q.question_id}>
            <${Name} meta=${q.topics?.join(', ') || ''} tag=${q.fits_me ? x('fitsYou') : null}>${q.subject}<//>
            <${Desc}>${snippet(q.question)}<//>
            <${Doors}><${Action} small row onClick=${() => act(() => respondHelp(q.question_id, { action: 'take' }), x('takenDone'))}>${x('take')}<//><//>
          <//>`} />
    <//>`;
}

/** @param {{ showToast?: (msg: string, kind?: unknown) => void }} props the profile shell's tab props */
export default function HelpTab({ showToast }) {
  const [me, setMe] = useState(null);
  const [inbox, setInbox] = useState(null);
  const [meOpen, setMeOpen] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [m, i] = await Promise.all([helpMe(), helpInbox(true)]);
      setMe(m); setInbox(i); setError('');
    } catch (err) {
      swallowed('help-tab: load', err);
      setError(err?.message || x('loadFailed'));
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  const act = async (fn, done) => {
    try { await fn(); showToast?.(done); await load(); }
    catch (err) { swallowed('help-tab: action', err); showToast?.(err?.message || x('actionFailed'), 'error'); }
  };

  // What waits for the person first: a question sent to them that waits for their answer, and their
  // own question that someone answered (they mark it solved). The rest keeps the node's order.
  const asked = byRank(inbox?.asked_of_me ?? [], (q) => (waitsForAnswer(q) ? 0 : 1));
  const mine = byRank(inbox?.mine ?? [], (q) => (q.state === 'answered' ? 0 : q.state === 'open' ? 1 : 2));
  const board = inbox?.board ?? [];
  const boardOn = !!(me?.node?.boardEnabled && me?.participant?.helper);
  const loaded = !!(inbox && me);

  // The figures, from the inbox the page already read: every question the person has (sent to them
  // and their own), the ones that wait for their answer, the answers that wait for them, and the
  // shared list when they may take from it. With no question at all the strip is not drawn.
  const answerN = asked.filter(waitsForAnswer).length;
  const answeredN = mine.filter((q) => q.state === 'answered').length;
  const strip = error ? null : !loaded ? html`<${FigureStrip} loading=${3} />` : html`<${FigureStrip} wrap hideZeros items=${[
    { key: 'all', n: asked.length + mine.length, label: x('stripAll'), sub: x('stripAllSub', { a: asked.length, m: mine.length }) },
    { key: 'answer', n: answerN, tone: answerN ? 'notice' : undefined, label: x('stripAnswer'), sub: answerN ? x('stripAnswerSub') : undefined },
    { key: 'answered', n: answeredN, tone: answeredN ? 'notice' : undefined, label: x('stripAnswered'), sub: answeredN ? x('stripAnsweredSub') : undefined },
    boardOn ? { key: 'board', n: board.length, label: x('stripBoard') } : null,
  ]} />`;

  // What is drawn: the questions sent to the person once there is one; their own questions when they
  // have one or when nothing was sent to them (then its line is the page's empty line); the shared
  // list once it holds a question they may take; their choices always, since that row is how one
  // begins to receive questions. Numbered after the filter, so a hidden list leaves no gap.
  const shown = !loaded ? [] : [
    asked.length ? { id: 'hp-asked', label: x('secAsked'), count: asked.length } : null,
    mine.length || !asked.length ? { id: 'hp-mine', label: x('secMine'), count: mine.length } : null,
    boardOn && board.length ? { id: 'hp-board', label: x('secBoard'), count: board.length } : null,
    { id: 'hp-me', label: x('secMe') },
  ].filter(Boolean).map((s, i) => ({ ...s, num: String(i + 1).padStart(2, '0') }));
  const numOf = Object.fromEntries(shown.map((s) => [s.id, s.num]));

  return html`
    <${SettingsPage}
      crumb=${[t('nav.profile'), t('profile.landing.menuActivity'), t('profile.tabs.help')]}
      title=${x('title')}
      help="concept.help"
      desc=${x('intro')}
      strip=${strip}
      start=${html`<${PageStart} id="help" done=${me ? me.chosen : null} />`}
      railTitle=${shown.length > 1 ? t('profile.landing.railTitle') : undefined}
      sections=${shown.length > 1 ? shown : undefined}>
      ${error ? html`<${Note} kind="message" error>${error}<//>` : null}
      ${!inbox && !error ? html`<${Note} kind="loading">${x('loading')}<//>` : null}
      ${loaded ? html`
        ${numOf['hp-asked'] ? html`<${AskedView} num=${numOf['hp-asked']} items=${asked} act=${act} />` : null}
        ${numOf['hp-mine'] ? html`<${MineView} num=${numOf['hp-mine']} items=${mine} act=${act} />` : null}
        ${numOf['hp-board'] ? html`<${BoardView} num=${numOf['hp-board']} items=${board} act=${act} />` : null}
        <${Participation} me=${me} num=${numOf['hp-me']} sub=${participationWords(me.participant)}
          open=${meOpen} onToggle=${() => setMeOpen((o) => !o)} onSaved=${load} showToast=${showToast} />` : null}
    <//>`;
}
