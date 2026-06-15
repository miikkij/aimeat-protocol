/**
 * @file ecosystem-automation-notify.ts
 * @description Feature B6 — "email the report on completion" for ecosystem-app automation recipes.
 *   When an agent task that was materialised by an automation recipe (its `automation` provenance is
 *   set, see B5/ecosystem-automation.ts) transitions to DONE, and the recipe had `email:true`, this
 *   notifies the OWNER with a short report: the app, the recipe, an excerpt of what the agent produced,
 *   and a link to the deliverable / organism / task.
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
 */
import type { Storage, AgentTaskRecord, MemoryRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { getActiveEmailService } from './email.js';
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

    const subject = `AIMEAT: ${auto.app} report from ${agentName}`;
    const portalBase = (config.baseUrl ?? '').replace(/\/$/, '');
    const taskLink = portalBase ? `${portalBase}/v1/profile#agents` : '';
    const organismLine = auto.organism
      ? `\nOrganism: ${auto.organism}`
      : '';
    const deliverableLine = task.deliverableKey
      ? `\nDeliverable key: ${task.deliverableKey} (under ${task.agentGaii})`
      : '';
    const bodyText =
      `Your automation for the connected app "${auto.app}" finished.\n\n` +
      `Agent: ${agentName}\nTask: ${task.title}` +
      organismLine + deliverableLine + `\n\n` +
      (completionMessage ? `Summary: ${completionMessage}\n\n` : '') +
      (deliverableExcerpt ? `Report excerpt:\n${deliverableExcerpt}\n\n` : '') +
      `View it: ${taskLink || '(open your AIMEAT profile → Agents)'}`;

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
