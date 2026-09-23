/**
 * @file public/views/admin/packages-tab.review.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 05 of the Packages page: the listings waiting for an operator to approve
 *   them, the one opened for review, and the decisions already made. Split out of packages-tab.js
 *   because the review board is the only part of the page with a form and a verdict in it.
 *
 * @structure
 *   - ReviewBoard({ pending, history, onReload }) — the queue, the panel and the decisions
 *   - sinceWords(iso) — "2 days", "5 hours", in the operator's language
 *
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set: the queue and the decisions as list
 *     rows (a waiting one opens in place), the panel as a shared box of key-value rows and fields.
 *   v1.0.0 — 2026-09-12 — Initial, from the moderation sub-tab's three cards. The queue and the
 *     history are one section now, the panel is the poster's 2px box, and the review actions read
 *     as one loud Approve with a reason field beside it instead of two competing buttons.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { when, Badge, Spinner } from './shared.js';
import { Stack, ListRow, KeyValue, Field, Action, Surface, Text } from '/components/poster-parts.js';
import { reviewTemplate, approveTemplate, rejectTemplate } from '/js/services/admin.js';
import { swallowed } from '/js/swallowed.js';

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
function Panel({ item, onDone }) {
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

  return html`<${Surface} kind="box">
    <${Stack}>
      <div>
        <${KeyValue} label=${P('colPackage')} value=${d.packageGroupId || d.packageName || '–'} mono=${true} />
        <${KeyValue} label=${P('colVersion')} value=${d.version || '–'} mono=${true} />
        <${KeyValue} label=${P('colCategory')} value=${d.category || '–'} mono=${true} />
        <${KeyValue} label=${P('colBy')} value=${d.author || '–'} mono=${true} />
        <${KeyValue} label=${P('colWaiting')} value=${when(d.proposedAt || d.createdAt)} mono=${true} />
        <${KeyValue} label=${P('colInside')} value=${chips.length ? chips.join(', ') : '–'} mono=${true} />
      </div>
      ${d.description ? html`<${Text}>${d.description}<//>` : null}
      <${Field} label=${P('noteLabel')} value=${note} onInput=${(e) => setNote(e.target.value)} placeholder=${P('notePlaceholder')} />
      <${Field} label=${P('reasonLabel')} value=${reason} onInput=${(e) => setReason(e.target.value)} placeholder=${P('reasonPlaceholder')} />
      <${Stack} direction="wrap" align="center">
        <${Action} kind="primary" disabled=${acting} onClick=${approve}>${P('approveBtn')}<//>
        <${Action} tone="danger" disabled=${acting} onClick=${reject}>${P('rejectBtn')}<//>
      <//>
      ${said && html`<${Text} tone=${said.ok ? 'success' : 'danger'}>${said.msg}<//>`}
      <${Text} kind="caption" tone="muted">${P('verdictNote')}<//>
    <//>
  <//>`;
}

export function ReviewBoard({ pending, history, onReload }) {
  const [openId, setOpenId] = useState(null);
  const waiting = pending || [];
  const decided = history || [];

  return html`<${Stack}>
    ${!waiting.length
      ? html`<${Text} tone="muted">${P('nothingWaiting')}<//>`
      : html`
        <${Text} kind="lead">${P('reviewLead')}<//>
        <div>
          ${waiting.map((item) => {
            const isOpen = openId === item.id;
            const toggle = () => setOpenId(isOpen ? null : item.id);
            return html`<${ListRow} key=${item.id} name=${item.name || item.title || '–'} onOpen=${toggle} open=${isOpen} arrow=${true}
              detail=${`${item.packageGroupId || item.packageName || '–'} · ${item.author || '–'}`}
              value=${html`<${Text} kind="mono">${sinceWords(item.proposedAt || item.createdAt)}<//>`}>
              ${isOpen && html`<${Panel} item=${item} onDone=${() => { setOpenId(null); onReload(); }} />`}
            <//>`;
          })}
        </div>`}

    ${decided.length > 0 && html`
      <${Text} kind="lead">${P('decidedLead')}<//>
      <div>
        ${decided.map((d, i) => html`<${ListRow} key=${i} density="compact" name=${d.templateName || d.name || '–'}
          detail=${`${d.reason || d.comment || '–'} · ${when(d.reviewedAt || d.date)}`}
          value=${html`<${Badge} type=${d.decision || d.action || 'muted'} />`} />`)}
      </div>
      <${Text} kind="caption" tone="muted">${P('decidedNote')}<//>`}
  <//>`;
}
