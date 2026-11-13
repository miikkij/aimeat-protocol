/**
 * @file src/services/task-result-delivery.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node hands a finished task's result to its owner itself, for a task made by an
 *   agent_task schedule that says `deliver: "owner"` (services/schedule-write.ts). The scheduler stamps
 *   that on the task as one scope entry (DELIVERY_SCOPE, services/scheduler-agent-task.ts) for the agent
 *   to read, and the completion fan-out (services/agent/task-fanout.ts) calls deliverTaskResult(). The
 *   decision is the schedule's own record (deliveringSchedule), never the scope entry: a task's scope
 *   is written by its agent too.
 *
 *   AS THE AGENT. The bell entry names the agent as its sender, so the owner's settings for that agent
 *   (mute included) apply, and the email goes through notification-create.ts mailOwnerFrom: only to a
 *   verified address, within the same per-sender daily limit as the agent's own mailed notices.
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
 *   deliveringSchedule(storage, task) · deliverTaskResult(storage, config, task, message)
 * @usage void deliverTaskResult(storage, config, task, message).catch(…);
 * @version-history
 *   2026-11-04 — The running mail service is read from nodeContext() (services/node-context.ts) in place of
 *     getActiveEmailService (codebase analysis 2026-11-03, item D-i).
 *   v1.1.1 — 2026-11-03 — When the agent has used today's mail limit, the bell entry says the result was
 *     not mailed, what the limit is and which Config setting the operator changes (secaudit2026nov02d
 *     round 13b).
 *   v1.1.0 — 2026-11-02 — The schedule's record decides delivery, not the task's scope entry, which the
 *     task's agent may write. The bell entry is the agent's (its mute applies), and the email goes only
 *     to a verified address within the per-sender daily limit (mailOwnerFrom); an unverified address
 *     gets no mail and the bell says where to confirm it (secaudit2026nov02d round 13,
 *     DELIVERY_SCOPE:client-supplied-task-scope and deliverTaskResult:unverified-notification-email).
 *   v1.0.2 — 2026-11-02 — The bell's excerpt is plain text: the bell does not render Markdown, and it showed
 *     "**…**" and "*…" (c9's crew67 round); the email keeps the Markdown.
 *   v1.0.1 — 2026-11-02 — The heading's date in English is en-GB when the person set no region.
 *   v1.0.0 — 2026-11-02 — Initial. The agent's notify tool is taken out when a schedule asks for
 *     delivery (services/delivery-crew.ts).
 */
import type { Storage, AgentTaskRecord, AgentTaskScope, MemoryRecord, ScheduledJobRecord } from '../storage/interface.js';
import { systemReader } from './classification/reader.js';
import { memoryTarget } from './classification/labels.js';
import type { AimeatConfig } from '../config.js';
import { notify } from './notify.js';
import { nodeContext } from './node-context.js';
import { mailOwnerFrom, ownerMailLimitReached } from './notification-create.js';
import { notificationEmailUnverified } from './owner-mail-address.js';
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
 * on their own clock, else the schedule's, else the language of their place. English without a region
 * of its own is en-GB (2/11/2026), as the SPA writes it: Intl's bare 'en' is the US 11/2/2026, which an
 * EU reader takes for 11 February (c9's crew67 round, 2.11). A region the person chose still wins.
 */
function dayOf(prefs: DisplayPrefs, iso: string, locale: string, timezone?: string): string {
  return formatForPerson(
    { ...prefs, region: prefs.region ?? (locale === 'en' ? 'en-GB' : locale), timezone: prefs.timezone ?? timezone ?? null },
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

/**
 * The result as the bell shows it, which is plain text: emphasis, code marks and heading marks come
 * off, and a link keeps its words. List numbers and line breaks stay, so the excerpt still reads as a
 * list. The email carries the Markdown as written.
 */
export function plainText(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,:;!?]|$)/gm, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[ \t]+\n/g, '\n');
}

/** The body with a leading heading line (Markdown # or a whole **bold** line) taken off. */
function withoutHeading(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  const first = (lines[0] ?? '').trim();
  if (/^#{1,6}\s/.test(first) || /^\*\*[^*]+\*\*$/.test(first)) lines.shift();
  return lines.join('\n').trim();
}

/**
 * The schedule that asked the node to deliver this task's result, or null. Read from the node's own
 * records, never from the task's scope, which its agent may write (PATCH and the self-create door):
 * the task must be one no principal's door made (every door records its creator in `createdBy`,
 * services/agent/task-write.ts; the scheduler records none), its parent must be an agent_task
 * schedule of the same agent and owner, and that schedule must say `deliver: "owner"` now.
 */
export async function deliveringSchedule(storage: Storage, task: AgentTaskRecord): Promise<ScheduledJobRecord | null> {
  if (task.createdBy || !task.parentTaskId) return null;
  const job = await storage.getScheduledJob(task.parentTaskId).catch((err: Error) => {
    logger.warn(`[delivery] the schedule of task ${task.id} could not be read: ${err.message}`);
    return null;
  });
  if (!job || job.type !== 'agent_task' || job.agentGaii !== task.agentGaii || job.ownerScope !== task.ownerGaii) return null;
  const tmpl = (job.input as { taskTemplate?: { deliver?: unknown } } | undefined)?.taskTemplate;
  return tmpl?.deliver === 'owner' ? job : null;
}

/** The line the bell adds when the result was not mailed because the address is not confirmed. */
const UNVERIFIED_LINE: Record<string, string> = {
  en: 'Not emailed: confirm your email address on the Email page of your profile.',
  fi: 'Tätä ei lähetetty sähköpostilla: vahvista sähköpostiosoitteesi profiilisi Sähköposti-sivulla.',
  es: 'No se envió por correo: confirma tu dirección en la página Correo de tu perfil.',
};

/** The line the bell adds when the agent has already used today's mail limit (email.reports_per_sender_day). */
const LIMIT_LINE: Record<string, (agent: string, n: number) => string> = {
  en: (agent, n) => `Not emailed: ${agent} has already sent ${n} emails today, the most this server sends from one agent in a day. `
    + 'Every result still comes here. The server\'s operator can change the limit under Admin, Config: "Emails per agent or app in a day" (0 means no limit).',
  fi: (agent, n) => `Tätä ei lähetetty sähköpostilla: ${agent} on lähettänyt tänään jo ${n} sähköpostia, ja tämä palvelin lähettää yhdeltä agentilta enintään sen verran päivässä. `
    + 'Jokainen tulos tulee silti tänne. Palvelimen ylläpitäjä voi muuttaa rajaa ylläpidon asetuksista (Config): "Sähköposteja agenttia tai sovellusta kohden päivässä" (0 poistaa rajan).',
  es: (agent, n) => `No se envió por correo: ${agent} ya envió ${n} correos hoy, el máximo que este servidor envía de un agente en un día. `
    + 'Cada resultado sigue llegando aquí. El operador del servidor puede cambiar el límite en Admin, Config: "Correos por agente o aplicación al día" (0 quita el límite).',
};

/** Hand a scheduled task's result to its owner, when its schedule said so. Never throws. */
export async function deliverTaskResult(
  storage: Storage, config: AimeatConfig, task: AgentTaskRecord, message?: string,
): Promise<void> {
  try {
    const job = await deliveringSchedule(storage, task);
    if (!job) return;
    const entry = (task.scope ?? []).find((s) => s.name === DELIVERY_SCOPE && s.value === 'owner');
    const result = await resultOf(storage, task, message);
    const body = withoutHeading(result.text).slice(0, MAX_BODY);
    const bellText = plainText(body);
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
    const heading = `${task.title} – ${dayOf(prefs, task.completedAt ?? task.createdAt, locale, job.timezone ?? (entry ? zoneOf(entry) : undefined))}`;
    const mail = nodeContext().email;
    // The result is mailed only to an address the owner confirmed (owner-mail-address.ts). When the
    // address is not confirmed, the bell says so and where to confirm it.
    const unverified = !!mail?.enabled && notificationEmailUnverified(ghii);
    const excerpt = bellText.length > BELL_EXCERPT ? `${bellText.slice(0, BELL_EXCERPT)}…` : bellText;

    // The agent's result, sent as that agent (notification-create.ts names an agent the same way): the
    // owner's settings for that agent apply, mute included, as they do to its own notices.
    const agentName = task.agentGaii.includes('#') ? task.agentGaii.split('#')[0] : task.agentGaii;
    const source = { kind: 'agent' as const, name: agentName, id: task.agentGaii };
    // A mail this result would have caused past the agent's daily limit: the bell says so and why.
    const limitHit = !!mail?.enabled && !unverified && !!ghii?.notificationEmail
      ? ownerMailLimitReached(config, ownerGhii, `${source.kind}:${source.id}`) : 0;
    const note = unverified ? (UNVERIFIED_LINE[locale] ?? UNVERIFIED_LINE.en)
      : limitHit ? (LIMIT_LINE[locale] ?? LIMIT_LINE.en)(agentName, limitHit) : '';
    const told = await notify(storage, ownerGhii, {
      type: 'agent_result', title: heading,
      body: note ? `${excerpt}\n\n${note}` : excerpt,
      link: `/v1/profile?tab=agents&task=${encodeURIComponent(task.id)}`,
      source,
    });
    if (told.muted) {
      logger.info(`[delivery] task ${task.id}: the owner muted ${agentName}, so neither the bell nor the email`);
      return;
    }

    if (!mail?.enabled || !ghii?.notificationEmail) {
      logger.info(`[delivery] task ${task.id}: in the bell only (${!mail?.enabled ? 'no mail on this node' : 'the owner has no notification address'})`);
      return;
    }
    if (!await mayEmail(storage, config, ownerGhii, result.record)) {
      logger.info(`[delivery] task ${task.id}: in the bell only (its classification keeps it inside the node)`);
      return;
    }
    // The same path, address check and per-sender daily limit as the agent's own mailed notices.
    const sent = await mailOwnerFrom(storage, config, ownerGhii, `${source.kind}:${source.id}`, heading, body);
    if (sent !== 'sent') logger.info(`[delivery] task ${task.id}: the email was not sent (${sent})`);
  } catch (err) {
    // Never in the way of a completion: the result is on the task either way.
    logger.error('[delivery] delivering a task result failed', { taskId: task.id, error: String(err) });
  }
}
