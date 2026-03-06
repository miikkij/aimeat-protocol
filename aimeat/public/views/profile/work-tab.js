import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, timeAgo } from '/js/utils.js';
import { Spinner } from './shared.js';
import { listInbox, listSent, submitRating } from '/js/services/work.js';

export default function WorkTab({ session, showToast, onStats }) {
  const [workInbox, setWorkInbox] = useState(null);
  const [workSent, setWorkSent] = useState(null);
  const [workSubTab, setWorkSubTab] = useState('inbox');
  const [rateModal, setRateModal] = useState(null);

  useEffect(() => {
    if (session) loadData();
  }, [session]);

  async function loadData() {
    try {
      const inbox = await listInbox();
      setWorkInbox(inbox);
      onStats?.({ work: inbox.length });
    } catch { setWorkInbox([]); }
    try {
      const sent = await listSent();
      setWorkSent(sent);
    } catch { setWorkSent([]); }
  }

  async function handleRate(workId, rating, comment) {
    if (!rating) { showToast(t('profile.work.selectRating'), true); return; }
    const resp = await submitRating(workId, rating, comment);
    if (resp.ok === false) { showToast(resp.error?.message || t('profile.error'), true); return; }
    showToast(t('profile.work.ratingSubmitted'));
    setRateModal(null);
    loadData();
  }

  function renderList(items, type) {
    if (!items) return html`<${Spinner} text=${t('profile.work.loading')} />`;
    if (items.length === 0) return html`<div class="empty">${t(type === 'sent' ? 'profile.work.sentEmpty' : 'profile.work.empty')}</div>`;
    return items.map(w => html`
      <div class="card">
        <div class="card-header">
          <div class="card-title">${escHtml(w.description || w.action_name || '-')}</div>
          <span class="badge ${w.status === 'completed' ? 'badge-success' : w.status === 'accepted' ? 'badge-info' : w.status === 'delivered' ? 'badge-warn' : 'badge-muted'}">${w.status || '-'}</span>
        </div>
        <div class="card-subtitle">
          ${type === 'sent' ? t('profile.work.provider') + ': ' + escHtml(w.provider_gaii || '-') : t('profile.work.from') + ': ' + escHtml(w.requester_gaii || '-')}
          ${w.price_morsels != null ? ' \u2502 ' + t('profile.work.cost') + ': ' + w.price_morsels + ' \u2764\uFE0F' : ''}
          ${w.created_at ? ' \u2502 ' + timeAgo(w.created_at) : ''}
        </div>
        ${type === 'sent' && w.status === 'delivered' && html`
          <button class="btn-sm" style="margin-top:.5rem" onClick=${() => setRateModal({ workId: w.id || w.work_id, desc: w.description || w.action_name })}>${t('profile.work.rateBtn')}</button>
        `}
      </div>
    `);
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
  `;
}

function RateModal({ desc, onSubmit, onCancel }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  return html`
    <div class="modal-overlay" onClick=${e => { if (e.target.className.includes('modal-overlay')) onCancel(); }}>
      <div class="modal">
        <h3>${t('profile.work.rateTitle')}</h3>
        <p style="color:var(--muted);margin-bottom:1rem">${t('profile.work.rateDesc')} ${escHtml(desc || '')}</p>
        <div class="star-rating" style="margin-bottom:1rem">
          ${[1,2,3,4,5].map(i => html`
            <span class="star ${i <= rating ? 'active' : ''}" onClick=${() => setRating(i)}>\u2605</span>
          `)}
        </div>
        <div class="form-row"><label>${t('profile.work.commentLabel')}</label><textarea class="input-field" rows="2" value=${comment} onInput=${e => setComment(e.target.value)}></textarea></div>
        <div class="form-actions">
          <button class="btn-primary" onClick=${() => onSubmit(rating, comment)}>${t('profile.work.submitRating')}</button>
          <button class="btn-outline" onClick=${onCancel}>${t('profile.cancel')}</button>
        </div>
      </div>
    </div>`;
}
