/**
 * @file src/services/notification-answers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A notification that asked a question shows its answer once the question is decided,
 *   and never offers its buttons again (the developer, 2026-10-25: a decided request showed Don't
 *   allow, Allow and Open, and a second Allow answered "already approved").
 *
 *   ONE PLACE FOR EVERY KIND. The answered state lives on the notification record itself:
 *   `answered: { outcome, by, at, change? }`, and `actions` emptied. The bell and the Notifications
 *   page read it the same way (public/js/services/notifications.js answerTextOf). Two writers:
 *     - the flow that decided the question, by the question's `ref` (a notice written with
 *       notify({ ref })): services/approval-standard.ts closeQuestion, which the request store, the
 *       secret approvals, the outside-app approvals and the permission ask call, so an answer given
 *       anywhere (the allow page, an agent over MCP, the Access page) closes the notice too;
 *     - the page that ran a button, for every other kind: POST /v1/notifications/:id/answered after
 *       the button's own call answered, so an invitation, a share request or an install request
 *       stops offering its buttons the same way.
 *   Each write emits `notifications` on the live stream, so an open bell or page reloads its list.
 * @structure AnswerOutcome · NotifAnswer · outcomeOfAction · answerNotifications
 * @usage
 *   await answerNotifications(storage, ownerGhii, { ref: 'publish-request:<id>' }, { outcome: 'allowed', by, at });
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, the approval standard; the developer's review).
 */
import type { Storage } from '../storage/interface.js';
import { listOwnerNotificationRecords } from './notification-sweeps.js';
import { emitChange } from './event-bus.js';
import { updateMemoryRecord, UNCHANGED } from './record-cas.js';
import { logger } from '../utils/logger.js';

/** How a question ended. `done`: a button ran that is neither yes nor no; `answered`: it was decided elsewhere first. */
export type AnswerOutcome = 'allowed' | 'declined' | 'expired' | 'outdated' | 'done' | 'answered';

export interface NotifAnswer {
  outcome: AnswerOutcome;
  /** Who decided: a GHII or a GAII; null when time decided. */
  by: string | null;
  at: string;
  /** Where the person changes it later: a page of this node and the locale key under `notiftext.` that names it. */
  change?: { link: string; key: string };
}

const YES = new Set(['allow', 'approve', 'accept', 'confirm']);
const NO = new Set(['deny', 'decline', 'reject', 'refuse']);

/** The outcome a pressed button stands for, by its id. */
export function outcomeOfAction(actionId: string): AnswerOutcome {
  if (YES.has(actionId)) return 'allowed';
  if (NO.has(actionId)) return 'declined';
  return 'done';
}

/**
 * Mark the recipient's notifications that match as answered: their buttons go, the answer stays.
 * `ref` matches the notices a flow wrote for one question, `refPrefix` every question of one thing
 * (a secret stored again ends all of its questions); `id` matches one notification. A notice
 * already answered keeps its first answer. Never throws; answers how many were marked.
 */
export async function answerNotifications(
  storage: Storage, recipientGhii: string, match: { ref?: string; refPrefix?: string; id?: string }, answer: NotifAnswer,
): Promise<number> {
  if (!match.ref && !match.refPrefix && !match.id) return 0;
  try {
    const rows = await listOwnerNotificationRecords(storage, recipientGhii);
    let marked = 0;
    type Stored = { id?: string; ref?: string; answered?: unknown; actions?: unknown[] } | null;
    const matches = (v: Stored) => !!v && ((!!match.ref && v.ref === match.ref) || (!!match.id && v.id === match.id)
      || (!!match.refPrefix && typeof v.ref === 'string' && v.ref.startsWith(match.refPrefix)));
    for (const r of rows) {
      if (!matches(r.value as Stored) || (r.value as Stored)?.answered) continue;
      // On the version read, so a mark-read or a second answer at the same moment is not lost.
      const written = await updateMemoryRecord(storage, recipientGhii, r.key, (rec) => {
        const v = rec?.value as Stored;
        if (!rec || !matches(v) || v?.answered) return UNCHANGED;
        return { value: { ...(v as object), actions: [], answered: answer } };
      });
      if (written) marked++;
    }
    if (marked) emitChange('notifications', recipientGhii);
    return marked;
  } catch (err) {
    logger.warn('notification answers: a notice could not be marked answered; the answer stands', { recipient: recipientGhii, error: String(err) });
    return 0;
  }
}
