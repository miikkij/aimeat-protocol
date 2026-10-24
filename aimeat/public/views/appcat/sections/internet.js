/**
 * @file public/views/appcat/sections/internet.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The detail section "Open to the internet", on the person's own published app on a node
 *   that shows its content to its own accounts only. The owner opens this page and the public intake
 *   forms it declares to everyone on the internet as a watched exception, for example a campaign
 *   landing page, while the rest of the node stays closed. One read, GET
 *   /v1/apps/:owner/:filename/internet-opening, re-read on the SSE change domain `internet-openings`.
 *   Three states: not open (the reason, the forms that open with the page, how long, and "Ask to open"
 *   or "Open to the internet" as the node allows), waiting for an operator ("Withdraw the request"),
 *   and open (the address, who approved it, until when; "Close to the internet" and "Extend", which
 *   sends the same form again). A refusal from the server says why in the page's language. Not shown
 *   on a node open to everyone, where nothing needs opening.
 * @structure meta · InternetSection({ d }) · OpenForm · WaitingPart · OpenPart · refusalText
 * @usage const mod = await import('./sections/internet.js'); html`<${mod.default} d=${d} />`
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (wish-corp-moodissa-julkaistu-app-ulosp-in-vahdittuna-ja-listattun).
 */
import { h } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { tOr } from '/js/i18n.js';
import { date, dateTime } from '/js/format.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { signedInOnly } from '/js/site.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Mark, Marks, Code } from '/components/Mark.js';
import { Facts } from '/components/Facts.js';
import { TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Fields } from '/components/Field.js';
import { getAppInternetOpening, openAppToInternet, closeAppToInternet } from '/js/services/internet-opening.js';
import { confirmAsk } from '/views/appcat/dialogs/confirm.js';
import { x } from '/views/appcat/i18n.js';

const html = htm.bind(h);
const X = (key, vars) => x('internet.' + key, vars);

export const meta = { id: 'internet', title: 'internet.title', show: (d) => !!(d && d.isOwnPublished && signedInOnly()) };

/** The durations offered, in days, up to the node's longest. */
function durations(max) {
  const out = [30, 60, 90].filter(n => n <= max);
  if (!out.includes(max) && max <= 90) out.push(max);
  if (max > 90) out.push(max);
  return out.sort((a, b) => a - b);
}

const daysWords = (n) => (n === 1 ? X('daysOne') : X('daysMany', { n }));
const formName = (f) => `${f.org}/${f.ws}/${f.form_id}`;
const formChips = (forms) => html`<${Marks}>${forms.map(f => html`<${Code} key=${formName(f)}>${formName(f)}<//>`)}<//>`;
const quoted = (s) => (s ? `“${s}”` : '');
/** The outcomes of POST …/internet-opening that have words of their own; any other reads as asked. */
const DONE = new Set(['opened', 'extended', 'requested', 'extend_requested']);

/** Why the server refused, in the page's language when the code is one this section knows. */
export function refusalText(err) {
  const code = err && err.code;
  return code ? tOr('appcat.internet.refused.' + code, err.message) : ((err && err.message) || X('failed'));
}

/** Who approved an opening, or that it needed nobody's approval. */
function underWords(o) {
  switch (o.opened_under) {
    case 'operator-approval': return X('under.approved', { who: String(o.decided_by || '').split('@')[0] || X('under.anOperator') });
    case 'operator': return X('under.operator');
    case 'trusted-opener': return X('under.trusted');
    case 'self-mode': return X('under.self');
    default: return '';
  }
}

/** The forms that open with the page, in one line; or that the page uses none, and where forms are named. */
function FormsLine({ forms }) {
  if (!forms.length) return html`<${Note} kind="quiet" chapter>${X('formsNone')}<//>`;
  return html`<${Note} kind="hint" chapter>${X('formsWith', { forms: forms.map(formName).join(', ') })}<//>`;
}

/**
 * The reason, the forms, the duration, the aside on who decides, and the action: the first opening
 * and an extension send the same form. `onSend(reason, days)` resolves true when the server took it.
 */
function OpenForm({ view, extend, onSend, onCancel }) {
  const options = durations(view.max_days);
  const [reason, setReason] = useState('');
  const [days, setDays] = useState(String(options[options.length - 1]));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const direct = view.may_open_directly;
  const ok = reason.trim().length >= 3;
  const send = async () => {
    setTried(true);
    if (!ok || busy) return;
    setBusy(true);
    const done = await onSend(reason.trim(), Number(days));
    setBusy(false);
    if (done) { setReason(''); setTried(false); }
  };
  const forms = view.opening && view.opening.state === 'open' ? view.opening.forms : view.declared_forms;
  return html`
    ${extend ? null : html`<${Note} kind="lead" chapter>${X('lead')}<//>`}
    <${Fields} plain chapter>
      <${TextArea} label=${X('reason')} hint=${X('reasonHint')} rows=${3} maxLength=${500} value=${reason}
        invalid=${tried && !ok} message=${tried && !ok ? { text: X('reasonNeeded'), error: true } : undefined}
        placeholder=${X('reasonPlaceholder')} onInput=${setReason} />
    <//>
    <${FormsLine} forms=${forms || []} />
    ${(forms || []).length ? null : html`<${Note} kind="quiet" chapter>${X('formsHow')}<//>`}
    <${Fields} plain chapter>
      <${Select} line fit label=${extend ? X('extendFor') : X('openFor')} value=${days} onChange=${setDays}
        options=${options.map(n => [String(n), daysWords(n)])} />
    <//>
    <${Note} kind="aside" size="small" chapter>${direct ? X('asideDirect') : X('asideOperator')}<//>
    <${Actions} chapter>
      <${Loud} control disabled=${busy} onClick=${send}>
        ${extend ? (direct ? X('extend') : X('askExtend')) : (direct ? X('openNow') : X('askOpen'))}
      <//>
      ${onCancel ? html`<${Action} small onClick=${onCancel}>${X('cancel')}<//>` : null}
    <//>`;
}

/** Waiting for an operator: when it was asked, why, the forms, how long, until when the request stands. */
function WaitingPart({ o, onWithdraw }) {
  const req = o.request;
  return html`
    <${Marks}><${Mark} kind="status" tone="attention">${X('waitingChip')}<//><//>
    <${Facts} rows=${[
      { key: 'asked', k: X('asked'), v: dateTime(req.requested_at) },
      { key: 'reason', k: X('reasonShort'), v: quoted(req.reason) },
      { key: 'forms', k: X('forms'), v: o.forms.length ? formChips(o.forms) : X('formsNoneShort') },
      { key: 'days', k: X('length'), v: daysWords(req.days) },
      { key: 'expires', k: X('requestExpires'), v: date(req.expires_at), sub: X('requestExpiresSub') },
    ]} />
    <${Actions} chapter>
      <${Action} small tone="danger" onClick=${onWithdraw}>${X('withdraw')}<//>
    <//>`;
}

/** Open to the internet: the address, who opened and approved it, the reason, the forms, until when. */
function OpenPart({ o, view, onClose, onExtend }) {
  const [extending, setExtending] = useState(false);
  const ext = o.request && o.request.kind === 'extend' ? o.request : null;
  const formsReq = o.forms_request;
  return html`
    <${Marks}><${Mark} kind="status" tone="fine">${X('openChip')}<//><//>
    <${Note} kind="lead" chapter>${X('openLead')}<//>
    <${Facts} rows=${[
      o.url ? { key: 'url', k: X('address'), v: html`<${Action} tone="link" href=${o.url} newTab>${o.url}<//>` } : null,
      { key: 'opened', k: X('opened'), v: dateTime(o.opened_at), sub: underWords(o) },
      { key: 'reason', k: X('reasonShort'), v: quoted(o.reason) },
      { key: 'forms', k: X('forms'), v: o.forms.length ? formChips(o.forms) : X('formsNoneShort') },
      { key: 'until', k: X('until'), v: o.until ? date(o.until) : '—', sub: X('untilSub') },
      ext ? { key: 'ext', k: X('extendWaiting'), v: daysWords(ext.days), sub: X('extendWaitingSub', { date: date(ext.expires_at) }) } : null,
      formsReq ? { key: 'formsReq', k: X('formsWaiting'), v: formChips(formsReq.forms || []), sub: X('formsWaitingSub') } : null,
    ]} />
    ${extending
      ? html`<${OpenForm} view=${view} extend onSend=${async (r, n) => { const done = await onExtend(r, n); if (done) setExtending(false); return done; }}
          onCancel=${() => setExtending(false)} />`
      : html`
        <${Actions} chapter>
          <${Loud} control onClick=${onClose}>${X('close')}<//>
          ${ext ? null : html`<${Action} small onClick=${() => setExtending(true)}>${X('extendOpen')}<//>`}
        <//>`}`;
}

export default function InternetSection({ d }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState('');
  const [refused, setRefused] = useState('');
  const load = useCallback(async () => {
    try {
      const r = await getAppInternetOpening(d.owner, d.filename);
      setView(r.data);
      setError('');
    } catch (err) {
      console.warn('[appcat] the internet opening could not be read', err);
      setError(refusalText(err));
    }
  }, [d.owner, d.filename]);
  useEffect(() => { setView(null); setRefused(''); load(); }, [load]);
  useEffect(() => onLiveUpdate(['internet-openings'], () => load()), [load]);

  /** Open, ask, or extend; true when the server took it. */
  const send = async (reason, days) => {
    setRefused('');
    try {
      const r = await openAppToInternet(d.owner, d.filename, reason, days);
      const outcome = r.data && r.data.outcome;
      d.notice(X('done.' + (DONE.has(outcome) ? outcome : 'requested')), 'success');
      await load();
      return true;
    } catch (err) {
      // The refusal stands under the form in words, and the form keeps what was typed.
      console.warn('[appcat] the internet opening was refused', err);
      setRefused(refusalText(err));
      return false;
    }
  };
  /** Close the opening, or withdraw the request that waits; asked first. */
  const end = async (question, word) => {
    if (!(await confirmAsk(question, { danger: true }))) return;
    setRefused('');
    try {
      await closeAppToInternet(d.owner, d.filename);
      d.notice(word, 'success');
      await load();
    } catch (err) {
      setRefused(refusalText(err));
    }
  };

  if (error) return html`<${Note} kind="hint" chapter>${error}<//>`;
  if (!view) return html`<${Note} kind="hint" chapter>${X('loading')}<//>`;
  if (view.mode === 'not-needed') return null;

  const o = view.opening;
  const isOpen = o && o.state === 'open';
  const isWaiting = o && o.state === 'requested' && o.request;
  let body;
  if (isOpen) {
    body = html`<${OpenPart} o=${o} view=${view} onExtend=${send}
      onClose=${() => end(X('closeAsk'), X('done.closed'))} />`;
  } else if (isWaiting) {
    body = html`<${WaitingPart} o=${o} onWithdraw=${() => end(X('withdrawAsk'), X('done.withdrawn'))} />`;
  } else if (view.mode === 'off') {
    body = html`<${Note} kind="lead" chapter>${X('off')}<//>`;
  } else {
    body = html`
      ${o && o.state === 'declined' ? html`<${Note} kind="aside" size="small" tone="irreversible" chapter>${X('lastDeclined', { note: o.decision_note || '' })}<//>` : null}
      <${OpenForm} view=${view} onSend=${send} />`;
  }
  return html`
    ${body}
    ${refused ? html`<${Note} kind="report" tone="refused" chapter>${refused}<//>` : null}
    ${view.mode === 'off' && !isOpen ? null : html`<${Note} kind="aside" tone="suggestion" chapter>${X('aiExample')}<//>`}`;
}
