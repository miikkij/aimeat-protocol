/**
 * @file public/views/admin/packages-tab.review.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 05 of the Packages page: the listings waiting for an operator to approve
 *   them, the one opened for review, and the decisions already made. Split out of packages-tab.js
 *   because the review board is the only part of the page with a form and a verdict in it.
 *   Drawn only from library components: the page passes data and writes no class.
 *
 * @structure
 *   - ReviewBoard({ pending, history, onReload }) — the queue, the panel and the decisions
 *   - sinceWords(iso) — "2 days", "5 hours", in the operator's language
 *
 * @version-history
 *   v2.0.0 — 2026-09-27 — Library components only: the queue is a List whose rows open on a click
 *     anywhere (the caret ↑/↓ kept in its own cell), the opened listing the row's Panel with its
 *     facts (Facts), the note and reason TextFields, Loud Approve and the danger Action Reject; the
 *     decisions a List under a lead that keeps its space above (Space). The inline style goes.
 *   v1.0.0 — 2026-09-12 — Initial, from the moderation sub-tab's three cards. The queue and the
 *     history are one section now, the panel is the poster's 2px box, and the review actions read
 *     as one loud Approve with a reason field beside it instead of two competing buttons.
 */
import { h, Fragment } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { when, Badge, Spinner } from './shared.js';
import { reviewTemplate, approveTemplate, rejectTemplate } from '/js/services/admin.js';
import { swallowed } from '/js/swallowed.js';
import { Note } from '/components/Note.js';
import { List, Row, Name, Cell } from '/components/List.js';
import { Facts } from '/components/Facts.js';
import { TextField } from '/components/TextField.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Space } from '/components/Layout.js';

const P = (key, vars) => t('dashboard.pkgPage.' + key, vars);

/** How long something has been waiting, in the largest unit that is still true. */
function sinceWords(iso) {
  if (!iso) return '';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return P('sinceMinutes', { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 48) return hours === 1 ? P('sinceHourOne') : P('sinceHours', { n: hours });
  return P('sinceDays', { n: Math.round(hours / 24) });
}

/** The parts inside a package, as `type` chips with a count when a type repeats. */
function partChips(components) {
  const counts = {};
  for (const c of components || []) {
    const type = c.type || c.kind || 'part';
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return Object.entries(counts).map(([type, n]) => (n > 1 ? `${type} ×${n}` : type));
}

/** The listing opened for review: what it is, what is inside it, and the two verdicts. */
function ReviewPanel({ item, onDone }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [acting, setActing] = useState(false);
  const [said, setSaid] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await reviewTemplate(item.id);
        if (!cancelled && res.ok !== false) setDetail(res.data);
      } catch (err) { swallowed('packages-tab.review: open', err); }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [item.id]);

  async function approve() {
    setActing(true);
    setSaid(null);
    try {
      const res = await approveTemplate(item.id, note || undefined);
      if (res.ok === false) setSaid({ ok: false, msg: res.error?.message || P('failed') });
      else onDone();
    } catch (e) { setSaid({ ok: false, msg: e.message }); }
    setActing(false);
  }

  async function reject() {
    if (!reason.trim()) { setSaid({ ok: false, msg: P('reasonRequired') }); return; }
    setActing(true);
    setSaid(null);
    try {
      const res = await rejectTemplate(item.id, reason);
      if (res.ok === false) setSaid({ ok: false, msg: res.error?.message || P('failed') });
      else onDone();
    } catch (e) { setSaid({ ok: false, msg: e.message }); }
    setActing(false);
  }

  if (loading) return html`<${Spinner} text=${t('dashboard.loading')} />`;

  const d = detail || item;
  const chips = partChips(d.components || d.manifest?.components);

  return html`<${Fragment}>
    <${Facts} flush rows=${[
      { k: P('colPackage'), v: d.packageGroupId || d.packageName || '–', mono: true },
      { k: P('colVersion'), v: d.version || '–', mono: true },
      { k: P('colCategory'), v: d.category || '–' },
      { k: P('colBy'), v: d.author || '–', mono: true },
      { k: P('colWaiting'), v: when(d.proposedAt || d.createdAt), mono: true },
      { k: P('colInside'), v: chips.length ? chips.join(', ') : '–', mono: true },
    ]} />
    ${d.description ? html`<${Note} kind="lead">${d.description}<//>` : null}
    <${TextField} label=${P('noteLabel')} value=${note} onInput=${setNote} placeholder=${P('notePlaceholder')} />
    <${TextField} label=${P('reasonLabel')} value=${reason} onInput=${setReason} placeholder=${P('reasonPlaceholder')} />
    <${Actions}>
      <${Loud} control disabled=${acting} onClick=${approve}>${P('approveBtn')}<//>
      <${Action} small soft tone="danger" disabled=${acting} onClick=${reject}>${P('rejectBtn')}<//>
    <//>
    ${said && html`<${Note} kind="message" error=${!said.ok}>${said.msg}<//>`}
    <${Note}>${P('verdictNote')}<//>
  <//>`;
}

export function ReviewBoard({ pending, history, onReload }) {
  const [openId, setOpenId] = useState(null);
  const waiting = pending || [];
  const decided = history || [];

  return html`<${Fragment}>
    ${waiting.length > 0 && html`<${Note} kind="lead">${P('reviewLead')}<//>`}
    <${List} cols="name-id-who-when-mark" labels stackWide empty=${P('nothingWaiting')}
      head=${[P('colListing'), P('colPackage'), P('colBy'), P('colWaitingFor'), '']}>
      ${waiting.map((item) => {
    const open = openId === item.id;
    return html`
        <${Row} key=${item.id} open=${open} onToggle=${() => setOpenId(open ? null : item.id)}
          panel=${html`<${ReviewPanel} item=${item} onDone=${() => { setOpenId(null); onReload(); }} />`}>
          <${Name}>${item.name || item.title || '–'}<//>
          <${Cell} meta>${item.packageGroupId || item.packageName || '–'}<//>
          <${Cell} meta>${item.author || '–'}<//>
          <${Cell} meta>${sinceWords(item.proposedAt || item.createdAt)}<//>
          <${Cell}>${open ? '↑' : '↓'}<//>
        <//>`;
  })}
    <//>

    ${decided.length > 0 && html`
      <${Space} above="large"><${Note} kind="lead">${P('decidedLead')}<//><//>
      <${List} cols="name-state-words-when" labels stackWide
        head=${[P('colListing'), '', P('colReason'), P('colWhen')]}>
        ${decided.map((d, i) => html`
          <${Row} key=${i}>
            <${Name}>${d.templateName || d.name || '–'}<//>
            <${Cell}><${Badge} type=${d.decision || d.action || 'muted'} /><//>
            <${Cell} meta>${d.reason || d.comment || '–'}<//>
            <${Cell} meta>${when(d.reviewedAt || d.date)}<//>
          <//>`)}
      <//>
      <${Note}>${P('decidedNote')}<//>`}
  <//>`;
}
