/**
 * @file work-tab.js
 * @description Profile tab for managing incoming and outgoing work requests.
 *   Displays inbox (received) and sent work items with accept/decline/deliver actions
 *   and a rating modal for completed deliveries.
 * @version-history
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
import { Spinner } from './shared.js';
import { listInbox, listSent, submitRating, acceptWork, rejectWork, deliverWork } from '/js/services/work.js';

export default function WorkTab({ session, showToast, onStats }) {
  const [workInbox, setWorkInbox] = useState(null);
  const [workSent, setWorkSent] = useState(null);
  const [workSubTab, setWorkSubTab] = useState('inbox');
  const [rateModal, setRateModal] = useState(null);
  const [deliverModal, setDeliverModal] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const inbox = await listInbox();
      setWorkInbox(inbox);
      onStats?.({ work: inbox.length });
    } catch { setWorkInbox([]); }
    try {
      const sent = await listSent();
      setWorkSent(sent);
    } catch { setWorkSent([]); }
  }, [onStats]);

  useEffect(() => {
    if (session) loadData();
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
      case 'completed': return 'badge-success';
      case 'accepted':
      case 'in_progress': return 'badge-info';
      case 'delivered': return 'badge-warn';
      case 'pending':
      case 'offered': return 'badge-muted';
      case 'rejected':
      case 'cancelled': return 'badge-danger';
      default: return 'badge-muted';
    }
  }

  function renderList(items, type) {
    if (!items) return html`<${Spinner} text=${t('profile.work.loading')} />`;
    if (items.length === 0) return html`<div class="empty">${t(type === 'sent' ? 'profile.work.sentEmpty' : 'profile.work.empty')}</div>`;
    return items.map(w => {
      const tc = w.tc || w.id || w.work_id;
      const isLoading = actionLoading === tc;
      const status = w.status || '-';
      const isPending = status === 'pending' || status === 'offered';
      const isActive = status === 'accepted' || status === 'in_progress';

      return html`
        <div class="card">
          <div class="card-header">
            <div class="card-title">${escHtml(w.description || w.action_name || '-')}</div>
            <span class="badge ${statusBadgeClass(status)}">${status}</span>
          </div>
          <div class="card-subtitle">
            ${type === 'sent' ? t('profile.work.provider') + ': ' + escHtml(w.provider_gaii || '-') : t('profile.work.from') + ': ' + escHtml(w.requester_gaii || '-')}
            ${w.price_morsels != null ? ' \u2502 ' + t('profile.work.cost') + ': ' + w.price_morsels + ' \u2764\uFE0F' : ''}
            ${w.created_at ? ' \u2502 ' + timeAgo(w.created_at) : ''}
          </div>

          ${type === 'inbox' && isPending && html`
            <div class="card-actions flex-row">
              <button class="btn-primary btn-sm" disabled=${isLoading} onClick=${() => handleAccept(tc)}>
                ${isLoading ? '...' : t('profile.work.accepted')}
              </button>
              <button class="btn-outline btn-sm" disabled=${isLoading} onClick=${() => handleReject(tc)}>
                ${isLoading ? '...' : t('profile.work.declined')}
              </button>
            </div>
          `}

          ${type === 'inbox' && isActive && html`
            <div class="card-actions flex-row">
              <button class="btn-primary btn-sm" disabled=${isLoading} onClick=${() => setDeliverModal({ tc, desc: w.description || w.action_name })}>
                ${t('profile.work.deliver')}
              </button>
            </div>
          `}

          ${type === 'sent' && w.status === 'delivered' && html`
            <button class="btn-sm mt-xs" onClick=${() => setRateModal({ workId: tc, desc: w.description || w.action_name })}>${t('profile.work.rateBtn')}</button>
          `}
        </div>
      `;
    });
  }

  return html`
    <div class="section-title">${t('profile.work.title')}</div>
    <div class="section-desc">${t('profile.work.desc')}</div>
    <div class="sub-tabs">
      <button class="sub-tab ${workSubTab === 'inbox' ? 'active' : ''}" onClick=${() => setWorkSubTab('inbox')}>${t('profile.work.inbox')}</button>
      <button class="sub-tab ${workSubTab === 'sent' ? 'active' : ''}" onClick=${() => setWorkSubTab('sent')}>${t('profile.work.sent')}</button>
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
    <${Modal} open=${true} onClose=${onCancel} title=${t('profile.work.rateTitle')}>
      <p class="text-meta mb-1">${t('profile.work.rateDesc')} ${escHtml(desc || '')}</p>
      <div class="star-rating mb-1">
        ${[1,2,3,4,5].map(i => html`
          <span class="star ${i <= rating ? 'active' : ''}" onClick=${() => setRating(i)}>\u2605</span>
        `)}
      </div>
      <div class="form-row"><label>${t('profile.work.commentLabel')}</label><textarea class="input-field" rows="2" value=${comment} onInput=${e => setComment(e.target.value)}></textarea></div>
      <div class="form-actions">
        <button class="btn-primary" onClick=${() => onSubmit(rating, comment)}>${t('profile.work.submitRating')}</button>
        <button class="btn-outline" onClick=${onCancel}>${t('profile.cancel')}</button>
      </div>
    <//>`;
}

function DeliverModal({ desc, loading, onSubmit, onCancel }) {
  const [result, setResult] = useState('');
  return html`
    <${Modal} open=${true} onClose=${onCancel} title=${t('profile.work.deliver')}>
      <p class="text-meta mb-1">${t('profile.work.delivering')}: ${escHtml(desc || '')}</p>
      <div class="form-row">
        <label>${t('profile.work.commentLabel')}</label>
        <textarea class="input-field" rows="4" placeholder="Describe the completed work or attach results..."
          value=${result} onInput=${e => setResult(e.target.value)}></textarea>
      </div>
      <div class="form-actions">
        <button class="btn-primary" disabled=${loading} onClick=${() => onSubmit(result || undefined)}>
          ${loading ? t('profile.work.delivering') : t('profile.work.deliver')}
        </button>
        <button class="btn-outline" disabled=${loading} onClick=${onCancel}>${t('profile.cancel')}</button>
      </div>
    <//>`;
}
