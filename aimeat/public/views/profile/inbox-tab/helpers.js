/**
 * @file public/views/profile/inbox-tab/helpers.js
 * @description Pure helpers + constants for the profile Inbox tab: peer/owner grouping, time/day
 *   formatting, WhatsApp-style delivery ticks, markdown body preparation (cid: resolution + tracking-
 *   pixel defense), tracked-state labels, attachment classification, the interactive-answer summary +
 *   poll tally, and the lazy Toast UI editor loader. Extracted from inbox-tab.js to satisfy max-file-lines.
 * @version-history
 *   v1.6.0 — 2026-08-04 — resolveThreadAttachmentUrls(): cache entries carry a mint timestamp and are
 *     re-minted after ATTACHMENT_URL_REUSE_MS instead of reused forever — a presigned download URL
 *     held past its 1 h token TTL failed every click with the browser's bare "Couldn't download".
 *   v1.5.0 — 2026-08-03 — buildContactOptions() + normalizePollQuestions() moved here from inbox-tab.js
 *     (max-file-lines); mergeThreadPage(): upsert-by-id merge of a freshly fetched newest page into a
 *     loaded thread, for the live delta refresh that replaced full-history reloads.
 *   v1.4.0 — 2026-08-01 — parkMessage() + openTrackedRecord() moved here from inbox-tab.js: two
 *     self-contained actions that needed nothing from the tab's state beyond a toast, pulled out to
 *     keep the tab under max-file-lines while voice messages were added to it.
 *   v1.3.0 — 2026-07-27 — sendFailure(): pick the toast text for a failed send, preferring the thrown
 *     reason (attachment too large, out of quota) over the generic "could not send".
 *   v1.2.0 — 2026-07-21 — resolveThreadAttachmentUrls(): resolve non-inline attachment URLs for a loaded
 *     thread (reusing the previous conversation's cache), extracted from inbox-tab loadThread.
 *   v1.1.0 — 2026-07-17 — quoteSnippet(): one-line plain-text excerpt of a message body for reply-quotes.
 *   v1.0.0 — 2026-07-13 — Extracted from inbox-tab.js (max-file-lines)
 */
import { t, getLocale } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';
import { parkMessageToNotebook } from '/js/services/notebook.js';
import { firstLine } from '../notebook-helpers.js';

/** 📓 on a message: copy it straight into the notebook for later processing (no AI step), keeping the
 *  source link + reply intent so it can be replied to or filed from there. */
export async function parkMessage(msg, showToast) {
  try {
    await parkMessageToNotebook(msg, { title: firstLine(msg.body) });
    showToast?.(t('inbox.parkedToNotebook'));
  } catch (e) {
    showToast?.(e?.message || t('inbox.trackFailed'), true);
  }
}

/** Open the workspace record a tracked response watches. Sets BOTH the saved tab (so the profile
 *  loads onto Organisms) and the workspace deep-link (so that exact workspace opens), then navigates. */
export function openTrackedRecord(tr, showToast) {
  const r = tr.references || {};
  if (!r.organismId || !r.workspaceId) { showToast?.(t('inbox.trackNoRecord'), true); return; }
  try {
    sessionStorage.setItem('aimeat-profile-tab', 'organisms');
    sessionStorage.setItem('aimeat.ws.openId', r.organismId);
    sessionStorage.setItem('aimeat.ws.openWs', r.workspaceId);
  } catch (err) {
    // Storage refused (private mode, quota): the navigation below still happens, it just lands on
    // the Organisms tab without pre-opening the workspace.
    swallowed('inbox helpers: openTrackedRecord deep-link', err);
  }
  window.location.assign('/v1/profile?tab=organisms');
}

/**
 * Toast text for a failed send. An attachment upload throws for reasons the sender can act on: the file
 * is over this node's per-file limit, or the account is out of storage quota. The generic "could not
 * send" hid every one of them, so an oversized video read as a dead button, with nothing in the console
 * either. Prefer the thrown message; keep the generic line for errors that carry none of their own.
 */
export function sendFailure(err) {
  const msg = String(err?.message || '').trim();
  return msg && msg !== 'Failed to fetch' ? msg : t('inbox.failed');
}

/**
 * Resolve presigned URLs for a thread's non-inline attachments, reusing already-resolved URLs from the
 * SAME conversation's previous cache (a refresh/new message must not re-download every existing image).
 * Keyed by `${messageId}::${attachmentId}` (per-message ids repeat across messages). Inbound resolves the
 * recipient's duplicated local copy; outbound resolves the original. `resolveUrl` = messages.attachmentUrl.
 * Returns { convId, map } to store as the new cache.
 */
/** Recipient suggestions for a new message: your own agents (GAIIs) + everyone you've a thread with. */
export function buildContactOptions(myAgents, conversations) {
  const map = new Map();
  for (const a of myAgents) {
    if (a?.gaii) map.set(a.gaii, `${a.name || a.gaii} ${t('inbox.contactAgentSuffix')}`);
  }
  for (const c of conversations) {
    if (c?.peerGhii && !map.has(c.peerGhii)) map.set(c.peerGhii, peerName(c.peerGhii));
  }
  return [...map.entries()].map(([id, label]) => ({ id, label }));
}

/** Broadcast poll: keep only answerable questions (a prompt + ≥1 labelled option), normalized for send. */
export function normalizePollQuestions(bcQuestions) {
  return bcQuestions
    .map(q => ({ ...q, options: (q.options || []).filter(o => o.label.trim()) }))
    .filter(q => q.prompt.trim() && q.options.length >= 1)
    .map(q => ({
      id: q.id, header: (q.header || q.prompt).slice(0, 80), prompt: q.prompt.trim(),
      options: q.options.map(o => ({ id: o.id, label: o.label.trim() })),
      multiSelect: !!q.multiSelect, allowOther: q.allowOther !== false, required: !!q.required,
    }));
}

/** Merge a freshly fetched NEWEST page (chronological) into an already-loaded thread: upsert by id —
 *  a new message appends, a changed one (read tick) replaces — ordered by createdAt. Messages older
 *  than the fetched page stay as loaded, so a live refresh never re-walks the whole history. */
export function mergeThreadPage(prev, newest) {
  const newestIds = new Set(newest.map(m => m.id));
  return [...prev.filter(m => !newestIds.has(m.id)), ...newest]
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

/** Resolved attachment URLs are PRESIGNED — the token inside them expires after 1 h (server
 *  OWN_HANDLE_TTL_SECONDS). Reusing a cached URL forever meant a download click in a long-open tab
 *  hit a dead token (410 → the browser's bare "Couldn't download"). Entries older than this are
 *  re-minted instead of reused; paired with ATTACHMENT_URL_REFRESH_MS in inbox-tab.js (15 min ticks)
 *  the worst-case age of a link in the DOM stays ~55 min, always inside the token's lifetime. */
export const ATTACHMENT_URL_REUSE_MS = 40 * 60 * 1000;

export async function resolveThreadAttachmentUrls(msgs, conversationId, prevCache, resolveUrl) {
  const sameConv = prevCache?.convId === conversationId;
  const prev = sameConv ? (prevCache.map || {}) : {};
  // mintedAt per entry — a pre-timestamp cache ({} fallback) reads as age-infinite and re-mints.
  const prevTs = sameConv ? (prevCache.ts || {}) : {};
  const now = Date.now();
  const map = {};
  const ts = {};
  await Promise.all(msgs.flatMap(m => (m.attachments || [])
    .filter(a => !a.inline)
    .map(async a => {
      const uk = `${m.id}::${a.id}`;
      if (prev[uk] && now - (prevTs[uk] || 0) < ATTACHMENT_URL_REUSE_MS) {
        map[uk] = prev[uk]; ts[uk] = prevTs[uk]; return;
      }
      const key = (a.mode === 'duplicate' && a.localKey) ? a.localKey
        : (m.direction === 'outbound' && a.storageKey) ? a.storageKey : null;
      if (!key) return;
      const u = await resolveUrl(key).catch(err => { swallowed('helpers: key', err); return null; });
      if (u) { map[uk] = u; ts[uk] = now; }
    })));
  return { convId: conversationId, map, ts };
}

/* Lazy-load the vendored Toast UI Editor (MIT, /lib/toastui/) — the same editor the workspace
 * document space uses, so composing a message feels like editing a document (Markdown⇄WYSIWYG).
 * ~520KB, so it stays out of the main bundle and loads only when the Inbox composer mounts. */
let _tuiPromise = null;
export function loadToastUI() {
  if (window.toastui && window.toastui.Editor) return Promise.resolve(window.toastui.Editor);
  if (_tuiPromise) return _tuiPromise;
  _tuiPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-tui]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = '/lib/toastui/toastui-editor.min.css'; css.setAttribute('data-tui', '1');
      document.head.appendChild(css);
    }
    const s = document.createElement('script');
    s.src = '/lib/toastui/toastui-editor-all.min.js';
    s.onload = () => (window.toastui && window.toastui.Editor) ? resolve(window.toastui.Editor) : reject(new Error('editor missing'));
    s.onerror = () => reject(new Error('failed to load editor'));
    document.head.appendChild(s);
  });
  return _tuiPromise;
}

/* ── Helpers ── */

export function peerName(id) {
  if (!id) return '';
  const beforeAt = id.split('@')[0];
  return beforeAt.includes('#') ? beforeAt.split('#').pop() : beforeAt;
}

// ── Grouping a person + their agents ──
// A peer is a human GHII (owner@node), an agent GAII (agent#owner@node) or an app GEAI
// (eco:app#owner@node). They all belong to ONE person — the owner — so we group conversations under
// the owner key and keep each thread separate beneath it.
export function ownerKeyOf(ghii) {
  const s = String(ghii || '');
  const hash = s.indexOf('#');                 // 'agent#owner@node' / 'eco:app#owner@node' → 'owner@node'
  return hash >= 0 ? s.slice(hash + 1) : s;    // human 'owner@node' → itself
}
export function isAgentPeer(ghii) { return String(ghii).includes('#'); }
export function ownerDisplayName(ownerKey) { return String(ownerKey).split('@')[0]; }
/** Label for one thread INSIDE a person group: the agent/app id before '#', or null for the human thread. */
export function subThreadLabel(ghii) {
  const at = String(ghii || '').split('@')[0];
  return at.includes('#') ? at.split('#')[0] : null;
}
/** Group conversations by the owner behind each peer, preserving input (recency) order. */
export function groupConversations(conversations) {
  const map = new Map();
  for (const c of conversations) {
    const key = ownerKeyOf(c.peerGhii);
    if (!map.has(key)) map.set(key, { ownerKey: key, convs: [] });
    map.get(key).convs.push(c);
  }
  return [...map.values()];
}

// WhatsApp-style ticks: sent = one ✓; delivered (reached the recipient's mailbox, incl. an agent's) =
// two ✓✓ (grey); read (read receipt — humans send one, agents don't yet) = two ✓✓ coloured via
// inbox-tick--read; queued (cross-node, peer unreachable) = a clock.
const TICK = { sent: '✓', delivered: '✓✓', read: '✓✓', queued: '🕒', failed: '⚠', undeliverable: '⚠' };
export function statusTick(status) { return TICK[status] || ''; }

export function timeShort(s) {
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleTimeString(getLocale() === 'fi' ? 'fi-FI' : undefined, { hour: '2-digit', minute: '2-digit' });
}
export function dayKey(s) { return new Date(s).toDateString(); }
export function dayLabel(s) {
  const d = new Date(s);
  const today = new Date().toDateString();
  const yest = new Date(Date.now() - 86400000).toDateString();
  if (d.toDateString() === today) return t('inbox.today');
  if (d.toDateString() === yest) return t('inbox.yesterday');
  return d.toLocaleDateString(getLocale() === 'fi' ? 'fi-FI' : undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/* Build a markdown body safe to render: resolve cid:{id} inline media to the recipient's local
 * presigned URLs, and strip external http(s) images (tracking-pixel defense — DECISION #11). */
export function prepareBody(body, urlMap, expiredIds) {
  let out = String(body || '');
  out = out.replace(/!\[([^\]]*)\]\(cid:([a-zA-Z0-9_-]+)\)/g, (m, alt, id) => {
    if (expiredIds && expiredIds.has(id)) return `*[${alt ? alt + ' — ' : ''}${t('inbox.attachmentExpired')}]*`;
    const url = urlMap[id];
    return url ? `![${alt}](${url})` : `*[${alt || t('inbox.attachmentPending')}]*`;
  });
  out = out.replace(/!\[([^\]]*)\]\((https?:[^)]+)\)/g, (m, alt) => (alt ? `\`${alt}\`` : ''));
  return out;
}

/** One-line plain-text excerpt of a message body for a reply-quote (images/code/markdown marks stripped). */
export function quoteSnippet(body, max = 140) {
  const s = String(body || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '🖼')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`>#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Short label + tone for a Tracked Response state (used on the message badge + the list). */
export function trackStateLabel(state) {
  switch (state) {
    case 'watching': return { text: t('inbox.trackStateWatching'), tone: 'watch' };
    case 'awaiting-approval': return { text: t('inbox.trackStateAwaiting'), tone: 'ready' };
    case 'replied': return { text: t('inbox.trackStateReplied'), tone: 'done' };
    case 'error': return { text: t('inbox.trackStateError'), tone: 'err' };
    case 'sent': return { text: t('inbox.trackStateWatching'), tone: 'watch' };
    default: return { text: state || '', tone: 'watch' };
  }
}

/** Classify an attachment for rendering: how to view it (thumbnail / native tab / markdown viewer). */
export const ATTACH_ICO = { image: '🖼', pdf: '📄', markdown: '📄', audio: '🎵', video: '🎬', file: '📎' };
export function attachKind(a) {
  const mime = a.mime || '';
  const name = a.name || a.storageKey || '';
  if (a.kind === 'image' || /^image\//.test(mime)) return 'image';
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (/markdown/.test(mime) || /\.(md|markdown|mdx)$/i.test(name)) return 'markdown';
  if (a.kind === 'audio' || /^audio\//.test(mime)) return 'audio';
  if (a.kind === 'video' || /^video\//.test(mime)) return 'video';
  return 'file';
}

// Sentinel option id for the freeform "Other" choice (never collides with a real option id).
export const IFORM_OTHER = '__other__';

/** Build the human-readable markdown summary that becomes the reply body (so the thread + un-upgraded
 *  peers read the answer naturally, alongside the machine-readable `interactive.answers`). */
export function buildAnswerSummary(spec, answers) {
  const lines = [`**${t('inbox.answer.summaryTitle')}**`];
  for (const q of (spec?.questions || [])) {
    const a = answers[q.id] || { selected: [], other: null };
    const labels = (q.options || []).filter(o => a.selected.includes(o.id)).map(o => o.label);
    if (a.other) labels.push(`${t('inbox.answer.other')}: ${a.other}`);
    lines.push(`- ${q.header || q.prompt}: ${labels.length ? labels.join(', ') : '—'}`);
  }
  return lines.join('\n');
}

/** Aggregate poll answers across a broadcast's recipients into per-option tallies for the results view. */
export function tallyPoll(spec, recipients) {
  const out = [];
  for (const q of (spec?.questions || [])) {
    const counts = {};
    const others = [];
    for (const o of (q.options || [])) counts[o.id] = 0;
    for (const r of recipients) {
      const a = r.answers?.[q.id];
      if (!a) continue;
      for (const sel of (a.selected || [])) if (sel in counts) counts[sel]++;
      if (a.other) others.push(a.other);
    }
    out.push({ q, counts, others });
  }
  return out;
}
