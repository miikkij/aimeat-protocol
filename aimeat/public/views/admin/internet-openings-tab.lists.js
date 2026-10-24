/**
 * @file public/views/admin/internet-openings-tab.lists.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The three lists of the admin page "Open to the internet" (internet-openings-tab.js):
 *   what waits for the operator's decision (one boxed item per request: the app, who asked and when,
 *   the reason, the forms, how long, when the request lapses, a note, Approve as the one loud action,
 *   Decline, and the app's address), the apps open now (who opened it, when, who approved it, until
 *   when, the version against the version opened, the history inline under "Details", and "Close"
 *   with an optional reason), and what closed or was declined in the last 30 days. Every part is a
 *   library component; the page passes data and writes no class.
 * @structure WaitingSection (WaitingItem) · OpenSection (CloseLine) · ClosedSection · HistoryList
 * @usage import { WaitingSection, OpenSection, ClosedSection } from './internet-openings-tab.lists.js';
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (wish-corp-moodissa-julkaistu-app-ulosp-in-vahdittuna-ja-listattun).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { date, dateTime } from '/js/format.js';
import { num } from './shared.js';
import { Section } from '/components/Section.js';
import { List, Row, Name, Who, When, Cell, Doors } from '/components/List.js';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Mark, Code } from '/components/Mark.js';
import { Box } from '/components/Box.js';
import { Facts } from '/components/Facts.js';
import { TextField } from '/components/TextField.js';
import { Fields } from '/components/Field.js';
import { Stack, Row as Line } from '/components/Layout.js';
import { O, whoWords, formChips, formsLine, daysWords, underWords, stateTone } from './internet-openings-tab.parts.js';

const html = htm.bind(h);

/** How many days before its end an opening counts as ending soon (the server's REMIND_DAYS). */
const SOON_DAYS = 7;
const endsSoon = (o) => !!o.until && new Date(o.until).getTime() - Date.now() <= SOON_DAYS * 86_400_000;
const quoted = (s) => (s ? `“${s}”` : '');

/** The items that wait: an open or extend request, and forms a new version added, each its own item. */
export function waitingItems(openings) {
  const out = [];
  for (const o of openings) {
    if (o.request) out.push({ key: o.id + ':request', which: 'request', o, req: o.request });
    if (o.forms_request) out.push({ key: o.id + ':forms', which: 'forms', o, req: o.forms_request });
  }
  return out.sort((a, b) => String(a.req.requested_at).localeCompare(String(b.req.requested_at)));
}

/** One request in its box, with its own note field. `onDecide(item, decision, note)` resolves true when done. */
function WaitingItem({ item, onDecide }) {
  const { o, req } = item;
  const [note, setNote] = useState('');
  const [needNote, setNeedNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const decide = async (decision) => {
    if (decision === 'decline' && note.trim().length < 3) { setNeedNote(true); return; }
    setBusy(true);
    const done = await onDecide(item, decision, note.trim());
    setBusy(false);
    if (done) setNote('');
  };
  const forms = req.kind === 'forms' ? req.forms : o.forms;
  const length = req.kind === 'extend' ? O('waiting.extendDays', { days: daysWords(req.days) }) : daysWords(req.days);
  return html`
    <${Box} tone="waiting" name=${o.app_name || o.app} marks=${html` <${Code}>${o.app}<//>`}
      end=${html`<${Mark} kind="status" tone="attention">${O('waiting.kind.' + req.kind)}<//>`}
      doors=${html`
        <${Loud} control disabled=${busy} onClick=${() => decide('approve')}>${O('waiting.approve')}<//>
        <${Action} small disabled=${busy} onClick=${() => decide('decline')}>${O('waiting.decline')}<//>
        ${o.url ? html`<${Action} small soft href=${o.url} newTab>${O('waiting.openApp')}<//>` : null}`}>
      <${Facts} rows=${[
        { key: 'asked', k: O('waiting.asked'), v: dateTime(req.requested_at), sub: whoWords(req.requested_by) },
        { key: 'reason', k: O('waiting.reason'), v: quoted(req.reason) },
        { key: 'forms', k: req.kind === 'forms' ? O('waiting.newForms') : O('waiting.forms'), v: formChips(forms) },
        req.kind === 'forms' ? null : { key: 'days', k: O('waiting.length'), v: length },
        { key: 'expires', k: O('waiting.expires'), v: date(req.expires_at), sub: O('waiting.expiresSub') },
      ]} />
      <${Fields}>
        <${TextField} label=${O('waiting.note')} hint=${O('waiting.noteHint')} value=${note} maxLength=${500}
          invalid=${needNote && note.trim().length < 3}
          message=${needNote && note.trim().length < 3 ? { text: O('waiting.noteNeeded'), error: true } : undefined}
          onInput=${(v) => { setNote(v); if (needNote && v.trim().length >= 3) setNeedNote(false); }} />
      <//>
    <//>`;
}

/** "Waiting for your decision": one box per request, the oldest first. */
export function WaitingSection({ number, openings, onDecide }) {
  const items = waitingItems(openings);
  return html`
    <${Section} id="adm-io-waiting" num=${number} title=${O('waiting.title')} count=${items.length ? num(items.length) : undefined}>
      <${Note} kind="lead">${O('waiting.lead')}<//>
      ${items.length === 0
        ? html`<${Note} kind="quiet">${O('waiting.none')}<//>`
        : html`<${Stack} gap="medium">${items.map(item => html`<${WaitingItem} key=${item.key} item=${item} onDecide=${onDecide} />`)}<//>`}
    <//>`;
}

/** The history of one opening, newest first: the date, what happened, the note, and who did it. */
export function HistoryList({ history }) {
  if (!history || !history.length) return html`<${Note} kind="quiet">${O('history.none')}<//>`;
  return html`
    <${List} tone="log" dense cols="when-kind-name-who">
      ${history.map((e, i) => {
        const extra = [e.note ? quoted(e.note) : '', e.version ? O('history.version', { n: num(e.version) }) : '', e.forms && e.forms.length ? formsLine(e.forms) : '']
          .filter(Boolean).join(' · ');
        return html`
          <${Row} key=${i}>
            <${When}>${dateTime(e.at)}<//>
            <${Cell}>${O('history.kind.' + e.kind)}<//>
            <${Name}>${extra || O('history.noNote')}<//>
            <${Who}>${whoWords(e.by)}<//>
          <//>`;
      })}
    <//>`;
}

/** The confirmation under a row before it closes: an optional reason, then Close or Cancel. */
function CloseLine({ o, onClose, onCancel }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const close = async () => {
    setBusy(true);
    const done = await onClose(o, reason.trim());
    setBusy(false);
    if (done) onCancel();
  };
  return html`
    <${Stack} gap="small">
      <${Note} kind="aside" size="small" tone="irreversible">${O('open.closeAsk', { app: o.app_name || o.app })}<//>
      <${TextField} label=${O('open.closeReason')} hint=${O('open.closeReasonHint')} value=${reason} maxLength=${500}
        onInput=${setReason} onEnter=${close} />
      <${Line} wrap>
        <${Action} small control tone="danger" disabled=${busy} onClick=${close}>${O('open.closeNow')}<//>
        <${Action} small soft disabled=${busy} onClick=${onCancel}>${O('open.cancel')}<//>
      <//>
    <//>`;
}

/** "Open now": every app open to the internet, with its history under "Details" and "Close". */
export function OpenSection({ number, openings, onClose }) {
  const [shown, setShown] = useState(null);
  const [closing, setClosing] = useState(null);
  const open = openings.filter(o => o.state === 'open');
  return html`
    <${Section} id="adm-io-open" num=${number} title=${O('open.title')} count=${open.length ? num(open.length) : undefined}>
      <${Note} kind="lead">${O('open.lead')}<//>
      <${List} cols="name-when-who-state-when-doors" labels apart empty=${O('open.none')}
        head=${[O('open.colApp'), O('open.colOpened'), O('open.colBy'), O('open.colVersion'), O('open.colUntil'), '']}>
        ${open.map(o => {
          const newer = o.current_version && o.opened_version && o.current_version > o.opened_version;
          return html`
            <${Row} key=${o.id} open=${shown === o.id} panel=${html`<${HistoryList} history=${o.history} />`}
              below=${closing === o.id ? html`<${CloseLine} o=${o} onClose=${onClose} onCancel=${() => setClosing(null)} />` : undefined}>
              <${Name} href=${o.url || undefined} newTab meta=${o.app} desc=${quoted(o.reason)}
                marks=${(o.forms || []).map(f => html`<${Code} key=${`${f.org}/${f.ws}/${f.form_id}`}>${f.org}/${f.ws}/${f.form_id}<//>`)}
                note=${newer ? O('open.newVersion', { n: num(o.current_version) }) : undefined}>${o.app_name || o.app}<//>
              <${When}>${date(o.opened_at)}<//>
              <${Who} sub=${underWords(o)}>${whoWords(o.requested_by)}<//>
              <${Cell} meta>${o.current_version ? O('open.version', { n: num(o.current_version), m: num(o.opened_version || o.current_version) }) : '—'}<//>
              <${When} warn=${endsSoon(o)}>${o.until ? date(o.until) : '—'}<//>
              <${Doors}>
                <${Action} small row expanded=${shown === o.id} onClick=${() => setShown(shown === o.id ? null : o.id)}>${O('open.details')}<//>
                <${Action} small row tone="danger" onClick=${() => setClosing(closing === o.id ? null : o.id)}>${O('open.close')}<//>
              <//>
            <//>`;
        })}
      <//>
    <//>`;
}

/** The one line of a closed or declined opening: why, by whom, when. */
function endLine(o) {
  switch (o.state) {
    case 'declined': return O('closed.declinedLine', { who: whoWords(o.decided_by), note: o.decision_note || '' });
    case 'request_expired': return O('closed.lapsedLine');
    case 'expired': return O('closed.expiredLine', { date: date(o.until) });
    default: return O('closed.closedLine', { who: whoWords(o.closed_by), reason: o.close_reason || '' });
  }
}

/** When it ended: the newest history entry, or the closing time. */
const endedAt = (o) => (o.history && o.history[0] ? o.history[0].at : o.closed_at || o.decided_at || o.requested_at);

/** "Closed and declined, 30 days": a short list with a state chip and one line, the history under Details. */
export function ClosedSection({ number, openings, notNeeded }) {
  const [shown, setShown] = useState(null);
  const ended = openings.filter(o => o.state !== 'open' && o.state !== 'requested');
  return html`
    <${Section} id="adm-io-closed" num=${number} title=${O('closed.title')}>
      ${notNeeded ? null : html`<${Note} kind="lead">${O('closed.lead')}<//>`}
      <${List} cols="state-name-who-when-doors" empty=${O('closed.none')}>
        ${ended.map(o => html`
          <${Row} key=${o.id} open=${shown === o.id} panel=${html`<${HistoryList} history=${o.history} />`}>
            <${Cell} line><${Mark} kind="status" tone=${stateTone(o.state)}>${O('state.' + o.state)}<//><//>
            <${Name} meta=${o.app} desc=${endLine(o)}>${o.app_name || o.app}<//>
            <${Who}>${o.owner}<//>
            <${When}>${date(endedAt(o))}<//>
            <${Doors}><${Action} small row expanded=${shown === o.id} onClick=${() => setShown(shown === o.id ? null : o.id)}>${O('open.details')}<//><//>
          <//>`)}
      <//>
    <//>`;
}
