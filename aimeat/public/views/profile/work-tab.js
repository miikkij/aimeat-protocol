/**
 * @file work-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab for managing incoming and outgoing work requests.
 *   Displays inbox (received) and sent work items with accept/decline/deliver actions
 *   and a rating modal for completed deliveries.
 * @version-history
 *   2026-09-22 -- Composed from the shared component set (Page, tab Actions, ListRow, Chip, Dialog,
 *     Field); no own classes. A work item is a list row with its status as a chip; the cost says
 *     "n morsels" instead of a heart emoji, and the rating is five numbered choices, not star glyphs.
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
import { Page, Stack, ListRow, Chip, Action, Dialog, Field, Surface, Text } from '/components/poster-parts.js';
import { escHtml, timeAgo } from '/js/utils.js';
import { Spinner } from './shared.js';
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

  /** A work status as a chip tone: done, waiting on you, refused, or neither. */
  function statusTone(status) {
    switch (status) {
      case 'completed': return 'success';
      case 'accepted':
      case 'in_progress': return 'plain';
      case 'delivered': return 'sun';
      case 'rejected':
      case 'cancelled': return 'danger';
      default: return 'muted';
    }
  }

  function renderList(items, type) {
    if (!items) return html`<${Spinner} text=${t('profile.work.loading')} />`;
    if (items.length === 0) return html`<${Surface} kind="aside"><${Text} tone="muted">${t(type === 'sent' ? 'profile.work.sentEmpty' : 'profile.work.empty')}<//><//>`;
    return html`<${Stack} density="compact">${items.map(w => {
      const tc = w.tc || w.id || w.work_id;
      const isLoading = actionLoading === tc;
      const status = w.status || '-';
      const isPending = status === 'pending' || status === 'offered';
      const isActive = status === 'accepted' || status === 'in_progress';
      const detail = [
        type === 'sent' ? t('profile.work.provider') + ': ' + escHtml(w.provider_gaii || '-') : t('profile.work.from') + ': ' + escHtml(w.requester_gaii || '-'),
        w.price_morsels != null ? t('profile.work.cost') + ': ' + t('walpage.morselMany', { n: w.price_morsels }) : '',
        w.created_at ? timeAgo(w.created_at) : '',
      ].filter(Boolean).join(' \u00B7 ');

      return html`<${ListRow} key=${tc} name=${escHtml(w.description || w.action_name || '-')} detail=${detail}
        value=${html`<${Chip} tone=${statusTone(status)}>${status}<//>`}
        actions=${type === 'inbox' && isPending ? html`
            <${Action} kind="text" tone="success" disabled=${isLoading} onClick=${() => handleAccept(tc)}>${isLoading ? '...' : t('profile.work.accepted')}<//>
            <${Action} kind="text" tone="danger" disabled=${isLoading} onClick=${() => handleReject(tc)}>${isLoading ? '...' : t('profile.work.declined')}<//>`
          : type === 'inbox' && isActive ? html`
            <${Action} disabled=${isLoading} onClick=${() => setDeliverModal({ tc, desc: w.description || w.action_name })}>${t('profile.work.deliver')}<//>`
          : type === 'sent' && w.status === 'delivered' ? html`
            <${Action} onClick=${() => setRateModal({ workId: tc, desc: w.description || w.action_name })}>${t('profile.work.rateBtn')}<//>`
          : null} />`;
    })}<//>`;
  }

  return html`<${Page} width="wide" title=${t('profile.work.title')}
    crumbs=${[{ label: t('nav.profile') }, { label: t('profile.landing.menuBuildShare') }, { label: t('profile.tabs.work') }]}>
    <${Stack}>
      <${Text} kind="lead">${t('profile.work.desc')}<//>
      <${Stack} direction="wrap" density="compact" role="tablist" label=${t('profile.work.title')}>
        <${Action} kind="tab" semantics="tab" selected=${workSubTab === 'inbox'} onClick=${() => setWorkSubTab('inbox')}>${t('profile.work.inbox')}<//>
        <${Action} kind="tab" semantics="tab" selected=${workSubTab === 'sent'} onClick=${() => setWorkSubTab('sent')}>${t('profile.work.sent')}<//>
      <//>
      ${workSubTab === 'inbox' ? renderList(workInbox, 'inbox') : renderList(workSent, 'sent')}
    <//>

    ${rateModal && html`<${RateModal} desc=${rateModal.desc}
      onSubmit=${(r, c) => handleRate(rateModal.workId, r, c)}
      onCancel=${() => setRateModal(null)} />`}

    ${deliverModal && html`<${DeliverModal} desc=${deliverModal.desc}
      loading=${actionLoading === deliverModal.tc}
      onSubmit=${(result) => handleDeliver(deliverModal.tc, result)}
      onCancel=${() => setDeliverModal(null)} />`}
  <//>`;
}

function RateModal({ desc, onSubmit, onCancel }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  // The rating is one of five: a radio group of the numbers, the chosen one and those under it on.
  return html`
    <${Dialog} open=${true} onClose=${onCancel} title=${t('profile.work.rateTitle')}
      actions=${html`
        <${Action} onClick=${onCancel}>${t('profile.cancel')}<//>
        <${Action} kind="primary" onClick=${() => onSubmit(rating, comment)}>${t('profile.work.submitRating')}<//>`}>
      <${Stack}>
        <${Text} tone="muted">${t('profile.work.rateDesc')} ${escHtml(desc || '')}<//>
        <${Stack} direction="horizontal" density="compact" role="radiogroup" label=${t('profile.work.rateTitle')}>
          ${[1, 2, 3, 4, 5].map(i => html`<${Action} key=${i} kind="tab" semantics="radio" selected=${i <= rating}
            label=${i + '/5'} onClick=${() => setRating(i)}>${i}<//>`)}
        <//>
        <${Field} type="textarea" rows="2" label=${t('profile.work.commentLabel')} value=${comment} onInput=${e => setComment(e.target.value)} />
      <//>
    <//>`;
}

function DeliverModal({ desc, loading, onSubmit, onCancel }) {
  const [result, setResult] = useState('');
  return html`
    <${Dialog} open=${true} onClose=${onCancel} title=${t('profile.work.deliver')}
      actions=${html`
        <${Action} disabled=${loading} onClick=${onCancel}>${t('profile.cancel')}<//>
        <${Action} kind="primary" disabled=${loading} onClick=${() => onSubmit(result || undefined)}>
          ${loading ? t('profile.work.delivering') : t('profile.work.deliver')}
        <//>`}>
      <${Stack}>
        <${Text} tone="muted">${t('profile.work.delivering')}: ${escHtml(desc || '')}<//>
        <${Field} type="textarea" rows="4" label=${t('profile.work.commentLabel')} placeholder="Describe the completed work or attach results..."
          value=${result} onInput=${e => setResult(e.target.value)} />
      <//>
    <//>`;
}
