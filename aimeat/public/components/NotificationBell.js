/**
 * @file NotificationBell.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   v1.13.1 — 2026-11-27 — The bell button draws the bell Glyph instead of the emoji; a failed
 *     action's result line starts with ✗ instead of the warning emoji.
 *   v1.13.0 — 2026-11-10 — A notice's text can be selected and copied: the notice is no longer one
 *     button (a browser selects no text inside a button); its title is the button, and a press on the
 *     text opens the link unless text was being selected. A notice without a link does nothing and
 *     keeps the list open. A link to one agent opens that agent also when the Agents page is already
 *     open (openItem); before, the press reloaded the page the person was on and nothing changed
 *     (wish-ilmoitus-vie-jonnekin-ja-sen-tekstin-voi-kopioida). A link to a Settings & Controls page
 *     keeps what it names (?agent=, ?open=, ?org=&ws=, ?package=, #agreements/<id>), which the bell
 *     used to cut off (openProfileLink); a page already open that reads its item only on mount is
 *     loaded again. A Design Book preview is a full load, and so is an admin link from the admin page.
 *   v1.12.0 — 2026-10-31 — A link on another origin (an extension's notice that leads into its app,
 *     `https://<app>.apps.<apex>/…`) is opened as that address. It was cut to its path, so the SPA
 *     routed `/?…` and the click landed on the home page (Jouni, 2026-10-31).
 *   v1.11.0 — 2026-10-31 — The bell's name shows in the shared Tooltip instead of the browser's title
 *     text, and stays hidden while the list is open (Jouni, 2026-10-31).
 *   v1.10.0 — 2026-10-27 — A notice whose kind has an explanation shows a question mark under it that
 *     opens the explanation (helpTermOf; Jouni, 2026-10-27).
 *   v1.9.0 — 2026-10-25 — A decided notice shows who decided what and when, and where to change it,
 *     and no buttons; a button that answered marks its notice answered (secaudit2026oct22).
 *   v1.8.0 — 2026-09-26 — A link that names an agent (?tab=agents&agent=<name>) opens that agent's
 *     row.
 *   v1.7.0 — 2026-09-26 — A button that carries its own words (`i18n`) is said in the reader's
 *     language (actionTextOf), such as "Allow reading" with the app's name.
 *   v1.6.0 — 2026-09-25 — An api button runs only when it calls a door of this node's own API
 *     (isRunnableActionEndpoint); any other says why it was not used, and nothing is sent.
 *   v1.1.0 — 2026-09-24 — A notification's actions are the shared menu row, in a column; the action's
 *     style no longer picks a coral or framed button (Jouni's decision "Menu row").
 *   v1.0.0 — 2026-06-08 — Initial: header bell + dropdown + mark-read for the notification inbox.
 *   v1.0.1 — 2026-06-19 — JSDoc type annotations for frontend type-checking
 *   v1.1.0 — 2026-07-02 — Extract openNotificationLink() so push-notification clicks reuse the
 *     same deep-link translation as bell clicks (supports both '#hash' and '?tab=' forms).
 *   v1.2.0 — 2026-07-18 — Inline notification actions: reply box (POST /v1/messages) + api buttons
 *     (approve/deny/accept/decline/reject) that call the action endpoint with the owner's session.
 *   v1.3.0 — 2026-07-19 — "Clear all" in the dropdown head (DELETE /v1/notifications) — deletes every
 *     notification for the owner (not just mark-read), optimistic empty + reconcile.
 *   v1.3.1 — 2026-08-07 — Reads the JWT via /js/services/auth.js (single session source).
 *   v1.5.0 — 2026-08-30 — Each item says who sent it, and a title or body the record knows how to
 *     say in the reader's language (an i18n key) is said that way (js/services/notifications.js).
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
import { titleOf, bodyOf, sourceName, isRunnableActionEndpoint, actionTextOf, markAnswered, alreadyDecided, answerTextOf, answerChangeOf, helpTermOf } from '/js/services/notifications.js';
import { HelpTip } from '/components/HelpTip.js';
import { Tooltip } from '/components/Tooltip.js';
import { Glyph } from '/components/Action.js';
import { ago } from '/js/format.js';
import { openItem } from '/js/open-item.js';
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

/**
 * How long ago a notification arrived, giving way to the date after a day.
 *
 * The three branches above the date used to be `'just now'`, `` `${n}m ago` `` and `` `${n}h ago` ``
 * — English written into the bell, so a Finnish reader got it too. `ago()` asks CLDR, which also
 * knows to say "juuri nyt" and "eilen" where a hand-built branch could only count.
 */
function relTime(iso) {
  return ago(iso, { horizonDays: 1 });
}

// Action id → i18n key (falls back to the server-provided English label).
const ACTION_I18N = {
  reply: 'notif.action.reply', approve: 'notif.action.approve', deny: 'notif.action.deny',
  accept: 'notif.action.accept', decline: 'notif.action.decline', reject: 'notif.action.reject',
};

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
  // Another origin is a page of its own, never an SPA route: an extension's notice leads into its
  // app on the app's origin (services/extension-notify.ts safeNotificationLink, which is also what
  // limits such a link to this node's own app origins). Only http(s), so no other scheme runs.
  if (url.origin !== window.location.origin) {
    if (url.protocol === 'https:' || url.protocol === 'http:') window.location.assign(url.href);
    return;
  }
  if (url.pathname === '/v1/profile') {
    const hashMatch = /^#([a-z]+)(?:\/(.+))?$/i.exec(url.hash || '');
    const rawTab = url.searchParams.get('tab') || (hashMatch ? hashMatch[1] : '');
    if (rawTab) { openProfileLink(url, rawTab, hashMatch, onNavigate); return; }
  }
  // Pages the server draws, not SPA routes: app pages ('/v1/apps/<owner>/<file>', which may 301 to
  // the app's own origin), an .html document and a Design Book part's preview. A hard navigation;
  // the SPA would show its front page for them.
  if (/^\/v1\/apps\//.test(url.pathname) || /^\/v1\/designbook\//.test(url.pathname) || /\.html$/i.test(url.pathname)) {
    window.location.assign(url.pathname + url.search + url.hash);
    return;
  }
  // The admin page reads its ?tab= only when it loads, so from the admin page itself a link to one of
  // its tabs loads the page again; from anywhere else the SPA navigation loads it anyway.
  if (/^\/v1\/admin(\/|$)/.test(url.pathname) && /^\/v1\/admin(\/|$)/.test(window.location.pathname)) {
    window.location.assign(url.pathname + url.search + url.hash);
    return;
  }
  if (onNavigate) onNavigate(url.pathname + url.search + url.hash);
}

/** The pages that take one item while they are open (useOpenItem in js/open-item.js). */
const OPEN_ITEM_TABS = new Set(['agents', 'companies', 'contacts', 'extensions', 'goals', 'scheduler', 'skills', 'workflows']);

/**
 * A link to a Settings & Controls page, with what it names on that page kept whole: the item in the
 * query (?agent=, ?open=, ?org=&ws=, ?package=, ?product=) and the fragment (#agreements/<id>). The
 * page reads them when it mounts, and a page that is already open hears openItem (agents, and every
 * page that takes ?open=). A page already open that reads its item only when it mounts is loaded
 * again, because otherwise the press changes nothing on the screen.
 * @param {URL} url @param {string} rawTab @param {RegExpExecArray|null} hashMatch
 * @param {(path: string) => void} [onNavigate]
 */
function openProfileLink(url, rawTab, hashMatch, onNavigate) {
  const tabId = rawTab.toLowerCase() === 'inbox' ? 'messages' : rawTab;
  const rest = hashMatch ? (hashMatch[2] || '') : '';
  const q = new URLSearchParams(url.search);
  q.set('tab', tabId);
  // The hash form ('#organisms', '#inbox/<id>') names the tab, not a fragment the page reads; a
  // conversation goes to the inbox through sessionStorage below.
  const hash = url.searchParams.get('tab') && tabId !== 'messages' ? url.hash : '';
  const target = `/v1/profile?${q.toString()}${hash}`;
  const item = tabId === 'agents' && q.get('agent') ? q.get('agent') : (OPEN_ITEM_TABS.has(tabId) ? q.get('open') : null);
  const names = [...q.keys()].some((k) => k !== 'tab') || !!hash;
  const here = new URLSearchParams(window.location.search);
  const onProfile = window.location.pathname === '/v1/profile';
  const sameTab = onProfile && here.get('tab') === tabId;
  try {
    sessionStorage.setItem('aimeat-profile-tab', JSON.stringify({ tabId, slot: 'main' }));
    if (tabId === 'messages' && rest) sessionStorage.setItem('aimeat.inbox.open', rest);
  // eslint-disable-next-line aimeat/no-silent-catch -- noop
  } catch { /* noop */ }
  if (sameTab) {
    // The page is open: an item it takes while open goes there, the inbox hears aimeat-open-tab, and
    // a page that reads its item only on mount is loaded again with the link.
    if (item) openItem(tabId, item);
    else if (tabId === 'messages') window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));
    else if (names) window.location.assign(target);
    return;
  }
  if (onProfile) {
    // Another tab of the profile: the address takes the link, then the tab opens and reads it on mount
    // (landing-page.helpers.js openTabAt does the same for a link inside the profile).
    history.pushState({ aimeatTab: tabId }, '', target);
    window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));
  } else if (onNavigate) {
    onNavigate(target);
    setTimeout(() => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } })), 60);
  }
  if (item) setTimeout(() => openItem(tabId, item), 60);
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
  // A notice without a link stays where it is, and the list stays open: closing it looked like a
  // press that went somewhere and landed nowhere.
  const clickNotif = (n) => {
    if (!n.link) return;
    setOpen(false);
    openNotificationLink(n.link, onNavigate);
  };
  // A press on the notice's text opens its link, unless the person was selecting text to copy: the
  // text is not inside a button, because a browser lets no one select text inside a button.
  const clickNotifText = (n) => {
    const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
    if (sel && !sel.isCollapsed && sel.toString().trim()) return;
    clickNotif(n);
  };

  const actionLabel = (a) => actionTextOf(a) || tr(ACTION_I18N[a.id], a.label || a.id);

  // 'api' action (approve/deny/accept/decline/reject): call the endpoint with the owner's session.
  // Every button that is not a reply or a link lands here, so the endpoint is judged here: only a door
  // of this node's own API runs with the session (isRunnableActionEndpoint, the page's half of the rule).
  const runApi = async (n, a) => {
    if (!isRunnableActionEndpoint(a.endpoint)) {
      setResults(s => ({ ...s, [n.id]: { ok: false, msg: tr('notif.action.refused', 'The button was not used, because it does not belong to this service.') } }));
      return;
    }
    if (a.confirm && !window.confirm(tr('notif.action.confirm', 'Are you sure?'))) return;
    setBusyKey(`${n.id}:${a.id}`);
    const r = await api(a.endpoint, { method: a.method || 'POST', body: a.body ? JSON.stringify(a.body) : undefined });
    const ok = !!(r && r.ok);
    // A decided question shows its answer and no button again, also when it was decided before.
    if (ok || alreadyDecided(r)) await markAnswered(n, a, !ok);
    setBusyKey(null);
    setResults(s => ({ ...s, [n.id]: ok || alreadyDecided(r) ? undefined : { ok, msg: (r && r.error && r.error.message) || tr('notif.action.failed', 'Action failed') } }));
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
    // Every action is the shared menu row, whatever its style asks for (Jouni's decision "Menu row":
    // "Approve" loses its coral, so every action reads the same).
    const cls = 'poster-menu-row';
    if (a.kind === 'reply') {
      return html`<button class="notif-action-btn ${cls}" key=${a.id} disabled=${busy} onClick=${(e) => { e.stopPropagation(); openReply(n, a); }}>${actionLabel(a)}</button>`;
    }
    if (a.kind === 'navigate') {
      return html`<button class="notif-action-btn ${cls}" key=${a.id} onClick=${(e) => { e.stopPropagation(); setOpen(false); openNotificationLink(a.link, onNavigate); }}>${actionLabel(a)}</button>`;
    }
    return html`<button class="notif-action-btn ${cls}" key=${a.id} disabled=${busy} onClick=${(e) => { e.stopPropagation(); runApi(n, a); }}>${busy ? '…' : actionLabel(a)}</button>`;
  };

  const renderItem = (n) => {
    const decided = answerTextOf(n);
    const change = decided ? answerChangeOf(n) : null;
    const actions = decided ? [] : (Array.isArray(n.actions) ? n.actions : []);
    const res = results[n.id];
    const replyAction = actions.find(a => a.kind === 'reply');
    // The question mark stands outside the item's button: a button inside a button is not a control.
    const help = helpTermOf(n);
    return html`
      <div class="notif-item ${n.read ? '' : 'unread'}" key=${n.id}>
        <div class="notif-item-main ${n.link ? 'notif-item-main--link' : ''}" onClick=${() => clickNotifText(n)}>
          ${n.link
            ? html`<button type="button" class="notif-item-title" onClick=${(e) => { e.stopPropagation(); clickNotif(n); }}>${titleOf(n)}</button>`
            : html`<div class="notif-item-title">${titleOf(n)}</div>`}
          ${bodyOf(n) ? html`<div class="notif-item-body">${bodyOf(n)}</div>` : null}
          <div class="notif-item-time">${sourceName(n)} · ${relTime(n.createdAt)}</div>
        </div>
        ${help ? html`<div class="notif-actions"><${HelpTip} term=${help} label=${titleOf(n)} /></div>` : null}
        ${decided ? html`<div class="notif-result ok">${decided}</div>` : null}
        ${change ? html`<div class="notif-actions"><button class="notif-action-btn poster-menu-row" onClick=${(e) => { e.stopPropagation(); setOpen(false); openNotificationLink(change.link, onNavigate); }}>${change.label}</button></div>` : null}
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
        ${res ? html`<div class="notif-result ${res.ok ? 'ok' : 'err'}">${res.ok ? '✓ ' : '✗ '}${res.msg}</div>` : null}
      </div>`;
  };

  return html`
    <div class="notif-bell" ref=${ref}>
      <${Tooltip} text=${tr('notif.title', 'Notifications')} quiet=${open}>
        <button class="notif-bell-btn" aria-label=${tr('notif.title', 'Notifications')} onClick=${toggle}>
          <${Glyph} name="bell" />${unread > 0 ? html`<span class="poster-count poster-count--waiting poster-count--small notif-badge">${unread > 99 ? '99+' : unread}</span>` : null}
        </button>
      <//>
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
