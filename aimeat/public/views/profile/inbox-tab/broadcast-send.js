/**
 * @file public/views/profile/inbox-tab/broadcast-send.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sending one message to many from the Messages page: explicit recipients and/or a Share
 *   Group audience, a message or a poll. Moved out of inbox-tab.js unchanged when the list's sections
 *   and archive pushed that file past the 800-line ceiling; the closure it read became `ctx`.
 * @structure broadcastSend(ctx) → doBroadcast(_recipient, text, files, reset)
 * @usage const doBroadcast = broadcastSend({ sending, setSending, bcRecipients, … });
 * @version-history
 *   v1.0.0 — 2026-09-13 — Extracted from inbox-tab.js (max-file-lines), body unchanged.
 */
import { t } from '/js/i18n.js';
import * as messages from '/js/services/messages.js';
import { swallowed } from '/js/swallowed.js';
import { normalizePollQuestions, sendFailure } from './helpers.js';

/** The Composer's onSend for the broadcast page. */
export function broadcastSend({
  sending, setSending, bcRecipients, bcGroupId, bcAudience, bcType, bcQuestions, bcMode,
  showToast, trackBroadcast, loadLists, openResults, setMode,
}) {
  return async (_recipient, text, files, reset) => {
    if (sending) return;
    const body = (text || '').trim();
    if (bcRecipients.length === 0 && !bcGroupId && !bcAudience) { showToast?.(t('inbox.bcNoRecipients'), true); return; }

    let interactive;
    if (bcType === 'poll') {
      const questions = normalizePollQuestions(bcQuestions);
      if (!questions.length) { showToast?.(t('inbox.pollNeedQuestion'), true); return; }
      interactive = { role: 'questions', v: 1, questions };
    } else if (!body && files.length === 0) { return; }

    setSending(true);
    try {
      const attachments = [];
      for (let i = 0; i < files.length; i++) {
        const desc = await messages.uploadAttachment(files[i]);
        attachments.push({ ...desc, inline: false, id: `at${i}` });
      }
      const resp = await messages.sendBroadcast({
        to: bcRecipients, groupId: bcGroupId || undefined, audience: bcAudience || undefined,
        mode: bcType === 'poll' ? 'broadcast' : bcMode,   // a poll must be repliable (recipients answer)
        body, attachments, interactive,
      });
      if (resp?.ok === false) { showToast?.(resp?.error?.message || t('inbox.failed'), true); }
      else {
        reset?.();
        const id = resp?.data?.broadcast_id;
        const titleSrc = (bcType === 'poll' ? (interactive.questions[0]?.prompt || '') : body) || '';
        if (id) trackBroadcast({
          id, type: bcType,
          title: titleSrc.slice(0, 60) || t('inbox.broadcast'),
          createdAt: new Date().toISOString(),
        });
        showToast?.(`${t('inbox.bcSent')} (${resp?.data?.sent ?? 0})`);
        loadLists();
        if (id) openResults(id); else setMode('idle');
      }
    } catch (err) { swallowed('inbox-tab', err); showToast?.(sendFailure(err), true); }
    setSending(false);
  };
}
