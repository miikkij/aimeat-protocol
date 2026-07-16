/**
 * @file feedback-tab.js
 * @description Admin dashboard "Platform feedback" tab — the operator inbox for the Node Feedback
 *   Channel: threads from users and agents (bugs, blockers, ideas, UX, questions) with status +
 *   category filters, a thread view showing the sender↔operator reply chain, a reply box (an
 *   operator reply auto-acks a new thread server-side), and a status-triage dropdown.
 * @structure FeedbackTab (default) — fetches GET /v1/admin/feedback, re-fetches on live updates;
 *   ThreadView — one selected thread with messages, reply box, status select.
 * @usage Registered in admin.js NAV_GROUPS (Data group).
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial: Node Feedback Channel v1.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { useToast, Toast } from './shared.js';
import * as api from '/js/services/admin.js';

const STATUSES = ['new', 'ack', 'in_progress', 'resolved', 'wont_fix'];
const CATEGORIES = ['bug', 'blocker', 'idea', 'ux', 'question', 'other'];
const STATUS_TONE = { new: 'adm-warn', ack: '', in_progress: '', resolved: 'adm-good', wont_fix: 'adm-muted' };
const CAT_TONE = { blocker: 'adm-bad', bug: 'adm-warn' };

const stLabel = (s) => t(`admin.feedback.st.${s}`) || s;
const catLabel = (c) => t(`admin.feedback.cat.${c}`) || c;

function relTime(iso) {
  try {
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return new Date(iso).toLocaleDateString();
  } catch { return ''; }
}

function ThreadView({ thread, onBack, onChanged, showErr, showOk }) {
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  async function sendReply() {
    if (!reply.trim() || busy) return;
    setBusy(true);
    try {
      const r = await api.replyFeedback(thread.id, reply.trim());
      if (r?.ok === false) throw new Error(r?.error?.message || 'Reply failed');
      setReply('');
      showOk(t('admin.feedback.replySent') || 'Reply sent');
      onChanged();
    } catch (e) { showErr(e?.message || 'Reply failed'); }
    setBusy(false);
  }

  async function setStatus(status) {
    try {
      const r = await api.setFeedbackStatus(thread.id, status);
      if (r?.ok === false) throw new Error(r?.error?.message || 'Update failed');
      showOk(t('admin.feedback.statusSaved') || 'Status updated');
      onChanged();
    } catch (e) { showErr(e?.message || 'Update failed'); }
  }

  return html`
    <div>
      <button class="btn-ghost" onClick=${onBack}>← ${t('admin.feedback.back') || 'Back to inbox'}</button>
      <div class="adm-fb-thread-head">
        <span class="adm-badge ${CAT_TONE[thread.category] || ''}">${catLabel(thread.category)}</span>
        <strong>${thread.title}</strong>
        <select class="adm-fb-status" value=${thread.status} onChange=${(e) => setStatus(e.target.value)}>
          ${STATUSES.map(s => html`<option value=${s} selected=${s === thread.status}>${stLabel(s)}</option>`)}
        </select>
      </div>
      <div class="adm-muted mono">${thread.sender} · ${relTime(thread.createdAt)}</div>
      <div class="adm-fb-msg adm-fb-msg-sender">${thread.body}</div>
      ${thread.context && Object.keys(thread.context).length > 0 && html`
        <div class="adm-fb-context mono">
          ${t('admin.feedback.context') || 'Context'}: ${Object.entries(thread.context).map(([k, v]) => `${k}=${v}`).join(' · ')}
        </div>`}
      ${(thread.messages || []).map((m, i) => html`
        <div key=${i} class="adm-fb-msg ${m.from === 'operator' ? 'adm-fb-msg-operator' : 'adm-fb-msg-sender'}">
          <div class="adm-muted">${m.from === 'operator' ? (t('admin.feedback.operator') || 'Operator') : (t('admin.feedback.sender') || 'Sender')} · ${relTime(m.at)}</div>
          ${m.body}
        </div>`)}
      <div class="adm-fb-replybox">
        <textarea rows="3" placeholder=${t('admin.feedback.replyPlaceholder') || 'Write a reply to the sender…'}
          value=${reply} onInput=${(e) => setReply(e.target.value)}></textarea>
        <button class="btn-primary" disabled=${busy || !reply.trim()} onClick=${sendReply}>
          ${t('admin.feedback.send') || 'Send reply'}
        </button>
      </div>
    </div>`;
}

export default function FeedbackTab() {
  const [threads, setThreads] = useState(null);
  const [err, setErr] = useState(null);
  const [status, setStatusFilter] = useState('');
  const [category, setCategoryFilter] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [toast, showErr, showOk, clearToast] = useToast();

  const load = useCallback(async () => {
    try {
      const r = await api.getFeedback({ status, category });
      setThreads(r?.data?.threads || []); setErr(null);
    } catch (e) { setErr(e?.message || 'Failed to load'); }
  }, [status, category]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => onLiveUpdate(['feedback'], () => load()), [load]);

  if (err) return html`<div class="adm-section"><div class="adm-error">${err}</div></div>`;
  if (!threads) return html`<div class="adm-section">${t('common.loading') || 'Loading…'}</div>`;

  const selected = selectedId ? threads.find(x => x.id === selectedId) : null;

  return html`
    <div class="adm-section">
      <div class="section-title">${t('admin.feedback.title') || 'Platform feedback'}</div>
      <div class="section-desc">${t('admin.feedback.desc') || 'Feedback threads from users and agents to the node operator.'}</div>
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

      ${selected
        ? html`<${ThreadView} thread=${selected} onBack=${() => setSelectedId(null)} onChanged=${load} showErr=${showErr} showOk=${showOk} />`
        : html`
          <div class="adm-fb-filters">
            <select value=${status} onChange=${(e) => setStatusFilter(e.target.value)}>
              <option value="">${t('admin.feedback.allStatuses') || 'All statuses'}</option>
              ${STATUSES.map(s => html`<option value=${s}>${stLabel(s)}</option>`)}
            </select>
            <select value=${category} onChange=${(e) => setCategoryFilter(e.target.value)}>
              <option value="">${t('admin.feedback.allCategories') || 'All categories'}</option>
              ${CATEGORIES.map(c => html`<option value=${c}>${catLabel(c)}</option>`)}
            </select>
          </div>
          ${threads.length === 0
            ? html`<div class="adm-muted">${t('admin.feedback.empty') || 'No feedback threads yet.'}</div>`
            : html`<table class="data-table">
                <thead><tr>
                  <th>${t('admin.feedback.when') || 'When'}</th>
                  <th>${t('admin.feedback.category') || 'Category'}</th>
                  <th>${t('admin.feedback.titleCol') || 'Title'}</th>
                  <th>${t('admin.feedback.from') || 'From'}</th>
                  <th>${t('admin.feedback.statusCol') || 'Status'}</th>
                  <th>${t('admin.feedback.messagesCol') || 'Messages'}</th>
                </tr></thead>
                <tbody>
                  ${threads.map(x => html`<tr key=${x.id} class="adm-fb-row" onClick=${() => setSelectedId(x.id)}>
                    <td>${relTime(x.createdAt)}</td>
                    <td class=${CAT_TONE[x.category] || ''}>${catLabel(x.category)}</td>
                    <td>${x.title}</td>
                    <td class="mono">${x.sender}</td>
                    <td class=${STATUS_TONE[x.status] || ''}>${stLabel(x.status)}</td>
                    <td>${(x.messages || []).length}</td>
                  </tr>`)}
                </tbody>
              </table>`}`}
    </div>`;
}
