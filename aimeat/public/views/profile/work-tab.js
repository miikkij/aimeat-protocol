/**
 * @file work-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab for managing incoming and outgoing work requests.
 *   Displays inbox (received) and sent work items with accept/decline/deliver actions
 *   and a rating modal for completed deliveries.
 * @version-history
 *   v1.15.0 -- 2026-09-26 -- Rating a work item is the library's Rating stars in the tone to give (css/components/rating-stars.css): dark up to the rating and up to the star under the pointer, instead of amber (a unification: Jouni's decision "Rating stars").
 *   v1.14.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.13.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.12.0 -- 2026-09-25 -- The older tabs' remaining help lines are the Hint (.poster-hint); their own sizes and greys go, a place keeps its margin (a unification: the look most tabs use).
 *   v1.11.0 -- 2026-09-25 -- A list drawn as classic cards is the Listing (css/components/listing.css), a row that opens shows the Listing's open panel; the card, its header, arrow and detail rules go (a unification: the look most tabs use).
 *   v1.10.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.9.0 -- 2026-09-25 -- The crumb is the full trail (Settings & Controls / the menu group / the tab), as in the kit tabs (a unification).
 *   v1.8.0 -- 2026-09-25 -- The page head is the kit's crumb trail and page head (.og-crumb, .og-mast, .og-title, .og-desc), the look most tabs use (a unification).
 *   v1.7.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.6.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.5.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.4.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   2026-09-13 -- V2u: compose the tab strip top rule from poster.css.
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   2026-09-13 — The rate and deliver dialogs' actions sit in their footers, Cancel first.
 *   2026-09-13 — V1: compose page and B1 section headings from the shared poster classes.
 *   v1.3.0 — 2026-07-16 — Mount folds inbox + sent into GET /v1/work/overview (getWorkOverview); individual reads kept as fallback.
 *   v1.0.0 — 2026-03-16 — Initial work tab
 *   v1.1.0 — 2026-03-17 — Replace inline styles with CSS classes; i18n for action labels
 *   v1.2.0 — 2026-06-02 — Component unification (#2): Rate + Deliver modals use the
 *     canonical <Modal> component (Escape/backdrop close + header ✕) instead of
 *     hand-rolled .modal-overlay markup.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Modal } from '/components/Modal.js';
import { escHtml, timeAgo } from '/js/utils.js';
import { LoadingLine } from './shared.js';
import { listInbox, listSent, getWorkOverview, submitRating, acceptWork, rejectWork, deliverWork } from '/js/services/work.js';
import { swallowed } from '/js/swallowed.js';

export default function WorkTab({ session, showToast, onStats }) {
  const [workInbox, setWorkInbox] = useState(null);
  const [workSent, setWorkSent] = useState(null);
  const [workSubTab, setWorkSubTab] = useState('inbox');
  const [rateModal, setRateModal] = useState(null);
  const [deliverModal, setDeliverModal] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);

  const loadData = useCallback(async () => {
    // Mount fold: ONE composite (inbox + sent). On failure, fall back to the individual reads.
    const ov = await getWorkOverview();
    if (ov) {
      setWorkInbox(ov.inbox);
      onStats?.({ work: ov.inbox.length });
      setWorkSent(ov.sent);
      return;
    }
    try {
      const inbox = await listInbox();
      setWorkInbox(inbox);
      onStats?.({ work: inbox.length });
    } catch (err) { swallowed('work-tab', err); setWorkInbox([]); }
    try {
      const sent = await listSent();
      setWorkSent(sent);
    } catch (err) { swallowed('work-tab', err); setWorkSent([]); }
  }, [onStats]);

  useEffect(() => {
    if (session) loadData();
  }, [session, loadData]);

  // A TAB SHOWING SERVER DATA RE-FETCHES ON THE LIVE STREAM. Every sibling here subscribes; these
  // three did not, so a work item accepted or delivered anywhere else -- another tab, an agent, the
  // MCP surface -- left this list showing yesterday until the person reloaded. Review item 7.6.
  useEffect(() => {
    // The DOMAINS this tab actually depends on. A listener that re-fetches on every event of any
    // kind is the fan-out services/surface/shared-read.js exists to remove; the sibling tabs filter,
    // and so does this. `detail.domains` absent means "everything changed", which is the legacy
    // announce and must still be honoured.
    const handler = (e) => {
      const d = e.detail?.domains;
      if (d && !['work', 'disputes'].some(x => d.has(x))) return;
      if (session) loadData();
    };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [session, loadData]);

  async function handleRate(workId, rating, comment) {
    if (!rating) { showToast(t('profile.work.selectRating'), true); return; }
    const resp = await submitRating(workId, rating, comment);
    if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
    showToast(t('profile.work.ratingSubmitted'));
    setRateModal(null);
    loadData();
  }

  async function handleAccept(tc) {
    setActionLoading(tc);
    try {
      const resp = await acceptWork(tc);
      if (resp.ok === false) { showToast(resp.error?.message || t('profile.work.accepted'), true); return; }
      showToast(t('profile.work.accepted'));
      loadData();
    } catch (e) {
      showToast(e.message || t('profile.work.accepted'), true);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReject(tc) {
    setActionLoading(tc);
    try {
      const resp = await rejectWork(tc);
      if (resp.ok === false) { showToast(resp.error?.message || t('profile.work.declined'), true); return; }
      showToast(t('profile.work.declined'));
      loadData();
    } catch (e) {
      showToast(e.message || t('profile.work.declined'), true);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDeliver(tc, result) {
    setActionLoading(tc);
    try {
      const resp = await deliverWork(tc, result);
      if (resp.ok === false) { showToast(resp.error?.message || t('profile.work.delivered'), true); return; }
      showToast(t('profile.work.delivered'));
      setDeliverModal(null);
      loadData();
    } catch (e) {
      showToast(e.message || t('profile.work.delivered'), true);
    } finally {
      setActionLoading(null);
    }
  }

  function statusBadgeClass(status) {
    switch (status) {
      case 'completed':
      case 'accepted':
      case 'in_progress': return 'poster-status--fine';
      case 'delivered': return 'poster-status--attention';
      case 'rejected':
      case 'cancelled': return 'poster-status--danger';
      default: return 'poster-status--off';
    }
  }

  function renderList(items, type) {
    if (!items) return html`<${LoadingLine} text=${t('profile.work.loading')} />`;
    if (items.length === 0) return html`<div class="poster-quiet">${t(type === 'sent' ? 'profile.work.sentEmpty' : 'profile.work.empty')}</div>`;
    return html`<div class="listing listing--name-desc-doors">${items.map(w => {
      const tc = w.tc || w.id || w.work_id;
      const isLoading = actionLoading === tc;
      const status = w.status || '-';
      const isPending = status === 'pending' || status === 'offered';
      const isActive = status === 'accepted' || status === 'in_progress';

      return html`
        <div class="listing-row" key=${tc}>
          <div class="listing-name">${escHtml(w.description || w.action_name || '-')}</div>
          <div class="listing-desc">
            ${type === 'sent' ? t('profile.work.provider') + ': ' + escHtml(w.provider_gaii || '-') : t('profile.work.from') + ': ' + escHtml(w.requester_gaii || '-')}
            ${w.price_morsels != null ? ' \u2502 ' + t('profile.work.cost') + ': ' + w.price_morsels + ' \u2764\uFE0F' : ''}
            ${w.created_at ? ' \u2502 ' + timeAgo(w.created_at) : ''}
          </div>
          <div class="listing-doors">
          <span class="poster-status ${statusBadgeClass(status)}">${status}</span>
          ${type === 'inbox' && isPending && html`
              <button class="poster-slab poster-slab--control" disabled=${isLoading} onClick=${() => handleAccept(tc)}>
                ${isLoading ? '...' : t('profile.work.accepted')}
              </button>
              <button class="poster-action poster-action--small poster-action--row" disabled=${isLoading} onClick=${() => handleReject(tc)}>
                ${isLoading ? '...' : t('profile.work.declined')}
              </button>
          `}

          ${type === 'inbox' && isActive && html`
              <button class="poster-slab poster-slab--control" disabled=${isLoading} onClick=${() => setDeliverModal({ tc, desc: w.description || w.action_name })}>
                ${t('profile.work.deliver')}
              </button>
          `}

          ${type === 'sent' && w.status === 'delivered' && html`
            <button class="poster-action poster-action--small poster-action--row" onClick=${() => setRateModal({ workId: tc, desc: w.description || w.action_name })}>${t('profile.work.rateBtn')}</button>
          `}
          </div>
        </div>
      `;
    })}</div>`;
  }

  return html`
    <div class="og mb-1">
      <div class="og-crumb"><span>${t('nav.profile')}</span><span>/</span><span>${t('profile.landing.menuBuildShare')}</span><span>/</span><span class="og-crumb-here">${t('profile.tabs.work')}</span></div>
      <div class="og-mast"><div class="og-mast-words">
        <div class="og-title poster-page-title">${t('profile.work.title')}</div>
        <div class="og-desc">${t('profile.work.desc')}</div>
      </div></div>
    </div>
    <div class="sub-tabs poster-row--thing">
      <button class="poster-tab ${workSubTab === 'inbox' ? 'is-on' : ''}" onClick=${() => setWorkSubTab('inbox')}>${t('profile.work.inbox')}</button>
      <button class="poster-tab ${workSubTab === 'sent' ? 'is-on' : ''}" onClick=${() => setWorkSubTab('sent')}>${t('profile.work.sent')}</button>
    </div>
    ${workSubTab === 'inbox' ? renderList(workInbox, 'inbox') : renderList(workSent, 'sent')}

    ${rateModal && html`<${RateModal} desc=${rateModal.desc}
      onSubmit=${(r, c) => handleRate(rateModal.workId, r, c)}
      onCancel=${() => setRateModal(null)} />`}

    ${deliverModal && html`<${DeliverModal} desc=${deliverModal.desc}
      loading=${actionLoading === deliverModal.tc}
      onSubmit=${(result) => handleDeliver(deliverModal.tc, result)}
      onCancel=${() => setDeliverModal(null)} />`}
  `;
}

function RateModal({ desc, onSubmit, onCancel }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  return html`
    <${Modal} open=${true} onClose=${onCancel} title=${t('profile.work.rateTitle')}
      footer=${html`
        <button class="poster-action" onClick=${onCancel}>${t('profile.cancel')}</button>
        <button class="poster-slab poster-slab--control" onClick=${() => onSubmit(rating, comment)}>${t('profile.work.submitRating')}</button>`}>
      <p class="poster-hint mb-1">${t('profile.work.rateDesc')} ${escHtml(desc || '')}</p>
      <div class="op-stars mb-1">
        ${[1,2,3,4,5].map(i => html`
          <span class="op-star ${i <= rating ? 'on' : ''}" onClick=${() => setRating(i)}>\u2605</span>
        `)}
      </div>
      <div class="form-row"><label class="poster-label">${t('profile.work.commentLabel')}</label><textarea class="og-textarea" rows="2" value=${comment} onInput=${e => setComment(e.target.value)}></textarea></div>
    <//>`;
}

function DeliverModal({ desc, loading, onSubmit, onCancel }) {
  const [result, setResult] = useState('');
  return html`
    <${Modal} open=${true} onClose=${onCancel} title=${t('profile.work.deliver')}
      footer=${html`
        <button class="poster-action" disabled=${loading} onClick=${onCancel}>${t('profile.cancel')}</button>
        <button class="poster-slab poster-slab--control" disabled=${loading} onClick=${() => onSubmit(result || undefined)}>
          ${loading ? t('profile.work.delivering') : t('profile.work.deliver')}
        </button>`}>
      <p class="poster-hint mb-1">${t('profile.work.delivering')}: ${escHtml(desc || '')}</p>
      <div class="form-row">
        <label class="poster-label">${t('profile.work.commentLabel')}</label>
        <textarea class="og-textarea" rows="4" placeholder="Describe the completed work or attach results..."
          value=${result} onInput=${e => setResult(e.target.value)}></textarea>
      </div>
    <//>`;
}
