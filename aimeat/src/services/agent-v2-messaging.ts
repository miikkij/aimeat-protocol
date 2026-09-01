/**
 * @file src/services/agent-v2-messaging.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agent v2 messaging: storing a turn, and getting it to a recipient that may not be
 *   here.
 *
 *   ONE IMPLEMENTATION, THREE DOORS. The REST route, the MCP tool and the CLI dispatch all land in
 *   `sendAgentV2Message`. This is the rule the August 2026 audit was written to enforce, and
 *   `aimeat_memory_write` is the example of what happens without it: the same defect fixed three
 *   separate times, each in one place while the other surface kept the old behaviour.
 *
 *   TWO WAYS OUT, AND NEITHER IS THE MESSAGE. A recipient holding a tunnel socket gets a `deliver`
 *   frame; a recipient with a registered push target gets a POST. Both are NOTIFICATIONS that a turn
 *   exists — the message itself is stored first and readable from `listAgentV2Messages` whatever
 *   happens next, so a recipient that was asleep for both catches up with a `since` read rather than
 *   losing the turn. Delivery is best-effort by construction: a webhook that is down must never fail
 *   the send.
 *
 *   THE OUTBOUND CALL GOES THROUGH safeFetch, ALWAYS. The URL is principal-supplied, so a plain
 *   fetch here is an SSRF with a configuration screen in front of it — and a redirect to
 *   169.254.169.254 is the same hole one hop later, which is why safeFetch re-validates every hop.
 *
 * @structure sendAgentV2Message() · deliverToPushTargets() · MESSAGE_DELIVERY_KIND
 * @usage const msg = await sendAgentV2Message(storage, { owner, from, to, role, parts, ... });
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V4).
 */
import { randomUUID } from 'node:crypto';
import type { Storage, AgentV2MessageRecord, AgentV2PushConfigRecord, MessagePart } from '../storage/interface.js';
import { MESSAGE_SPEC, type MessageRole } from '../models/agent-v2-message.js';
import { getActiveConnectTunnelManager } from './connect-tunnel.js';
import { emitDelivery } from './event-bus.js';
import { safeFetch } from '../utils/url-validator.js';
import { logger } from '../utils/logger.js';

/**
 * The tunnel `deliver` kind for a v2 turn. The frame's `kind` is an open string on the wire and the
 * connector hands any kind to its callback, so this is additive: no existing delivery changes, and a
 * client that does not know this kind ignores it exactly as it ignores any other.
 */
export const MESSAGE_DELIVERY_KIND = 'v2.message';

/** How long a push target has to answer before the attempt is abandoned. */
const PUSH_TIMEOUT_MS = 10_000;

/**
 * Consecutive failures before the node stops trying. Ten, the same as the agent webhook dispatcher,
 * because a person who has learnt what a dead webhook looks like on one surface should not have to
 * learn a second number on another.
 */
const MAX_PUSH_FAILURES = 10;

export interface SendAgentV2MessageInput {
  /** Bare owner name, already resolved. Never taken from a request body. */
  owner: string;
  /** The sending principal, already resolved. Never taken from a request body. */
  from: string;
  /** The recipient principal, already resolved and already checked to belong to `owner`. */
  to: string;
  role: MessageRole;
  parts: MessagePart[];
  /** Omitted means a new exchange, and the message id doubles as its context. */
  contextId?: string | null;
  taskId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Store the turn, then tell whoever is listening. Returns the stored record; the two delivery
 * attempts run after it and cannot fail the send.
 */
export async function sendAgentV2Message(storage: Storage, input: SendAgentV2MessageInput): Promise<AgentV2MessageRecord> {
  const messageId = randomUUID();
  const message: AgentV2MessageRecord = {
    messageId,
    role: input.role,
    parts: input.parts,
    // A first turn with no context names itself. The alternative is a caller having to make one up
    // before it knows whether the send will be accepted at all.
    contextId: input.contextId?.trim() || messageId,
    taskId: input.taskId?.trim() || null,
    from: input.from,
    to: input.to,
    owner: input.owner,
    createdAt: new Date().toISOString(),
    metadata: input.metadata ?? null,
  };

  await storage.createAgentV2Message(message);

  // A socket, if the recipient is holding one. Not awaited on purpose: it is a notification.
  try {
    if (getActiveConnectTunnelManager()?.isConnected(message.to)) {
      emitDelivery({ target: message.to, kind: MESSAGE_DELIVERY_KIND, id: message.messageId, payload: envelope(message) });
    }
  } catch (err) {
    logger.warn('v2 message: the tunnel notification failed; the message is stored and readable', {
      messageId, to: message.to, error: String(err),
    });
  }

  void deliverToPushTargets(storage, message);
  return message;
}

/** What a recipient receives, on either road. `spec` is there for a reader that meets one alone. */
function envelope(message: AgentV2MessageRecord, token?: string | null): Record<string, unknown> {
  return {
    spec: MESSAGE_SPEC,
    message: {
      messageId: message.messageId,
      role: message.role,
      parts: message.parts,
      contextId: message.contextId,
      taskId: message.taskId,
      from: message.from,
      to: message.to,
      createdAt: message.createdAt,
      metadata: message.metadata,
    },
    // The receiver's own string, echoed back so it can tell this POST came from a target it
    // registered. Absent on the tunnel road, where the socket already answered that question.
    ...(token ? { token } : {}),
  };
}

/**
 * POST the turn to every target the recipient registered. Best-effort, one attempt each: a target
 * that fails ten times running is disabled and says so on the next read, which is a better answer
 * than a queue nobody drains.
 */
export async function deliverToPushTargets(storage: Storage, message: AgentV2MessageRecord): Promise<void> {
  let targets: AgentV2PushConfigRecord[];
  try {
    targets = await storage.listAgentV2PushConfigs(message.owner, message.to);
  } catch (err) {
    logger.warn('v2 message: could not read the recipient push targets', { messageId: message.messageId, error: String(err) });
    return;
  }

  for (const target of targets) {
    if (target.disabledAt) continue;
    const at = new Date().toISOString();
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      // A2A's authentication block, applied the way it reads: the first scheme names the header's
      // prefix and `credentials` is the secret. The secret leaves the node ONLY here, only to the
      // URL registered for it.
      if (target.authCredentials && target.authSchemes.length > 0) {
        headers.Authorization = `${target.authSchemes[0]} ${target.authCredentials}`;
      }
      const res = await safeFetch(target.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(envelope(message, target.token)),
        signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
      });
      const ok = res.ok;
      await storage.recordAgentV2PushAttempt(target.id, ok, at,
        ok ? null : (target.failCount + 1 >= MAX_PUSH_FAILURES ? at : null));
      if (!ok) {
        logger.warn('v2 message: a push target answered with an error', {
          messageId: message.messageId, config: target.id, status: res.status,
        });
      }
    } catch (err) {
      const disabling = target.failCount + 1 >= MAX_PUSH_FAILURES;
      await storage.recordAgentV2PushAttempt(target.id, false, at, disabling ? at : null)
        .catch(e => logger.warn('v2 message: could not record the failed push attempt', { config: target.id, error: String(e) }));
      logger.warn('v2 message: a push target could not be reached', {
        messageId: message.messageId, config: target.id, disabled: disabling, error: String(err),
      });
    }
  }
}
