/**
 * @file public/views/home/news-band.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The row at the end of the home that says what is new on this node since the person
 *   last looked, and opens in place to show it: the highlights first and marked, then a few short lines, each naming whom it
 *   concerns, and for a fix whether it changes anything for them. "Read" records that they have
 *   seen it (home.news, views/home/news-data.js), and the band goes away until the next change.
 *
 *   SHORT ON PURPOSE. Each line is the entry's one-sentence summary; the full text stays on the
 *   history page (/v1/changelog), one press away. At most OTHERS_SHOWN lines that are not highlights,
 *   then how many more there are.
 *
 *   Composed from library components only; it has no sheet of its own.
 * @structure default NewsBand({ session, navigate }) · whoWords · rowOf
 * @usage html`<${NewsBand} session=${session} navigate=${navigate} />` (views/home/index.js)
 * @version-history
 *   v2.0.0 — 2026-11-27 — One row at the end of the home (FoldSection "System updates", its detail how
 *     many are unread), closed until pressed; open, the lines, Read (a quiet action) and the way to
 *     the history. The closed band had a headline and three buttons that did one job, and stood
 *     second on the home.
 *   v1.2.0 — 2026-11-25 — The band opens closed when it holds more than one line: a headline that
 *     says how many updates are unread, "Read", "Show all N" and the way to the history. The whole
 *     list is one press away; before, it stood above everything that waits for the person, several
 *     screens long on a first visit.
 *   v1.1.0 — 2026-11-14 — A contents-rail marker around the band (name "System updates", the count of
 *     the changes it holds), with no box of its own.
 *   v1.0.0 — 2026-10-18 — Initial (wish-uutta-aimeatissa-mit-on-tullut-sitten-viime-katselun-kenelle).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale, onLocaleChange } from '/js/i18n.js';
import { BandNote } from '/components/Band.js';
import { FoldSection } from '/components/FoldSection.js';
import { NamedRow } from '/components/NamedRow.js';
import { List, Row, Name } from '/components/List.js';
import { Action, Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { pick, fmtDate, KIND_LABEL } from '/views/landing-changelog.js';
import { useNews, audienceOf, OTHERS_SHOWN, WINDOW_DAYS } from '/views/home/news-data.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

const WHO = {
  user: () => tr('news.who.user', 'You'),
  agent: () => tr('news.who.agent', 'Your AI and agents'),
  operator: () => tr('news.who.operator', 'Operator'),
  developer: () => tr('news.who.developer', 'App builders'),
};

/** "For: You, Your AI and agents" in the reader's language. */
function whoWords(entry) {
  return tr('news.for', 'For: {who}').replace('{who}', audienceOf(entry).map((a) => WHO[a]()).join(', '));
}

/**
 * One row of the band: the summary as its name, and under it the date, the kind and whom it is for,
 * on a line that wraps rather than cuts (whom it is for is half of what the row says); a fix's effect
 * on the person's use is the sentence under that.
 */
function rowOf({ entry, address }, lang) {
  const kind = (KIND_LABEL[entry.kind] || KIND_LABEL.notice)();
  return html`
    <${Row} key=${address}>
      <${Name} href=${'/v1/changelog#' + address}
        meta=${[fmtDate(entry.date, lang), kind, whoWords(entry)].join(' · ')}
        desc=${pick(entry.impact, lang) || undefined}>
        ${pick(entry.summary, lang) || pick(entry.title, lang)}
      <//>
    <//>`;
}

/** @param {{ session: any, navigate?: (path: string) => void }} props */
export default function NewsBand({ session, navigate }) {
  const news = useNews(session);
  const [lang, setLang] = useState(getLocale());
  useEffect(() => onLocaleChange(() => setLang(getLocale())), []);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  const [open, setOpen] = useState(false);

  if (!news.ready || news.mode === 'none') return null;

  const read = async () => {
    if (busy) return;
    setBusy(true); setFailed('');
    try { await news.confirm(); }
    catch (err) { setFailed(err?.message || String(err)); }
    finally { setBusy(false); }
  };
  const history = (e) => { e?.preventDefault?.(); navigate?.('/v1/changelog'); };

  // One row at the end of the home that says how many updates are unread, and opens in place: the
  // home leads with what waits for the person and the work, and the updates are read when the person
  // chooses. Open, the lines, then Read and the way to the history; closed, the row is the one action.
  const highlights = news.highlights;
  const shownOthers = news.others.slice(0, OTHERS_SHOWN);
  const moreOthers = news.others.length - shownOthers.length + news.hidden;
  // The home's contents rail lists this row under a short name, with every change it holds counted
  // (components/ContentsRail.js); the marker draws no box of its own.
  const total = news.highlights.length + news.others.length + news.hidden;
  const sub = news.mode === 'window'
    ? tr('news.subWindow', 'the last {n} days').replace('{n}', String(WINDOW_DAYS))
    : tr('news.subUnread', '{n} unread').replace('{n}', String(total));
  return html`
    <div class="rail-mark" data-rail="news" data-rail-label=${tr('home.rail.news', 'System updates')} data-rail-count=${String(total)}>
    <${FoldSection} id="home-news" num="" title=${tr('home.rail.news', 'System updates')} sub=${sub} open=${open} onToggle=${() => setOpen(!open)}>
      ${highlights.length > 0 && html`
        <${NamedRow} stack label=${tr('news.highlights', 'Important')}>
          <${Note} kind="aside">
            <${List} cols="name">${highlights.map((it) => rowOf(it, lang))}<//>
          <//>
        <//>`}

      ${shownOthers.length > 0 && html`
        <${NamedRow} stack label=${tr('news.others', 'Other changes')}>
          <${List} cols="name">${shownOthers.map((it) => rowOf(it, lang))}<//>
        <//>`}

      ${moreOthers > 0 && html`
        <${BandNote}>
          ${(moreOthers === 1
            ? tr('news.moreOne', 'One more change is in the history.')
            : tr('news.moreN', '{n} more changes are in the history.')).replace('{n}', String(moreOthers))}
        <//>`}

      ${failed && html`<${Note} kind="message" error>${failed}<//>`}

      <${Actions}>
        <${Action} small disabled=${busy} onClick=${read}>${tr('news.read', 'Read')}<//>
        <${Action} tone="more" href="/v1/changelog" onClick=${history}>${tr('news.history', 'Everything that has changed →')}<//>
      <//>
    <//>
    </div>`;
}
