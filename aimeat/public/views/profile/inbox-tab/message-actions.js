/**
 * @file message-actions.js
 * @author Jouni Miikki
 * @description The five things a person does TO one message or one tracked response: track it, park
 *   it to the notebook, delete it, cancel a tracked response, star it. Pure extraction from
 *   inbox-tab.js when that file passed the 800-line ceiling — every body is the one that was there,
 *   and the closure it used to read became the `deps` argument.
 * @structure messageActions(deps) → { onTrackMsg, onParkMsg, onDeleteMsg, cancelTracked, toggleImportant }
 * @usage
 *   const { onDeleteMsg, ... } = messageActions({ showToast, confirm, setThread, loadLists, ... });
 * @version-history
 *   v1.0.0 — 2026-09-07 — Extracted (max-file-lines), with the delete that made the file outgrow it.
 */
import { t } from '/js/i18n.js';
import * as messages from '/js/services/messages.js';
import * as tracked from '/js/services/tracked-responses.js';
import { parkMessage } from './helpers.js';
import { swallowed } from '/js/swallowed.js';

/**
 * @param {object} deps everything these handlers used to close over in InboxTab.
 */
export function messageActions({
  trackedByMsg, important, dismissedRef,
  showToast, confirm,
  setMode, setTrackMsg, setThread, setTrackedList, setImportant,
  loadLists,
}) {
  // Clicking 🔗: if the message already has an ACTIVE tracked response, surface it (don't make a
  // duplicate); a finished (replied) one may be tracked again as a fresh task.
  const onTrackMsg = (msg) => {
    const existing = trackedByMsg[msg.id];
    if (existing && existing.state !== 'replied') { showToast?.(t('inbox.trackAlready')); setMode('tracked'); return; }
    setTrackMsg(msg);
  };

  // Clicking 📓: copy the message straight into the notebook for later processing (no AI step) — keeps the
  // source link + reply intent so it can be replied to or enriched/filed from the notebook later.
  const onParkMsg = (msg) => parkMessage(msg, showToast);

  // Remove one message from this mailbox. `deleteMessage()` and its route have both existed since the
  // Messages page was built and no view had ever called them, so the only way to remove a message was
  // curl. It asks first, because this is the one action on a bubble with no undo, and it removes the
  // row from the open thread on success rather than waiting for a refetch — the SSE 'messages' change
  // the node emits reloads the list behind it.
  const onDeleteMsg = (msg) => {
    confirm(t('inbox.deleteMessageConfirm'), async () => {
      let resp;
      try { resp = await messages.deleteMessage(msg.id); }
      catch { showToast?.(t('inbox.deleteMessageFailed'), true); return; }
      if (resp?.ok === false) { showToast?.(resp.error?.message || t('inbox.deleteMessageFailed'), true); return; }
      setThread(prev => prev.filter(m => m.id !== msg.id));
      showToast?.(t('inbox.deleteMessageDone'));
      loadLists();
    }, { danger: true, confirmLabel: t('inbox.deleteMessageAction') });
  };

  const cancelTracked = async (tr) => {
    let resp;
    try { resp = await tracked.cancelTrackedResponse(tr.id); }
    catch { showToast?.(t('inbox.trackFailed'), true); return; }
    if (resp?.ok === false) { showToast?.(resp.error?.message || t('inbox.trackFailed'), true); return; }
    // Only on confirmed success: dismiss it immediately (so a stale re-fetch can't bring it back) + toast.
    dismissedRef.current.add(tr.id);
    setTrackedList(prev => prev.filter(x => x.id !== tr.id));
    showToast?.(t('inbox.trackCancelled'));
    loadLists();
  };

  const toggleImportant = async (msg) => {
    const next = new Set(important);
    const on = !next.has(msg.id);
    if (on) next.add(msg.id); else next.delete(msg.id);
    setImportant(next);
    await tracked.setMessageImportant(msg.id, on).catch(err => { swallowed('inbox-tab: toggleImportant', err); });
  };

  return { onTrackMsg, onParkMsg, onDeleteMsg, cancelTracked, toggleImportant };
}
