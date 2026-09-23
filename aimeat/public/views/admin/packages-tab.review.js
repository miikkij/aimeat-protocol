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

  if (loading) return html`<div class="adm-pk-panel"><${Spinner} text=${t('dashboard.loading')} /></div>`;

  const d = detail || item;
  const chips = partChips(d.components || d.manifest?.components);

  return html`
    <div class="adm-pk-panel">
      <div class="adm-pk-kv">
        <div><span>${P('colPackage')}</span><em>${d.packageGroupId || d.packageName || '–'}</em></div>
        <div><span>${P('colVersion')}</span><em>${d.version || '–'}</em></div>
        <div><span>${P('colCategory')}</span><em>${d.category || '–'}</em></div>
        <div><span>${P('colBy')}</span><em>${d.author || '–'}</em></div>
        <div><span>${P('colWaiting')}</span><em>${when(d.proposedAt || d.createdAt)}</em></div>
        <div><span>${P('colInside')}</span><em>${chips.length ? chips.join(', ') : '–'}</em></div>
      </div>
      ${d.description ? html`<p class="adm-pk-paneldesc">${d.description}</p>` : null}
      <div class="adm-pk-fld">
        <div class="adm-pk-fldl">${P('noteLabel')}</div>
        <input type="text" value=${note} onInput=${(e) => setNote(e.target.value)} placeholder=${P('notePlaceholder')} />
      </div>
      <div class="adm-pk-fld">
        <div class="adm-pk-fldl">${P('reasonLabel')}</div>
        <input type="text" value=${reason} onInput=${(e) => setReason(e.target.value)} placeholder=${P('reasonPlaceholder')} />
      </div>
      <div class="adm-pk-acts">
        <button class="adm-btn" disabled=${acting} onClick=${approve}>${P('approveBtn')}</button>
        <button type="button" class="og-door og-door--quiet og-door--danger" disabled=${acting} onClick=${reject}>${P('rejectBtn')}</button>
      </div>
      ${said && html`<p class="adm-pk-said ${said.ok ? 'is-ok' : 'is-bad'}">${said.msg}</p>`}
      <p class="adm-pk-note">${P('verdictNote')}</p>
    </div>`;
}

export function ReviewBoard({ pending, history, onReload }) {
  const [openId, setOpenId] = useState(null);
  const waiting = pending || [];
  const decided = history || [];

  return html`
    <div>
      ${!waiting.length
    ? html`<p class="adm-pk-quiet">${P('nothingWaiting')}</p>`
    : html`
      <p class="adm-pk-lead">${P('reviewLead')}</p>
      <div class="adm-pk-qhead">
        <span>${P('colListing')}</span><span>${P('colPackage')}</span><span>${P('colBy')}</span><span>${P('colWaitingFor')}</span><span></span>
      </div>
      ${waiting.map((item) => html`
        <div key=${item.id}>
          <button type="button" class="adm-pk-qrow ${openId === item.id ? 'is-open' : ''}"
            onClick=${() => setOpenId(openId === item.id ? null : item.id)}>
            <span><b>${item.name || item.title || '–'}</b></span>
            <span class="adm-pk-mono" data-l=${P('colPackage')}>${item.packageGroupId || item.packageName || '–'}</span>
            <span class="adm-pk-mono" data-l=${P('colBy')}>${item.author || '–'}</span>
            <span class="adm-pk-mono" data-l=${P('colWaitingFor')}>${sinceWords(item.proposedAt || item.createdAt)}</span>
            <span class="adm-pk-caret">${openId === item.id ? '↑' : '↓'}</span>
          </button>
          ${openId === item.id && html`<${Panel} item=${item} onDone=${() => { setOpenId(null); onReload(); }} />`}
        </div>`)}`}

      ${decided.length > 0 && html`
        <p class="adm-pk-lead" style="margin-top: 18px">${P('decidedLead')}</p>
        ${decided.map((d, i) => html`
          <div class="adm-pk-hrow" key=${i}>
            <span><b>${d.templateName || d.name || '–'}</b></span>
            <span><${Badge} type=${d.decision || d.action || 'muted'} /></span>
            <span class="adm-pk-mono" data-l=${P('colReason')}>${d.reason || d.comment || '–'}</span>
            <span class="adm-pk-mono" data-l=${P('colWhen')}>${when(d.reviewedAt || d.date)}</span>
          </div>`)}
        <p class="adm-pk-note">${P('decidedNote')}</p>`}
    </div>`;
}
