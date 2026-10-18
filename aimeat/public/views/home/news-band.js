/**
 * @file public/views/home/news-band.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The band at the top of the home that says what is new on this node since the person
 *   last looked: the highlights first and marked, then a few short lines, each naming whom it
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
 *   v1.0.0 — 2026-10-18 — Initial (wish-uutta-aimeatissa-mit-on-tullut-sitten-viime-katselun-kenelle).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale, onLocaleChange } from '/js/i18n.js';
import { Band, BandNote } from '/components/Band.js';
import { NamedRow } from '/components/NamedRow.js';
import { List, Row, Name } from '/components/List.js';
import { Stack } from '/components/Layout.js';
import { Action, Actions, Loud } from '/components/Action.js';
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

  if (!news.ready || news.mode === 'none') return null;

  const read = async () => {
    if (busy) return;
    setBusy(true); setFailed('');
    try { await news.confirm(); }
    catch (err) { setFailed(err?.message || String(err)); }
    finally { setBusy(false); }
  };
  const history = (e) => { e?.preventDefault?.(); navigate?.('/v1/changelog'); };

  const shownOthers = news.others.slice(0, OTHERS_SHOWN);
  const moreOthers = news.others.length - shownOthers.length + news.hidden;
  const title = news.mode === 'window'
    ? tr('news.titleWindow', 'The most important changes of the last {n} days').replace('{n}', String(WINDOW_DAYS))
    : tr('news.titleSince', 'New since you last looked');

  return html`
    <${Stack} below="part">
    <${Band} title=${title}>
      ${news.highlights.length > 0 && html`
        <${NamedRow} stack label=${tr('news.highlights', 'Important')}>
          <${Note} kind="aside">
            <${List} cols="name">${news.highlights.map((it) => rowOf(it, lang))}<//>
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
        <${Loud} control disabled=${busy} onClick=${read}>${tr('news.read', 'Read')}<//>
        <${Action} tone="more" href="/v1/changelog" onClick=${history}>${tr('news.history', 'Everything that has changed →')}<//>
      <//>
    <//>
    <//>`;
}
