/**
 * @file src/services/approval-standard.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The standard every one-press approval on this node keeps, and the pieces the flows
 *   share to keep it (secaudit2026oct22; Jouni, 2026-10-25: "pitää olla käyttäjälle erittäin
 *   selkeä mitä tapahtuu ja että tässä varmistetaan asioita ... jos sitä ei hyväksytä käyttäjän on
 *   saatava siitä myös ilmoitus takaisin päin. sekä jos se hyväksyttiin niin siitäkin. muuten se
 *   näkyy vain pending.").
 *
 *   THE STANDARD.
 *     1. The one who answers gets a notice that says in plain words what is checked and why, with
 *        Allow and Don't allow on it.
 *     2. A question the operator must answer goes to the node's operators (approverGhiis). The
 *        account it is about hears it too, without buttons, when its holder is not an operator.
 *     3. The one who asked sees the question as pending until it is answered: the request store
 *        (publish-requests/store.ts) keeps it, and GET /v1/publish-requests/:id and the MCP tool
 *        aimeat_publish_requests serve its state.
 *     4. The one who asked hears the answer, Allow and Don't allow alike (tellAsker): an agent as a
 *        message on its Agent v2 inbox, a person in the bell, an app through the bell of the account
 *        holder who runs it.
 *
 *   THE FLOWS. The request store files every question that has an applier (making something public,
 *   an extension's emailPolicy, a crew model with its own address, switching off the secret host
 *   question). services/secret-approvals.ts and services/eco-capability-approvals.ts keep their
 *   answer on the row the answer governs (the secret, the outside app) and call tellAsker when the
 *   owner answers. services/shared-secret-ask.ts tells the operators through approverGhiis.
 *   services/permission-ask-notice.ts asks for a permission, which the agent's page answers.
 *     5. Once decided, the question's notices show the answer (who, what, when, where to change it)
 *        and no buttons (closeQuestion; the developer, 2026-10-25).
 * @structure Approver · AskerKind · askerKind · approverGhiis · closeQuestion · ApprovalOutcome · AskerAnswer ·
 *   APPROVAL_ANSWER_TYPE · tellAsker
 * @usage
 *   const to = await approverGhiis({ storage, config }, accountGhii, 'operators');
 *   await tellAsker({ storage, config }, { accountGhii, asker, outcome: 'declined', sentence, decidedBy, contextId, what });
 * @version-history
 *   v1.1.0 — 2026-10-25 — closeQuestion(): a decided question's notices show the answer and lose their
 *     buttons, whoever decided and wherever (the developer's review of the sandbox).
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, the developer's approval standard).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { notify } from './notify.js';
import { listOperatorGhiis } from './operators.js';
import { sendAgentV2Message } from './agent-v2-messaging.js';
import { emitChange } from './event-bus.js';
import { answerNotifications, type AnswerOutcome } from './notification-answers.js';
import { isGEAI, localAccountName } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

/** Who answers a question: the account holder, or the node's operators. */
export type Approver = 'owner' | 'operators';

/** What kind of principal asked: an agent, an app (an app grant or an ecosystem app), or a person. */
export type AskerKind = 'agent' | 'app' | 'person';

/**
 * The question is decided: every notice that asked it (written with `ref`) shows the answer, who gave
 * it and when, and where to change it later, and offers no button again (services/notification-
 * answers.ts). `recipients` are the ones the question went to. Never throws.
 */
export async function closeQuestion(
  deps: { storage: Storage },
  q: { recipients: readonly string[]; ref: string; outcome: AnswerOutcome; decidedBy: string | null; change?: { link: string; key: string } },
): Promise<void> {
  const at = new Date().toISOString();
  for (const to of new Set(q.recipients)) {
    await answerNotifications(deps.storage, to, { ref: q.ref }, {
      outcome: q.outcome, by: q.decidedBy, at, ...(q.change ? { change: q.change } : {}),
    });
  }
}

/** The kind of a principal as it is stored: `eco:` is an app, a `#` an agent, anything else a person. */
export function askerKind(principal: string): AskerKind {
  if (isGEAI(principal)) return 'app';
  return principal.includes('#') ? 'agent' : 'person';
}

/** An account name or a GHII, as a GHII on this node. */
function asGhii(config: AimeatConfig, account: string): string {
  return account.includes('@') ? account : `${account}@${config.nodeId}`;
}

/**
 * The GHIIs that get the question. The owner's: the account itself. The operators': every operator
 * of this node, and when there is none yet (a node before its first operator), the account itself,
 * so a question is never addressed to nobody.
 */
export async function approverGhiis(
  deps: { storage: Storage; config: AimeatConfig }, accountGhii: string, approver: Approver,
): Promise<string[]> {
  if (approver === 'owner') return [accountGhii];
  const operators = await listOperatorGhiis(deps.storage, deps.config);
  return operators.length ? operators : [accountGhii];
}

export type ApprovalOutcome = 'allowed' | 'declined' | 'expired' | 'outdated';

/** The bell notice type of an answer told back to the one who asked. */
export const APPROVAL_ANSWER_TYPE = 'approval_answer';

export interface AskerAnswer {
  /** The account the question was about. */
  accountGhii: string;
  /** The principal that asked: a GAII, an `eco:` app, a GHII or a bare account name. */
  asker: string;
  outcome: ApprovalOutcome;
  /** One English sentence an AI reads: what was asked and how it ended. */
  sentence: string;
  /** The thing it was about, by its name, for the bell ("mailer", "OPENAI_KEY"). */
  what: string;
  /** Who answered: a GHII or a GAII; null when time answered. */
  decidedBy: string | null;
  /** The request's id, so an agent finds the answer in the same thread it asked in. */
  contextId: string;
  /** Machine-readable facts that ride with an agent's message. */
  data?: Record<string, unknown>;
  /** The agent message's metadata kind; defaults to 'approval-answer'. */
  messageKind?: string;
  /** The page the bell notice opens. */
  link?: string;
}

/** The name a person reads for who answered. */
function deciderName(decidedBy: string | null): string {
  if (!decidedBy) return 'Nobody';
  return decidedBy.includes('#') ? decidedBy.slice(0, decidedBy.indexOf('#')) : localAccountName(decidedBy);
}

const ANSWER_TEXT: Record<ApprovalOutcome, (what: string, who: string) => { title: string; body: string }> = {
  allowed: (what, who) => ({ title: `Allowed: ${what}`, body: `${who} allowed what was asked. It is in effect now.` }),
  declined: (what, who) => ({ title: `Not allowed: ${what}`, body: `${who} did not allow what was asked. Nothing changed.` }),
  expired: what => ({ title: `No answer: ${what}`, body: 'Nobody answered the request in time. Nothing changed. Ask again if it is still needed.' }),
  outdated: what => ({ title: `Not done: ${what}`, body: 'It changed after it was asked, so nothing was done. Ask again if it is still needed.' }),
};

/**
 * Tell the one who asked how its question ended. Never throws: the answer stands and is on the
 * request's record whether or not the notice went out. Nobody is told what they answered
 * themselves: a person who pressed Allow sees it happen.
 */
export async function tellAsker(deps: { storage: Storage; config: AimeatConfig }, a: AskerAnswer): Promise<void> {
  const kind = askerKind(a.asker);
  try {
    if (kind === 'agent') {
      await sendAgentV2Message(deps.storage, {
        owner: localAccountName(a.accountGhii),
        from: a.decidedBy ?? a.accountGhii,
        to: a.asker,
        role: 'agent',
        contextId: a.contextId,
        parts: [
          { kind: 'text', text: a.sentence },
          { kind: 'data', data: { request_id: a.contextId, outcome: a.outcome, ...(a.data ?? {}) } },
        ],
        metadata: { kind: a.messageKind ?? 'approval-answer' },
      });
      return;
    }
    // A person is told in their own bell; an app through the bell of the account that runs it.
    const to = kind === 'person' ? asGhii(deps.config, a.asker) : a.accountGhii;
    if (a.decidedBy && asGhii(deps.config, a.decidedBy) === to) return;
    const who = deciderName(a.decidedBy);
    const text = ANSWER_TEXT[a.outcome](a.what, who);
    await notify(deps.storage, to, {
      type: APPROVAL_ANSWER_TYPE,
      title: text.title,
      body: text.body,
      ...(a.link ? { link: a.link } : {}),
      i18n: { key: `${APPROVAL_ANSWER_TYPE}_${a.outcome}`, vars: { what: a.what, who } },
    });
    emitChange('notifications', to);
  } catch (err) {
    logger.warn('approval standard: the one who asked could not be told; the answer is on the request', {
      account: a.accountGhii, asker: a.asker, outcome: a.outcome, error: String(err),
    });
  }
}
