/**
 * @file public/views/profile/inbox-tab/helpers.js
 * @description Pure helpers + constants for the profile Inbox tab: peer/owner grouping, time/day
 *   formatting, WhatsApp-style delivery ticks, markdown body preparation (cid: resolution + tracking-
 *   pixel defense), tracked-state labels, attachment classification, the interactive-answer summary +
 *   poll tally, and the lazy Toast UI editor loader. Extracted from inbox-tab.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from inbox-tab.js (max-file-lines)
 */
import { t, getLocale } from '/js/i18n.js';

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
