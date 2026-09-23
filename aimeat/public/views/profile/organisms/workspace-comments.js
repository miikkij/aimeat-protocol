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
 *   v1.0.0 — 2026-06-19 — Extracted from organisms-tab.js during the module split.
 *   v1.1.0 — 2026-06-22 — Optional BATCHED mode (batched/initialComments/onReload): the parent fetches
 *     all visible threads in one /comments/batch request instead of each thread self-fetching +
 *     self-subscribing to 'organisms' events (which was the per-document comments request storm).
 *   v1.2.0 -- 2026-09-22 -- Composed from the shared set: a comment is a ListRow with its body under it,
 *     the composer is Fields; no class of its own.
 *   v1.2.1 -- 2026-09-22 -- Delete carries the danger tone.
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
import { Stack, ListRow, Action, Field, Text } from '/components/poster-parts.js';

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
  return html`<${Stack} density="compact">
    <${Text} kind="label">${(t('organisms.commentsHeading') || 'Comments') + (list.length ? ` (${list.length})` : '')}<//>
    ${comments === null ? html`<${Text} tone="muted">…<//>` : null}
    ${comments !== null && list.length === 0 ? html`<${Text} kind="caption" tone="muted">${t('organisms.noComments') || 'No comments yet.'}<//>` : null}
    ${list.map(c => html`
      <${ListRow} key=${c.id} density="compact" preview=${false} detailKind="text"
        name=${c.author || '?'}
        detail=${`${c.parentId ? `${t('organisms.inReply') || 'reply'} · ` : ''}${c.anchor?.quote ? `“${String(c.anchor.quote).slice(0, 80)}” · ` : ''}${c.anchor?.section ? `§${c.anchor.section} · ` : ''}${c.createdAt ? dt(c.createdAt) : ''}`}
        actions=${html`<${Action} kind="text" disabled=${busy} onClick=${() => setReplyTo({ id: c.id, body: c.body })}>${t('organisms.reply') || 'Reply'}<//>
          ${mine(c.author) ? html`<${Action} kind="text" tone="danger" disabled=${busy} onClick=${() => remove(c)}>${t('organisms.delete') || 'Delete'}<//>` : null}`}>
        <${Text}>${c.body || ''}<//>
      <//>`)}
    <${Stack} density="compact">
      ${replyTo ? html`<${Stack} direction="wrap" align="center" density="compact">
        <${Text} kind="caption" tone="muted">${t('organisms.replyingTo') || 'Replying to'}: “${String(replyTo.body || '').slice(0, 60)}”<//>
        <${Action} kind="text" onClick=${() => setReplyTo(null)}>${t('organisms.cancel') || 'Cancel'}<//>
      <//>` : null}
      <${Field} placeholder=${t('organisms.anchorQuotePlaceholder') || 'Optional: quote a passage to anchor the comment'} value=${anchorQuote} onInput=${(e) => setAnchorQuote(e.target.value)} />
      <${Field} type="textarea" rows=${2} placeholder=${t('organisms.commentPlaceholder') || 'Add a comment…'} value=${body} onInput=${(e) => setBody(e.target.value)} />
      <${Stack} direction="wrap"><${Action} disabled=${busy || !body.trim()} onClick=${submit}>${t('organisms.postComment') || 'Comment'}<//><//>
    <//>
  <//>`;
}
