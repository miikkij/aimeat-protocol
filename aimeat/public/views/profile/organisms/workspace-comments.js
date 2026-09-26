/**
 * @file workspace-comments.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Comment thread on one workspace object (record or document). Members read + add
 *   comments; an author (or org admin) deletes. Supports an optional quote anchor and threaded
 *   replies. Extracted from organisms-tab.js with no behaviour change.
 * @structure WorkspaceComments
 * @usage import { WorkspaceComments } from '/views/profile/organisms/workspace-comments.js';
 * @version-history
 *   v1.8.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.7.0 — 2026-09-26 — When a comment was written is the Timestamp (.poster-time), not the tiny words (.pj-mini), a unification: Jouni's decision "Timestamp".
 *   v1.6.0 — 2026-09-25 — Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.5.0 — 2026-09-25 — Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.4.0 — 2026-09-25 — The headings over lists wear .poster-day-title, grey (--quiet) over a record (Jouni's decision "Group heading", a unification).
 *   v1.3.0 — 2026-09-25 — The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.2.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.1.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   v1.0.0 — 2026-06-19 — Extracted from organisms-tab.js during the module split.
 *   v1.1.0 — 2026-06-22 — Optional BATCHED mode (batched/initialComments/onReload): the parent fetches
 *     all visible threads in one /comments/batch request instead of each thread self-fetching +
 *     self-subscribing to 'organisms' events (which was the per-document comments request storm).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { dt } from '/js/format.js';
import * as orgService from '/js/services/organisms.js';
import { swallowed } from '/js/swallowed.js';
import { getSession } from '/js/services/auth.js';

/**
 * Comment thread on one workspace object (record or document). Targeted by orgId+ws+space+instanceId.
 * Members read + add comments; an author (or org admin) deletes. Supports an optional quote anchor
 * (comment on a specific passage) and threaded replies (parentId). Backend: /v1/organisms/:id/comments.
 * Agents use the same endpoints via aimeat_workspace_comment(s).
 */
export function WorkspaceComments({ orgId, ws, space, instanceId, showToast, batched, initialComments, onReload }) {
  // BATCHED mode (parent owns the fetch): the container fetches every visible thread in one
  // /comments/batch request and passes this thread's slice via `initialComments`; we don't self-fetch
  // or self-subscribe (that per-thread fan-out was the comments request storm). STANDALONE mode
  // (no `batched`): unchanged — self-fetch on mount + refresh on 'organisms' events.
  const [comments, setComments] = useState(batched ? (initialComments ?? null) : null);
  const [body, setBody] = useState('');
  const [anchorQuote, setAnchorQuote] = useState('');
  const [replyTo, setReplyTo] = useState(null);   // { id, body } of the comment being replied to
  const [busy, setBusy] = useState(false);
  const me = getSession() || {};
  const mine = (author) => author && (author === me.gaii || author === me.ghii);

  const load = useCallback(async () => {
    if (batched) { await onReload?.(); return; }   // parent re-runs the batch → flows back via initialComments
    if (!ws || !space || !instanceId) return;
    const r = await orgService.listComments(orgId, ws, space, instanceId).catch(err => { swallowed('workspace-comments: mine', err); return null; });
    setComments(r?.data?.comments || []);
  }, [orgId, ws, space, instanceId, batched, onReload]);
  // Batched: keep local view in sync with the prop (undefined = still loading → null). Standalone: self-fetch.
  useEffect(() => { if (batched) setComments(initialComments ?? null); }, [batched, initialComments]);
  useEffect(() => { if (!batched) load(); }, [load, batched]);
  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => { if (batched) return undefined; return onLiveUpdate(['organisms'], () => liveRef.current()); }, [batched]);

  const submit = async () => {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    try {
      const anchor = anchorQuote.trim() ? { quote: anchorQuote.trim() } : undefined;
      const r = await orgService.addComment(orgId, { ws, space, instanceId, body: text, anchor, parentId: replyTo?.id });
      if (r?.ok === false) showToast(r?.error?.message || (t('organisms.commentFailed') || 'Could not post comment'));
      else { setBody(''); setAnchorQuote(''); setReplyTo(null); await load(); }
    } catch (e) { showToast((e && e.message) || (t('organisms.commentFailed') || 'Could not post comment')); }
    finally { setBusy(false); }
  };
  const remove = async (c) => {
    setBusy(true);
    try {
      const r = await orgService.deleteComment(orgId, c.id, ws, space, instanceId);
      if (r?.ok === false) showToast(r?.error?.message || (t('organisms.commentDeleteFailed') || 'Could not delete'));
      else await load();
    } catch (e) { showToast((e && e.message) || (t('organisms.commentDeleteFailed') || 'Could not delete')); }
    finally { setBusy(false); }
  };

  const list = comments || [];
  return html`
    <div class="pj-comments">
      <div class="detail-label poster-day-title">${(t('organisms.commentsHeading') || 'Comments') + (list.length ? ` (${list.length})` : '')}</div>
      ${comments === null ? html`<div class="section-desc">…</div>` : null}
      ${comments !== null && list.length === 0 ? html`<div class="section-desc">${t('organisms.noComments') || 'No comments yet.'}</div>` : null}
      ${list.map(c => html`
        <div class="pj-comment ${c.parentId ? 'pj-comment-reply' : ''}" key=${c.id}>
          <div class="pj-comment-head">
            <b>${(c.author || '?')}</b>
            ${c.parentId ? html`<span class="pj-mini"> · ${t('organisms.inReply') || 'reply'}</span>` : null}
            ${c.anchor?.quote ? html`<span class="pj-mini"> · “${(String(c.anchor.quote).slice(0, 80))}”</span>` : null}
            ${c.anchor?.section ? html`<span class="pj-mini"> · §${(c.anchor.section)}</span>` : null}
            <span class="poster-time"> · ${c.createdAt ? dt(c.createdAt) : ''}</span>
          </div>
          <div class="pj-comment-body">${(c.body || '')}</div>
          <div class="pj-comment-actions">
            <button class="poster-action poster-action--small" disabled=${busy} onClick=${() => setReplyTo({ id: c.id, body: c.body })}>${t('organisms.reply') || 'Reply'}</button>
            ${mine(c.author) ? html`<button class="poster-action poster-action--small" disabled=${busy} onClick=${() => remove(c)}>${t('organisms.delete') || 'Delete'}</button>` : null}
          </div>
        </div>
      `)}
      <div class="pj-comment-compose">
        ${replyTo ? html`<div class="pj-mini">${t('organisms.replyingTo') || 'Replying to'}: “${(String(replyTo.body || '').slice(0, 60))}” <button class="poster-action poster-action--small" onClick=${() => setReplyTo(null)}>${t('organisms.cancel') || 'Cancel'}</button></div>` : null}
        <input class="og-input" placeholder=${t('organisms.anchorQuotePlaceholder') || 'Optional: quote a passage to anchor the comment'} value=${anchorQuote} onInput=${(e) => setAnchorQuote(e.target.value)} />
        <textarea class="og-textarea" rows="2" placeholder=${t('organisms.commentPlaceholder') || 'Add a comment…'} value=${body} onInput=${(e) => setBody(e.target.value)}></textarea>
        <button class="poster-slab poster-slab--control" disabled=${busy || !body.trim()} onClick=${submit}>${t('organisms.postComment') || 'Comment'}</button>
      </div>
    </div>
  `;
}
