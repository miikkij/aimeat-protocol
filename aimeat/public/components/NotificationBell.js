/**
 * @file NotificationBell.js
 * @description Header notification bell — shows the unread count and a dropdown of the user's
 *   in-app notifications (GET /v1/notifications). Opening the dropdown marks them read. Refreshes on
 *   the SSE `aimeat-live-update` event and a 45s poll, so a workspace-access approval (or request)
 *   surfaces without the user having to guess. Reads the JWT from the session service.
 *   Exports openNotificationLink() — the ONE translation from a notification link/URL into SPA
 *   navigation, shared by the bell dropdown and the service-worker push-click handler (spa.html).
 * @structure
 *   - openNotificationLink(link, onNavigate) — deep-link a bell/push notification target
 *   - NotificationBell({ t, onNavigate }) — t = i18n fn, onNavigate(path) = SPA navigate.
 * @usage import { NotificationBell } from '/components/NotificationBell.js';  html`<${NotificationBell} t=${t} onNavigate=${navigate} />`
 * @version-history
 *   v1.0.0 — 2026-06-08 — Initial: header bell + dropdown + mark-read for the notification inbox.
 *   v1.0.1 — 2026-06-19 — JSDoc type annotations for frontend type-checking
 *   v1.1.0 — 2026-07-02 — Extract openNotificationLink() so push-notification clicks reuse the
 *     same deep-link translation as bell clicks (supports both '#hash' and '?tab=' forms).
 *   v1.2.0 — 2026-07-18 — Inline notification actions: reply box (POST /v1/messages) + api buttons
 *     (approve/deny/accept/decline/reject) that call the action endpoint with the owner's session.
 *   v1.3.0 — 2026-07-19 — "Clear all" in the dropdown head (DELETE /v1/notifications) — deletes every
 *     notification for the owner (not just mark-read), optimistic empty + reconcile.
 *   v1.3.1 — 2026-08-07 — Reads the JWT via /js/services/auth.js (single session source).
 *   v1.4.0 — 2026-08-16 — The unread count also lands on the installed app's icon (Badging API):
 *     set wherever this component learns the count, cleared when it reaches zero. The service
 *     worker's push handler sets a plain dot; this is what turns it into the exact number.
 */
import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
import { swallowed } from '/js/swallowed.js';
import { getJwt } from '/js/services/auth.js';
const html = htm.bind(h);

async function api(path, opts = {}) {
  const token = getJwt();
  if (!token) return null;
  try {
    const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
    return await res.json();
  } catch (err) { swallowed('NotificationBell: api', err); return null; }
}

/**
 * Mirror the unread count onto the installed app's icon. A no-op in a plain tab (the API only
 * exists for installed apps on supporting browsers); in the app it is the quiet end of the
 * notification chain — visible after the notification itself was swiped away.
 */
function syncAppBadge(count) {
  if (!('setAppBadge' in navigator)) return;
  const call = count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge();
  call.catch((err) => swallowed('NotificationBell: app badge', err));
}

function relTime(iso) {
  try {
    const d = new Date(iso), now = new Date(), s = Math.round((+now - +d) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return d.toLocaleDateString();
  } catch (err) { swallowed('NotificationBell: relTime', err); return ''; }
}

// Action id → i18n key (falls back to the server-provided English label) and → button class.
const ACTION_I18N = {
  reply: 'notif.action.reply', approve: 'notif.action.approve', deny: 'notif.action.deny',
  accept: 'notif.action.accept', decline: 'notif.action.decline', reject: 'notif.action.reject',
};
const BTN_CLASS = { primary: 'btn-primary', danger: 'btn-danger', default: 'btn-outline' };

/**
 * Deep-link a notification target into the SPA. Handles both notification link vocabularies:
 * the bell's hash form ('/v1/profile#organisms', '/v1/profile#inbox/<conversationId>') and the
 * push URL form ('/v1/profile?tab=messages#inbox/<id>'). Profile targets switch tabs in place:
 * prime sessionStorage so a cold profile mount opens the tab, navigate, then dispatch
 * aimeat-open-tab so an already-mounted profile reacts too. Anything else just navigates.
 * @param {string} link
 * @param {(path: string) => void} [onNavigate]
 */
export function openNotificationLink(link, onNavigate) {
  if (!link) return;
  let url;
  try { url = new URL(link, window.location.origin); } catch { return; }
  if (url.origin === window.location.origin && url.pathname === '/v1/profile') {
    const hashMatch = /^#([a-z]+)(?:\/(.+))?$/i.exec(url.hash || '');
    const rawTab = url.searchParams.get('tab') || (hashMatch ? hashMatch[1] : '');
    if (rawTab) {
      const tabId = rawTab.toLowerCase() === 'inbox' ? 'messages' : rawTab;
      const rest = hashMatch ? (hashMatch[2] || '') : '';
      try {
        sessionStorage.setItem('aimeat-profile-tab', JSON.stringify({ tabId, slot: 'main' }));
        if (tabId === 'messages' && rest) sessionStorage.setItem('aimeat.inbox.open', rest);
      // eslint-disable-next-line aimeat/no-silent-catch -- noop
      } catch { /* noop */ }
      if (onNavigate) onNavigate('/v1/profile');
      setTimeout(() => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } })), 60);
      return;
    }
  }
  // App pages ('/v1/apps/<owner>/<file>') and other non-SPA documents are served by the
  // backend (and may 301 to the isolated app origin) — a hard navigation, not SPA routing.
  if (/^\/v1\/apps\//.test(url.pathname) || /\.html$/i.test(url.pathname)) {
    window.location.assign(url.pathname + url.search + url.hash);
    return;
  }
  if (onNavigate) onNavigate(url.pathname + url.search + url.hash);
}

export function NotificationBell({ t, onNavigate }) {
  const tr = (k, fb) => (t && k ? t(k) : null) || fb;
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [replyFor, setReplyFor] = useState(null);   // notif id whose reply box is open
  const [replyText, setReplyText] = useState('');
  const [busyKey, setBusyKey] = useState(null);      // `${notifId}:${actionId}` in flight
  const [results, setResults] = useState({});        // notifId → { ok, msg }
  const ref = useRef(null);

  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    const r = await api('/v1/notifications');
    if (r && r.data) {
      setItems(r.data.notifications || []);
      setUnread(r.data.unread || 0);
      syncAppBadge(r.data.unread || 0);
    }
  }, []);

  // "Clear all" — delete every notification for the owner (not just mark read). Optimistic: empty the
  // list + zero the badge immediately, then reconcile from the server response.
  const clearAll = useCallback(async () => {
    setClearing(true);
    setItems([]); setUnread(0); setReplyFor(null); setResults({});
    syncAppBadge(0);
    await api('/v1/notifications', { method: 'DELETE', body: JSON.stringify({}) });
    setClearing(false);
    load();
  }, [load]);

  useEffect(() => {
    load();
    return onLiveUpdate(['agent-messages', 'agent-tasks', 'notifications', 'workspace-access'], () => load());
  }, [load]);

  // Close the dropdown on an outside click.
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next) { setReplyFor(null); setReplyText(''); }
    if (next && unread > 0) {
      setUnread(0);
      syncAppBadge(0);
      setItems(its => its.map(n => ({ ...n, read: true })));
      await api('/v1/notifications/read', { method: 'POST', body: JSON.stringify({ all: true }) });
    }
  };
  const clickNotif = (n) => {
    setOpen(false);
    openNotificationLink(n.link, onNavigate);
  };

  const actionLabel = (a) => tr(ACTION_I18N[a.id], a.label || a.id);

  // 'api' action (approve/deny/accept/decline/reject): call the endpoint with the owner's session.
  const runApi = async (n, a) => {
    if (a.confirm && !window.confirm(tr('notif.action.confirm', 'Are you sure?'))) return;
    setBusyKey(`${n.id}:${a.id}`);
    const r = await api(a.endpoint, { method: a.method || 'POST', body: a.body ? JSON.stringify(a.body) : undefined });
    setBusyKey(null);
    const ok = !!(r && r.ok);
    setResults(s => ({ ...s, [n.id]: { ok, msg: ok ? actionLabel(a) : (r && r.error && r.error.message) || tr('notif.action.failed', 'Action failed') } }));
    load();
  };

  // 'reply' action: send the typed text as a DM back to the sender, then close the box.
  const sendReply = async (n, a) => {
    const text = replyText.trim();
    if (!text) return;
    setBusyKey(`${n.id}:reply`);
    const r = await api('/v1/messages', { method: 'POST', body: JSON.stringify({
      to: a.to, body: text, conversation_id: a.conversationId, reply_to: a.replyTo, subject: a.subject,
    }) });
    setBusyKey(null);
    const ok = !!(r && r.ok);
    if (ok) { setReplyFor(null); setReplyText(''); }
    setResults(s => ({ ...s, [n.id]: { ok, msg: ok ? tr('notif.action.sent', 'Reply sent') : (r && r.error && r.error.message) || tr('notif.action.failed', 'Action failed') } }));
    load();
  };

  const openReply = (n, a) => {
    setReplyFor(cur => (cur === n.id ? null : n.id));
    setReplyText('');
    setResults(s => ({ ...s, [n.id]: undefined }));
    // Stash so an "AI draft" jump lands in the right thread.
    if (a.conversationId) { try { sessionStorage.setItem('aimeat.inbox.open', a.conversationId); } catch { /* noop */ } }   // eslint-disable-line aimeat/no-silent-catch -- noop
  };

  const renderAction = (n, a) => {
    const key = `${n.id}:${a.id}`;
    const busy = busyKey === key;
    const cls = BTN_CLASS[a.style] || 'btn-outline';
    if (a.kind === 'reply') {
      return html`<button class="notif-action-btn ${cls}" key=${a.id} disabled=${busy} onClick=${(e) => { e.stopPropagation(); openReply(n, a); }}>${actionLabel(a)}</button>`;
    }
    if (a.kind === 'navigate') {
      return html`<button class="notif-action-btn ${cls}" key=${a.id} onClick=${(e) => { e.stopPropagation(); setOpen(false); openNotificationLink(a.link, onNavigate); }}>${actionLabel(a)}</button>`;
    }
    return html`<button class="notif-action-btn ${cls}" key=${a.id} disabled=${busy} onClick=${(e) => { e.stopPropagation(); runApi(n, a); }}>${busy ? '…' : actionLabel(a)}</button>`;
  };

  const renderItem = (n) => {
    const actions = Array.isArray(n.actions) ? n.actions : [];
    const res = results[n.id];
    const replyAction = actions.find(a => a.kind === 'reply');
    return html`
      <div class="notif-item ${n.read ? '' : 'unread'}" key=${n.id}>
        <button class="notif-item-main" onClick=${() => clickNotif(n)}>
          <div class="notif-item-title">${n.title}</div>
          ${n.body ? html`<div class="notif-item-body">${n.body}</div>` : null}
          <div class="notif-item-time">${relTime(n.createdAt)}</div>
        </button>
        ${actions.length ? html`<div class="notif-actions">${actions.map(a => renderAction(n, a))}</div>` : null}
        ${replyFor === n.id && replyAction ? html`
          <div class="notif-reply">
            <textarea class="notif-reply-input" rows="2" placeholder=${tr('notif.action.replyPlaceholder', 'Write a reply…')}
              value=${replyText} onInput=${(e) => setReplyText(e.target.value)}></textarea>
            <div class="notif-reply-row">
              <button class="notif-action-btn btn-primary" disabled=${busyKey === `${n.id}:reply` || !replyText.trim()} onClick=${() => sendReply(n, replyAction)}>
                ${busyKey === `${n.id}:reply` ? '…' : tr('notif.action.send', 'Send')}</button>
              <button class="notif-action-btn btn-ghost" onClick=${() => { setOpen(false); openNotificationLink(n.link, onNavigate); }}>${tr('notif.action.aiDraft', 'Reply with AI')}</button>
              <button class="notif-action-btn btn-ghost" onClick=${() => { setReplyFor(null); setReplyText(''); }}>${tr('common.cancel', 'Cancel')}</button>
            </div>
          </div>` : null}
        ${res ? html`<div class="notif-result ${res.ok ? 'ok' : 'err'}">${res.ok ? '✓ ' : '⚠ '}${res.msg}</div>` : null}
      </div>`;
  };

  return html`
    <div class="notif-bell" ref=${ref}>
      <button class="notif-bell-btn" aria-label=${tr('notif.title', 'Notifications')} title=${tr('notif.title', 'Notifications')} onClick=${toggle}>
        ${'🔔'}${unread > 0 ? html`<span class="notif-badge">${unread > 99 ? '99+' : unread}</span>` : null}
      </button>
      ${open ? html`
        <div class="notif-dropdown">
          <div class="notif-dropdown-head">
            <span>${tr('notif.title', 'Notifications')}</span>
            ${items.length > 0 ? html`<button class="notif-clear-all" disabled=${clearing} onClick=${(e) => { e.stopPropagation(); clearAll(); }}>${clearing ? '…' : tr('notif.clearAll', 'Clear all')}</button>` : null}
          </div>
          ${items.length === 0
            ? html`<div class="notif-empty">${tr('notif.empty', 'No notifications yet')}</div>`
            : items.map(n => renderItem(n))}
        </div>` : null}
    </div>`;
}
