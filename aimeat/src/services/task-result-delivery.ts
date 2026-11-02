/**
 * @file src/services/task-result-delivery.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node hands a finished task's result to its owner itself, for a task made by an
 *   agent_task schedule that says `deliver: "owner"` (services/schedule-write.ts). The scheduler stamps
 *   that on the task as one scope entry (DELIVERY_SCOPE, services/scheduler-agent-task.ts), and the
 *   completion fan-out (services/agent-task-fanout.ts) calls deliverTaskResult().
 *
 *   WHY THE NODE AND NOT THE MODEL. The morning digest a store place offers on the first visit was to be
 *   sent by the agent with its notify tool. On the test lane (guestkoey3wfwk, crew63, 2.11) the model
 *   made one tool call, the news, wrote "sent as the morning digest" in its answer, and sent nothing;
 *   it also wrote October in a November date it had been given. A promise the person reads on the home
 *   ("it comes to your email") cannot rest on whether a model remembers a tool, so the node keeps it.
 *
 *   WHAT IS SENT. The task's deliverable (the record its deliverableKey names, under the agent), else
 *   the completion message. A leading heading line is replaced by the node's own: the task's title and
 *   the date in the schedule's time zone, written by the node, never by the model. Into the bell
 *   (services/notify.ts, push included) always, and by email to the owner's notification address when
 *   the node sends mail, the owner has one, and the deliverable's classification lets it leave the node
 *   (the same leave() check the automation report makes). A result with no words sends nothing.
 * @structure DELIVERY_SCOPE · deliveryScopeEntry(timezone) · withDeliver(kind, input, deliver) ·
 *   deliverTaskResult(storage, config, task, message)
 * @usage void deliverTaskResult(storage, config, task, message).catch(…);
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial. The agent's notify tool is taken out when a schedule asks for
 *     delivery (services/delivery-crew.ts).
 */
import type { Storage, AgentTaskRecord, AgentTaskScope, MemoryRecord } from '../storage/interface.js';
import { systemReader } from './classification/reader.js';
import { memoryTarget } from './classification/labels.js';
import type { AimeatConfig } from '../config.js';
import { notify } from './notify.js';
import { getActiveEmailService } from './email.js';
import { displayPrefsFor, formatForPerson, type DisplayPrefs } from './display-prefs.js';
import { logger } from '../utils/logger.js';

/** The scope entry's name that marks a task whose result the node delivers to the owner. */
export const DELIVERY_SCOPE = 'deliver';
/** How much of the result the bell shows; the email carries it whole. */
const BELL_EXCERPT = 280;
/** The most of a result an email carries. */
const MAX_BODY = 20_000;

/** The scope entry a scheduled task carries when its result goes to the owner. */
export function deliveryScopeEntry(timezone?: string): AgentTaskScope {
  return {
    name: DELIVERY_SCOPE, value: 'owner', type: 'text',
    description: `The node sends this task's result to its owner when it is done${timezone ? ` (${timezone})` : ''}.`,
  };
}

/**
 * A schedule's input with `deliver` set: 'owner' (the node hands each finished task's result over) or
 * 'none' (the agent alone), on an agent_task schedule only. The rest of the input stays as it was.
 */
export function withDeliver(kind: string, input: unknown, deliver: unknown):
  { ok: true; input: Record<string, unknown> } | { ok: false; message: string } {
  if (kind !== 'agent_task' || (deliver !== 'owner' && deliver !== 'none')) {
    return { ok: false, message: 'deliver is "owner" or "none", on an agent_task schedule only.' };
  }
  const cur = (input && typeof input === 'object' ? input : {}) as { taskTemplate?: Record<string, unknown> };
  const { deliver: _old, ...tmpl } = cur.taskTemplate ?? {};
  void _old;
  return { ok: true, input: { ...cur, taskTemplate: { ...tmpl, ...(deliver === 'owner' ? { deliver: 'owner' } : {}) } } };
}

/** The time zone the schedule ran in, from the delivery entry, or undefined. */
function zoneOf(entry: AgentTaskScope): string | undefined {
  const m = /\(([A-Za-z_]+(?:\/[A-Za-z_+-]+)*)\)\.$/.exec(entry.description ?? '');
  return m?.[1];
}

/**
 * The day the task ran ("2.11.2026"), the way this person writes dates (services/display-prefs.ts),
 * on their own clock, else the schedule's, else the language of their place.
 */
function dayOf(prefs: DisplayPrefs, iso: string, locale: string, timezone?: string): string {
  return formatForPerson(
    { ...prefs, region: prefs.region ?? locale, timezone: prefs.timezone ?? timezone ?? null },
    iso, { day: 'numeric', month: 'numeric', year: 'numeric' },
  );
}

/** A record's value as text, or ''. */
function textOf(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['text', 'output', 'result', 'content', 'body']) if (typeof o[k] === 'string' && (o[k] as string).trim()) return o[k] as string;
  }
  return '';
}

/**
 * The result: the deliverable record when it has words (with the record, which the email's
 * classification check needs), else the completion message.
 */
async function resultOf(storage: Storage, task: AgentTaskRecord, message?: string): Promise<{ text: string; record: MemoryRecord | null }> {
  if (task.deliverableKey) {
    const rec = await storage.getMemory(task.agentGaii, task.deliverableKey).catch((err: Error) => {
      logger.warn(`[delivery] the deliverable of task ${task.id} could not be read: ${err.message}`);
      return null;
    });
    const text = textOf(rec?.value);
    if (rec && text.trim()) return { text, record: rec };
  }
  return { text: typeof message === 'string' ? message : '', record: null };
}

/**
 * Whether the deliverable may leave the node by email: the classification check every report that
 * quotes a record makes (services/classification, as ecosystem-automation-notify.ts does). A
 * completion message is the agent's own words to the owner and has no record to label.
 */
async function mayEmail(storage: Storage, config: AimeatConfig, ownerGhii: string, record: MemoryRecord | null): Promise<boolean> {
  if (!record) return true;
  const out = await systemReader({ storage, config }, ownerGhii)
    .leave([record], (r) => memoryTarget(r.ownerGaii, r.key), { kind: 'external', to: `email:${ownerGhii}` });
  for (const l of out.left) logger.info(`[delivery] ${l.item.key} stays out of the email: ${l.label} (${l.reason})`);
  return out.kept.length > 0;
}

/** The body with a leading heading line (Markdown # or a whole **bold** line) taken off. */
function withoutHeading(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  const first = (lines[0] ?? '').trim();
  if (/^#{1,6}\s/.test(first) || /^\*\*[^*]+\*\*$/.test(first)) lines.shift();
  return lines.join('\n').trim();
}

/** Hand a scheduled task's result to its owner, when its schedule said so. Never throws. */
export async function deliverTaskResult(
  storage: Storage, config: AimeatConfig, task: AgentTaskRecord, message?: string,
): Promise<void> {
  try {
    const entry = (task.scope ?? []).find((s) => s.name === DELIVERY_SCOPE && s.value === 'owner');
    if (!entry) return;
    const result = await resultOf(storage, task, message);
    const body = withoutHeading(result.text).slice(0, MAX_BODY);
    if (!body) {
      logger.warn(`[delivery] task ${task.id} finished with no result to deliver`);
      return;
    }
    const ownerGhii = task.ownerGaii;
    const ghii = await storage.getGHII(ownerGhii).catch((err: Error) => {
      logger.warn(`[delivery] the owner of task ${task.id} could not be read: ${err.message}`);
      return null;
    });
    const locale = ghii?.locale || config.siteLinks?.defaultLocale || 'en';
    const prefs = await displayPrefsFor(storage, ownerGhii);
    const heading = `${task.title} – ${dayOf(prefs, task.completedAt ?? task.createdAt, locale, zoneOf(entry))}`;

    await notify(storage, ownerGhii, {
      type: 'agent_result', title: heading,
      body: body.length > BELL_EXCERPT ? `${body.slice(0, BELL_EXCERPT)}…` : body,
      link: `/v1/profile?tab=agents&task=${encodeURIComponent(task.id)}`,
    });

    const mail = getActiveEmailService();
    if (!mail?.enabled || !ghii?.notificationEmail) {
      logger.info(`[delivery] task ${task.id}: in the bell only (${!mail?.enabled ? 'no mail on this node' : 'the owner has no notification address'})`);
      return;
    }
    if (!await mayEmail(storage, config, ownerGhii, result.record)) {
      logger.info(`[delivery] task ${task.id}: in the bell only (its classification keeps it inside the node)`);
      return;
    }
    const sent = await mail.sendNotification(ghii.notificationEmail, heading, body);
    if (!sent) logger.warn(`[delivery] task ${task.id}: the email was not sent`);
  } catch (err) {
    // Never in the way of a completion: the result is on the task either way.
    logger.error('[delivery] delivering a task result failed', { taskId: task.id, error: String(err) });
  }
}
