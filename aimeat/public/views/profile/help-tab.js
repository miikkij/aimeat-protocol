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
 * @structure AskedView · MineView · BoardView · HelpTab (default)
 * @usage Registered in views/profile.js as the `help` tab; menu entry in landing-page.cards.js (Activity).
 * @version-history
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
import { Tabs } from '/components/Tabs.js';
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
  return html`<${Mark} kind="status" tone=${STATE_TONE[state] || 'off'}>${x(`state.${state}`)}<//>`;
}

/** Questions sent to the person. */
function AskedView({ items, act }) {
  return html`
    <${Section} id="hp-asked" num="01" title=${x('secAsked')} count=${items.length}>
      <${List} cols="name-desc-state-doors" head=${[x('colQuestion'), x('colWhat'), x('colState'), '']} empty=${x('askedEmpty')}
        rows=${items}
        render=${(q) => html`
          <${Row} key=${q.question_id + q.conversation_id}>
            <${Name} meta=${x('from', { name: q.asker_name || '' })} href=${threadHref(q.conversation_id)} onFollow=${(e) => openThread(q.conversation_id, e)}>${q.subject}<//>
            <${Desc}>${q.draft ? x('draftWaits') : snippet(q.question)}<//>
            <${Cell}><${StateMark} state=${q.my_outcome === 'pending' ? q.state : q.my_outcome === 'answered' ? 'answered' : q.state} /><//>
            <${Doors}>
              <${Action} small row onClick=${() => openThread(q.conversation_id)}>${x('openThread')}<//>
              ${q.my_outcome === 'pending' && q.state === 'open'
                ? html`<${Action} small soft row onClick=${() => act(() => respondHelp(q.question_id, { action: 'pass' }), x('passedDone'))}>${x('pass')}<//>`
                : null}
            <//>
          <//>`} />
    <//>`;
}

/** The person's own questions. */
function MineView({ items, act }) {
  return html`
    <${Section} id="hp-mine" num="02" title=${x('secMine')} count=${items.length}>
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
function BoardView({ items, act }) {
  return html`
    <${Section} id="hp-board" num="03" title=${x('secBoard')} count=${items.length}>
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
  const [view, setView] = useState('asked');
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

  const asked = inbox?.asked_of_me ?? [];
  const mine = inbox?.mine ?? [];
  const board = inbox?.board ?? [];
  const boardOn = !!(me?.node?.boardEnabled && me?.participant?.helper);
  const tabs = [
    { value: 'asked', label: x('tabAsked'), count: asked.filter((q) => q.my_outcome === 'pending').length || undefined },
    { value: 'mine', label: x('tabMine'), count: mine.filter((q) => q.state === 'open' || q.state === 'answered').length || undefined },
    ...(boardOn ? [{ value: 'board', label: x('tabBoard'), count: board.length || undefined }] : []),
    { value: 'me', label: x('tabMe') },
  ];
  return html`
    <${SettingsPage}
      crumb=${[t('nav.profile'), t('profile.landing.menuActivity'), t('profile.tabs.help')]}
      title=${x('title')}
      help="concept.help"
      desc=${x('intro')}
      start=${html`<${PageStart} id="help" done=${me ? me.chosen : null} />`}>
      ${error ? html`<${Note} kind="message" error>${error}<//>` : null}
      ${!inbox && !error ? html`<${Note} kind="loading">${x('loading')}<//>` : null}
      ${inbox && me ? html`
        <${Tabs} bar kind="view" value=${view} onSelect=${setView} items=${tabs} />
        ${view === 'asked' ? html`<${AskedView} items=${asked} act=${act} />` : null}
        ${view === 'mine' ? html`<${MineView} items=${mine} act=${act} />` : null}
        ${view === 'board' && boardOn ? html`<${BoardView} items=${board} act=${act} />` : null}
        ${view === 'me' ? html`<${Participation} me=${me} onSaved=${load} showToast=${showToast} />` : null}` : null}
    <//>`;
}
