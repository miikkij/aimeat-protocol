/**
 * @file src/services/feedback.ts
 * @description Node Feedback Channel core logic, shared by the REST routes (src/routes/feedback.ts)
 *   and the MCP tools (src/mcp/feedback.ts) so both surfaces validate and behave identically.
 *   Authenticated principals (GHII/GAII/GEAI) open platform-feedback threads to the node operator;
 *   the operator triages and replies in the same thread. A `blocker` thread additionally fires a
 *   bell + web-push notification to the operator (best-effort, never blocks the create).
 * @structure
 *   - size caps (title/body/messages/context) + input validation
 *   - createFeedbackThread() — validate, persist, notify operator on blocker
 *   - replyToFeedback() — sender/operator reply with ownership check (404-style null on foreign)
 *   - findOperatorGhii() — resolve the node operator's GHII for notifications
 * @usage const result = await createFeedbackThread(storage, config, { sender, category, ... });
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial: Node Feedback Channel v1.
 */
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, FeedbackRecord, FeedbackMessage } from '../storage/interface.js';
import { FEEDBACK_CATEGORIES } from '../storage/interface.js';
import { notify } from './notify.js';
import { emitChange } from './event-bus.js';

export const FEEDBACK_TITLE_MAX = 200;
export const FEEDBACK_BODY_MAX = 8000;
export const FEEDBACK_MAX_MESSAGES = 50;
const CONTEXT_MAX_KEYS = 8;
const CONTEXT_KEY_MAX = 50;
const CONTEXT_VALUE_MAX = 500;

export type FeedbackResult =
  | { ok: true; record: FeedbackRecord }
  | { ok: false; code: 'VALIDATION_ERROR' | 'NOT_FOUND' | 'LIMIT_REACHED'; message: string };

export interface CreateFeedbackInput {
  sender: string;               // RESOLVED principal id (resolveIdentity / agent GAII)
  category: string;
  title: string;
  body: string;
  context?: unknown;
}

/** Sanitize the optional free-form context down to a small flat string→string map. */
function sanitizeContext(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val !== 'string' || !val.trim()) continue;
    if (n >= CONTEXT_MAX_KEYS) break;
    out[k.slice(0, CONTEXT_KEY_MAX)] = val.slice(0, CONTEXT_VALUE_MAX);
    n++;
  }
  return n > 0 ? out : undefined;
}

/** Resolve the node operator's GHII (owner@node) for notifications, or null when absent. */
export async function findOperatorGhii(storage: Storage, config: AimeatConfig): Promise<string | null> {
  const owners = await storage.listOwners();
  const op = owners.find((o) => o.roles?.includes('operator'));
  return op ? `${op.name}@${config.nodeId}` : null;
}

/** Create a new feedback thread; a `blocker` also notifies the operator (bell + push, best-effort). */
export async function createFeedbackThread(
  storage: Storage, config: AimeatConfig, input: CreateFeedbackInput,
): Promise<FeedbackResult> {
  const category = String(input.category ?? '').trim();
  const title = String(input.title ?? '').trim();
  const body = String(input.body ?? '').trim();
  if (!(FEEDBACK_CATEGORIES as readonly string[]).includes(category)) {
    return { ok: false, code: 'VALIDATION_ERROR', message: `Invalid category: "${category}". Must be one of: ${FEEDBACK_CATEGORIES.join(', ')}` };
  }
  if (!title || title.length > FEEDBACK_TITLE_MAX) {
    return { ok: false, code: 'VALIDATION_ERROR', message: `title is required, max ${FEEDBACK_TITLE_MAX} chars` };
  }
  if (!body || body.length > FEEDBACK_BODY_MAX) {
    return { ok: false, code: 'VALIDATION_ERROR', message: `body is required, max ${FEEDBACK_BODY_MAX} chars` };
  }

  const now = new Date().toISOString();
  const record = await storage.createFeedback({
    id: `fb-${randomBytes(8).toString('hex')}`,
    sender: input.sender,
    category: category as FeedbackRecord['category'],
    title, body,
    context: sanitizeContext(input.context),
    status: 'new',
    messages: [],
    createdAt: now,
    updatedAt: now,
  });

  if (category === 'blocker') {
    const operator = await findOperatorGhii(storage, config);
    if (operator) {
      await notify(storage, operator, {
        type: 'feedback_blocker',
        title: `Blocker reported: ${title.slice(0, 80)}`,
        body: `${input.sender}: ${body.slice(0, 160)}`,
        link: '/v1/admin?tab=feedback',
      });
    }
  }

  emitChange('feedback');
  return { ok: true, record };
}

export interface ReplyFeedbackInput {
  id: string;
  /** RESOLVED principal id of the caller. */
  actor: string;
  isOperator: boolean;
  body: string;
}

/**
 * Append a reply to a thread. The sender may reply to their own thread; the operator to any.
 * A foreign thread returns NOT_FOUND (no existence disclosure). An operator reply on a `new`
 * thread bumps it to `ack` — replying IS acknowledging.
 */
export async function replyToFeedback(storage: Storage, input: ReplyFeedbackInput): Promise<FeedbackResult> {
  const body = String(input.body ?? '').trim();
  if (!body || body.length > FEEDBACK_BODY_MAX) {
    return { ok: false, code: 'VALIDATION_ERROR', message: `body is required, max ${FEEDBACK_BODY_MAX} chars` };
  }
  const record = await storage.getFeedback(input.id);
  if (!record || (!input.isOperator && record.sender !== input.actor)) {
    return { ok: false, code: 'NOT_FOUND', message: 'Feedback thread not found' };
  }
  if (record.messages.length >= FEEDBACK_MAX_MESSAGES) {
    return { ok: false, code: 'LIMIT_REACHED', message: `Thread is at its ${FEEDBACK_MAX_MESSAGES}-message cap` };
  }
  const from: FeedbackMessage['from'] = input.isOperator && record.sender !== input.actor ? 'operator' : 'sender';
  const now = new Date().toISOString();
  const updated = await storage.updateFeedback(input.id, {
    messages: [...record.messages, { from, body, at: now }],
    ...(from === 'operator' && record.status === 'new' ? { status: 'ack' as const } : {}),
    updatedAt: now,
  });
  if (!updated) return { ok: false, code: 'NOT_FOUND', message: 'Feedback thread not found' };
  emitChange('feedback');
  return { ok: true, record: updated };
}
