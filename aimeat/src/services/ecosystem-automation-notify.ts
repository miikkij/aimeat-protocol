/**
 * @file ecosystem-automation-notify.ts
 * @description Feature B6 — "email the report on completion" for ecosystem-app automation recipes.
 *   When an agent task that was materialised by an automation recipe (its `automation` provenance is
 *   set, see B5/ecosystem-automation.ts) transitions to DONE, and the recipe had `email:true`, this
 *   notifies the OWNER with a task-relevant report: the app, the agent, the task title, the organism it
 *   was routed to, a real summary of WHAT THE AGENT PRODUCED (a count + a short bulleted list of the
 *   `support-advisory@1` titles with their severity/kind, read from the owner's advisory outbox), an
 *   optional excerpt of the deliverable, and a link to the agent/tasks view. If the agent produced no
 *   advisories and published no deliverable, it degrades to the prior generic "finished" line.
 *
 *   Two channels, both best-effort and fully isolated (a failure here NEVER breaks task completion):
 *     1. In-app: always (when email:true) writes an `automation.reports.*` memory record under the
 *        owner's namespace, so the report is visible in the portal even with no SMTP configured. This
 *        is the SMTP-free observable surface the E2E asserts on.
 *     2. Email: if SMTP is configured AND the owner has a notification email on their GHII record,
 *        sends it via the shared EmailService. If email isn't configured, logs "email skipped (not
 *        configured)" and continues — never throws.
 *
 *   It reuses the node's existing EmailService (the process-wide handle from email.ts) and the generic
 *   memory store — it does not build a parallel notification system.
 * @structure
 *   - notifyAutomationTaskComplete(storage, config, task, completionMessage) — the entry point, called
 *     fire-and-forget from the agent-task /complete route.
 * @usage
 *   import { notifyAutomationTaskComplete } from '../services/ecosystem-automation-notify.js';
 *   void notifyAutomationTaskComplete(storage, config, task, message);
 * @version-history
 *   v1.0.0 — 2026-06-15 — Created for feature B6 (email + in-app report on automation-task completion).
 *   v1.1.0 — 2026-06-16 — Make the report task-relevant: read the agent's `support-advisory@1` payloads
 *     from the owner's outbox (eco.<app>.advisory.outbox.*) and include a count + capped bulleted list
 *     of titles (with severity/kind) in BOTH the email body and the in-app record; mention the routed
 *     organism in the "view it" line; persist advisoryCount/advisories/body on the report record.
 *     Degrades gracefully to the prior generic line when there are no advisories. Never throws.
 */
import type { Storage, AgentTaskRecord, MemoryRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { getActiveEmailService } from './email.js';
import { outboxPrefix } from './ecosystem-automation-advisories.js';
import { logger } from '../utils/logger.js';

/** Trim an arbitrary value to a short, human-readable excerpt for the report body. */
function excerpt(value: unknown, max = 600): string {
  let s: string;
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (!s) return '(no content)';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/** A normalised advisory line for the report body, pulled from a `support-advisory@1` payload. */
interface AdvisorySummary {
  title: string;
  severity: string | null;
  kind: string | null;
}

/** Map a severity to a small lead glyph so the plain-text report scans quickly (best-effort). */
function severityGlyph(severity: string | null): string {
  switch ((severity ?? '').toLowerCase()) {
    case 'critical':
    case 'high':
      return '🔴';
    case 'warning':
    case 'medium':
      return '⚠';
    case 'info':
    case 'low':
      return 'ℹ';
    default:
      return '•';
  }
}

/**
 * Read the agent's produced `support-advisory@1` payloads from the owner's outbox for this app and
 * normalise the human-readable bits (title/severity/kind). Best-effort: returns [] on any failure
 * (the outbox may already be drained by the sibling B7/B8 path, or empty). The B6 notify is fired
 * BEFORE the advisory drain in the completion route, so under normal scheduling it reads the outbox
 * before it is emptied; if it loses that race it simply falls back to the generic line.
 */
async function readAdvisorySummaries(
  storage: Storage,
  ownerGhii: string,
  app: string,
): Promise<AdvisorySummary[]> {
  let outbox: MemoryRecord[];
  try {
    outbox = await storage.listMemory(ownerGhii, { prefix: outboxPrefix(app) });
  } catch {
    return [];
  }
  const out: AdvisorySummary[] = [];
  for (const rec of outbox) {
    const v = (rec.value ?? {}) as { title?: unknown; severity?: unknown; kind?: unknown };
    const title = typeof v.title === 'string' && v.title.trim() ? v.title.trim() : null;
    if (!title) continue; // skip records without a human-readable title
    out.push({
      title,
      severity: typeof v.severity === 'string' && v.severity.trim() ? v.severity.trim() : null,
      kind: typeof v.kind === 'string' && v.kind.trim() ? v.kind.trim() : null,
    });
  }
  return out;
}

/** Build the bulleted advisory block (capped) shown in both the email + in-app report. */
function renderAdvisoryBlock(advisories: AdvisorySummary[], cap = 8): string {
  if (!advisories.length) return '';
  const shown = advisories.slice(0, cap);
  const lines = shown.map((a) => {
    const sev = a.severity ? ` (${a.severity})` : '';
    const kind = a.kind ? ` [${a.kind}]` : '';
    return `  ${severityGlyph(a.severity)} ${a.title}${sev}${kind}`;
  });
  const more = advisories.length > cap ? `\n  …and ${advisories.length - cap} more` : '';
  const noun = advisories.length === 1 ? 'advisory' : 'advisories';
  return `${advisories.length} ${noun}:\n${lines.join('\n')}${more}`;
}

/**
 * Notify the owner that an automation-recipe task completed. Best-effort + isolated: any failure is
 * logged and swallowed so it can never break the task-completion path that calls it. Does nothing
 * (returns early) for tasks not produced by an automation recipe, or whose recipe had email:false.
 */
export async function notifyAutomationTaskComplete(
  storage: Storage,
  config: AimeatConfig,
  task: AgentTaskRecord,
  completionMessage?: string,
): Promise<void> {
  try {
    const auto = task.automation;
    // Only act on automation-materialised tasks whose recipe asked for the report.
    if (!auto || auto.email !== true) return;

    const ownerGhii = task.ownerGaii; // owner GHII (owner@node), set by materialiseAgentTask
    const ownerName = ownerGhii.split('@')[0];
    const agentName = task.agentGaii.split('#')[0];

    // Pull the deliverable excerpt if the agent published one (best-effort).
    let deliverableExcerpt = '';
    if (task.deliverableKey) {
      try {
        const rec = await storage.getMemory(task.agentGaii, task.deliverableKey);
        if (rec) deliverableExcerpt = excerpt(rec.value);
      } catch { /* best-effort — the link still works */ }
    }

    // What the agent actually produced: its `support-advisory@1` payloads in the owner's outbox.
    // Read BEFORE the sibling advisory-drain empties it (B6 is fired first in the completion route).
    const advisories = await readAdvisorySummaries(storage, ownerGhii, auto.app);
    const advisoryBlock = renderAdvisoryBlock(advisories);

    const subject = advisories.length
      ? `AIMEAT: ${auto.app} — ${advisories.length} ${advisories.length === 1 ? 'advisory' : 'advisories'} from ${agentName}`
      : `AIMEAT: ${auto.app} report from ${agentName}`;
    const portalBase = (config.baseUrl ?? '').replace(/\/$/, '');
    const taskLink = portalBase ? `${portalBase}/v1/profile#agents` : '';
    const organismLine = auto.organism
      ? `\nOrganism: ${auto.organism}`
      : '';
    const deliverableLine = task.deliverableKey
      ? `\nDeliverable key: ${task.deliverableKey} (under ${task.agentGaii})`
      : '';
    const seeItLine = auto.organism
      ? `View it: ${taskLink || '(open your AIMEAT profile → Agents)'}  ·  Routed to organism "${auto.organism}".`
      : `View it: ${taskLink || '(open your AIMEAT profile → Agents)'}`;
    const bodyText =
      `Your automation for the connected app "${auto.app}" finished.\n\n` +
      `Agent: ${agentName}\nTask: ${task.title}` +
      organismLine + deliverableLine + `\n\n` +
      (advisoryBlock ? `What was produced — ${advisoryBlock}\n\n` : '') +
      (completionMessage ? `Summary: ${completionMessage}\n\n` : '') +
      (deliverableExcerpt ? `Report excerpt:\n${deliverableExcerpt}\n\n` : '') +
      seeItLine;

    // ── Channel 1: in-app report record (always, SMTP-free) ──
    // Visible in the portal regardless of email. Stored under the owner's namespace.
    const now = new Date().toISOString();
    const reportKey = `automation.reports.${auto.recipeId}.${Date.now()}`;
    const reportRecord: MemoryRecord = {
      key: reportKey,
      ownerGaii: ownerGhii,
      value: {
        type: 'automation-report',
        app: auto.app,
        recipeId: auto.recipeId,
        agent: agentName,
        agentGaii: task.agentGaii,
        taskId: task.id,
        title: task.title,
        organism: auto.organism ?? null,
        deliverableKey: task.deliverableKey ?? null,
        excerpt: deliverableExcerpt || null,
        message: completionMessage ?? null,
        // What the agent produced: the advisory count + the normalised title/severity/kind lines,
        // so the in-app report carries the same task-relevant content as the email body.
        advisoryCount: advisories.length,
        advisories: advisories.slice(0, 8),
        body: bodyText,
        emailed: false, // updated below if the email actually sent
        createdAt: now,
      },
      visibility: 'owner',
      tags: ['automation-report', auto.app],
      ttlHours: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await storage.setMemory(reportRecord);
      logger.info('automation report stored in-app', { owner: ownerName, recipe: auto.recipeId, key: reportKey });
    } catch (err) {
      logger.error('automation report in-app store failed', { owner: ownerName, recipe: auto.recipeId, error: String(err) });
    }

    // ── Channel 2: email (only if SMTP configured + owner opted in with an email) ──
    const emailSvc = getActiveEmailService();
    if (!emailSvc || !emailSvc.enabled) {
      logger.info('automation report email skipped (not configured)', { owner: ownerName, recipe: auto.recipeId });
      return;
    }
    let ownerEmail: string | undefined;
    try {
      const ghii = await storage.getGHII(ownerGhii);
      ownerEmail = ghii?.notificationEmail;
    } catch (err) {
      logger.warn('automation report: owner GHII lookup failed', { owner: ownerName, error: String(err) });
    }
    if (!ownerEmail) {
      logger.info('automation report email skipped (owner has no notification email)', { owner: ownerName, recipe: auto.recipeId });
      return;
    }
    const sent = await emailSvc.sendNotification(ownerEmail, subject, bodyText);
    if (sent) {
      logger.info('automation report email sent', { owner: ownerName, recipe: auto.recipeId });
      // Reflect that the email went out on the in-app record (best-effort).
      try {
        await storage.setMemory({ ...reportRecord, value: { ...(reportRecord.value as object), emailed: true }, version: 2, updatedAt: new Date().toISOString() });
      } catch { /* best-effort */ }
    } else {
      logger.warn('automation report email send returned false', { owner: ownerName, recipe: auto.recipeId });
    }
  } catch (err) {
    // Absolute isolation: B6 must never break task completion.
    logger.error('notifyAutomationTaskComplete failed (ignored)', { taskId: task.id, error: String(err) });
  }
}
