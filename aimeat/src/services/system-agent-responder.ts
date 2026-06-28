/**
 * @file system-agent-responder.ts
 * @description Live inbound-DM responder for node-run system agents (the personal/company Secretary and
 *   specialists). Node-run agents have no connect tunnel to wake, so before this they only ever reacted
 *   on the scheduler tick — a DM to your Secretary sat unanswered until its next cron fire. This wires a
 *   real-time path: when the owner messages their own system agent, message-send fires
 *   handleInboundToSystemAgent(), which replies AS the agent immediately. Two cases:
 *     - the owner ANSWERS a clarify question the agent asked → acknowledge, then produce the deliverable
 *       live (shared produce in secretary-clarify.ts) so the outcome lands back in the thread at once
 *       instead of waiting for the tick;
 *     - a plain DM → a concise AI reply grounded in the agent's brain (Secretary context brain, or the
 *       agent's directives) + recent thread.
 *   Availability gates it (systemAgentLiveness): offline (no AI key) / away (stop-spending) send a short
 *   NON-AI note rather than silence, so the owner always knows where things stand. Loop-safe: the agent's
 *   own replies deliver to the owner (recipient == delivery target), so message-send never re-fires this.
 * @structure handleInboundToSystemAgent(ctx, params)
 * @usage import('./system-agent-responder.js').then(m => m.handleInboundToSystemAgent(ctx, {...}))  // fire-and-forget
 * @version-history
 *   v1.0.0 — 2026-06-28 — Initial live responder (clarify ack+produce, plain-DM AI reply, paused/offline notes).
 */
import type { DeliveryCtx } from './message-delivery.js';
import type { DirectMessageRecord } from '../storage/interface.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { systemAgentLiveness } from './system-agent.js';
import { completeForOwner } from './ai-completion.js';
import { sendDirectMessage } from './message-send.js';
import { findPendingClarifyJob, produceClarifyDeliverable } from './secretary-clarify.js';
import { logger } from '../utils/logger.js';

export interface InboundToSystemAgentParams {
  /** The node-run system agent the message is addressed to (`secretary#owner@node` / specialist GAII). */
  agentGaii: string;
  /** The owner's human GHII (mailbox the thread lands in). */
  ownerGhii: string;
  conversationId: string;
  /** Id of the triggering inbound message. */
  messageId: string;
}

/** Short, NON-AI notes for the not-available states — feedback beats silence. */
const NOTE_OFFLINE = '⚠️ I can\'t act yet — no AI provider is configured for your account. Add one in Settings and message me again.';
const NOTE_PAUSED = '⏸️ I\'m paused right now (stop-spending is on), so I\'m not using AI. Turn spending back on and I\'ll pick this up.';
const ACK_CLARIFY = '📝 Got your answers — putting them to work now. I\'ll post the result here in a moment.';

/** Max recent thread messages fed to the model for context on a plain DM reply. */
const CONTEXT_MESSAGES = 10;

/**
 * Respond, as the node-run system agent, to a DM the owner just sent it. Fire-and-forget: callers do not
 * await this (message-send returns immediately). Never throws — all failures are logged + best-effort.
 */
export async function handleInboundToSystemAgent(ctx: DeliveryCtx, params: InboundToSystemAgentParams): Promise<void> {
  const { storage, config } = ctx;
  const { agentGaii, ownerGhii, conversationId, messageId } = params;
  try {
    const live = await systemAgentLiveness(storage, config, agentGaii);
    if (!live.isSystemAgent) return; // not a node-run system agent — nothing to do (external agents use the tunnel)

    // Load the triggering message (the agent owns its inbound copy for an own-agent DM). Only respond to a
    // genuine inbound message FROM the human owner — never to the agent's own messages (loop safety).
    const msg = await storage.getDirectMessage(messageId, agentGaii).catch(() => null);
    if (!msg || msg.direction !== 'inbound') return;
    if (msg.senderGhii !== ownerGhii) return;            // only the owner-human drives their own agent
    if (msg.interactive?.role === 'questions') return;   // the agent asks; it doesn't answer its own questions

    const ownerName = parseGaiiLoose(agentGaii).owner;

    // Not usable right now → a one-line note instead of silence.
    if (live.status === 'offline') { await reply(ctx, agentGaii, ownerGhii, conversationId, NOTE_OFFLINE); return; }
    if (live.status === 'away') { await reply(ctx, agentGaii, ownerGhii, conversationId, NOTE_PAUSED); return; }

    // Case 1: the owner answered a clarify question this agent asked → ack + produce the deliverable live.
    if (msg.interactive?.role === 'answers') {
      const job = await findPendingClarifyJob(storage, ownerGhii, conversationId, msg.interactive.answersFor);
      if (job) {
        await reply(ctx, agentGaii, ownerGhii, conversationId, ACK_CLARIFY);
        await produceClarifyDeliverable(ctx, { ownerGhii, ownerName, agentGaii, job, answers: msg.interactive.answers });
      }
      return; // an answer with no pending job isn't a request to reply to
    }

    // Case 2: a plain DM → a concise AI reply grounded in the agent's brain + recent thread.
    await replyWithAi(ctx, { agentGaii, ownerGhii, ownerName, conversationId, message: msg, displayName: live.record?.displayName || ownerName });
  } catch (err) {
    logger.warn('[system-agent-responder] failed', { agentGaii, error: (err as Error).message });
  }
}

/** Send a plain note back into the thread, AS the agent. */
async function reply(ctx: DeliveryCtx, agentGaii: string, ownerGhii: string, conversationId: string, body: string): Promise<void> {
  await sendDirectMessage(ctx, { senderGhii: agentGaii, recipientGhii: ownerGhii, conversationId, body, skipContactGate: true })
    .catch((err) => logger.warn('[system-agent-responder] reply failed', { agentGaii, error: (err as Error).message }));
}

/** Build the agent's "brain" (purpose + rules) for the reply system prompt: Secretary → its active
 *  context brain; otherwise → the agent's directives. Either may be empty. */
async function loadBrain(ctx: DeliveryCtx, agentGaii: string, ownerGhii: string): Promise<{ purpose: string; rules: string[] }> {
  const { storage } = ctx;
  const agentName = parseGaiiLoose(agentGaii).agent;
  if (agentName === 'secretary' || agentName.startsWith('secretary-')) {
    const rec = await storage.getMemory(ownerGhii, 'secretary.config').catch(() => null);
    const cfg = (rec?.value ?? {}) as { activeContextId?: string; contexts?: Array<{ id?: string; brain?: { purpose?: string; rules?: Array<{ description?: string }> } }> };
    const contexts = Array.isArray(cfg.contexts) ? cfg.contexts : [];
    const active = contexts.find((c) => c.id === cfg.activeContextId) || contexts[0];
    return { purpose: active?.brain?.purpose || '', rules: (active?.brain?.rules || []).map((r) => r.description || '').filter(Boolean) };
  }
  const dir = await storage.getAgentDirectives(agentGaii).catch(() => null);
  return { purpose: dir?.purpose || '', rules: (dir?.rules || []).map((r) => r.description || '').filter(Boolean) };
}

interface ReplyWithAiParams {
  agentGaii: string; ownerGhii: string; ownerName: string; conversationId: string;
  message: DirectMessageRecord; displayName: string;
}

async function replyWithAi(ctx: DeliveryCtx, p: ReplyWithAiParams): Promise<void> {
  const { storage, config } = ctx;
  const { agentGaii, ownerGhii, ownerName, conversationId, message, displayName } = p;

  const brain = await loadBrain(ctx, agentGaii, ownerGhii);
  const rules = brain.rules.map((r) => `- ${r}`).join('\n');
  const systemPrompt = `You are ${ownerName}'s ${displayName}.\n${brain.purpose || ''}\n\nOperating rules:\n${rules || '(none)'}\n\nYou are replying to a direct message from ${ownerName} in your shared inbox. Reply concisely and helpfully, in the owner's language. If a request needs information you don't have, ask for it; if you can't do something, say so plainly and suggest the next step. Output only your reply.`;

  // Recent thread (oldest→newest) for context, excluding the just-arrived message (added explicitly below).
  const thread = await storage.listAgentDmThread(agentGaii, conversationId, { perPage: CONTEXT_MESSAGES + 1 }).catch(() => null);
  const recent = (thread?.messages || [])
    .filter((m) => m.id !== message.id && (m.body || '').trim())
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-CONTEXT_MESSAGES)
    .map((m) => `${m.senderGhii === ownerGhii ? ownerName : displayName}: ${m.body}`)
    .join('\n');

  const prompt = `${recent ? `Recent conversation:\n${recent}\n\n` : ''}${ownerName} just sent:\n${message.body}\n\nWrite your reply.`;

  let body: string;
  try {
    const r = await completeForOwner(storage, config, ownerGhii, { prompt, systemPrompt, appId: 'secretary-dm-reply' });
    body = (r?.content || '').trim();
    if (!body) return; // nothing to say
  } catch (err) {
    logger.warn('[system-agent-responder] ai reply failed', { agentGaii, error: (err as Error).message });
    body = '⚠️ I hit a problem generating a reply just now. Please try again in a moment.';
  }
  await reply(ctx, agentGaii, ownerGhii, conversationId, body);
}
