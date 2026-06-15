/**
 * @file ecosystem-automation-advisories.ts
 * @description Features B7 (approval gate) + B8 (deliver an approved advisory to the app) for the
 *   ecosystem-app automation pipeline. After a wisdom agent runs (its automation task completes), it
 *   has written zero or more `support-advisory@1` payloads into the owner's namespace at the outbox
 *   keys `eco.<app>.advisory.outbox.<advisoryId>`. This module DRAINS that outbox in the same
 *   completion path the B6 report-notify hooks into (a sibling fire-and-forget call):
 *
 *     - If the recipe has `requireApproval: false` → DELIVER NOW: invoke the app's `deliver-advisory`
 *       capability over the connector tunnel with `{ advisory }`. On success delete the outbox key.
 *       On offline / capability-not-found / error → leave the outbox key in place so a later run (or a
 *       manual retry) can deliver it, and log; never throw.
 *     - If the recipe has `requireApproval: true` → GATE: move the advisory from the outbox to a
 *       pending key `eco.<app>.advisory.pending.<advisoryId>` (so the payload survives until the owner
 *       decides) carrying `{ kind:'advisory-delivery', app, recipeId, advisory, status:'pending' }`,
 *       then delete the outbox key. The owner approves/rejects via the ecosystem-apps routes
 *       (POST /v1/ecosystem-apps/:app/advisories/:id/approve | /reject). Approval invokes the same
 *       `deliver-advisory` capability; rejection drops the advisory. Both clean up the pending key.
 *
 *   The pending surface reuses the EXISTING ecosystem-apps owner surface (the same place the owner
 *   already lists pending app integrations and per-app data) backed by owner-namespace memory — it is
 *   NOT a new approval inbox subsystem. The delivery reuses the EXACT eco-capability tunnel path the
 *   schedule executor uses (`getActiveConnectTunnelManager().invokeOnPrincipal(geai, {...})`).
 *
 *   Best-effort + fully isolated: every failure here is logged and swallowed so it can never break the
 *   task-completion path that calls the drain.
 * @structure
 *   - processAutomationAdvisories(storage, config, task) — the drain entry point, called fire-and-forget
 *     from the agent-task /complete route, next to notifyAutomationTaskComplete.
 *   - deliverAdvisory(config, app, ownerName, advisory) — the shared tunnel invocation (B8), reused by
 *     both the immediate-delivery path and the approve route.
 *   - outboxPrefix / pendingKey — the owner-namespace key conventions (the LOCKED contract).
 *   - PENDING_TYPE — the discriminator stored on a pending advisory-delivery record.
 * @usage
 *   import { processAutomationAdvisories, deliverAdvisory } from '../services/ecosystem-automation-advisories.js';
 *   void processAutomationAdvisories(storage, config, task);
 * @version-history
 *   v1.0.0 — 2026-06-15 — Created for B7 (approval gate) + B8 (deliver-advisory over the connector
 *     tunnel): drain the advisory outbox on automation-task completion, deliver or gate, and (for the
 *     gated path) park the payload on a pending key until the owner approves/rejects.
 */
import type { Storage, AgentTaskRecord, MemoryRecord, EcoAutomationRecipe } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { getActiveConnectTunnelManager } from './connect-tunnel.js';
import { buildGEAI } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

/** The discriminator stored on an `advisory-delivery` pending record (so the approve route knows it). */
export const PENDING_TYPE = 'advisory-delivery' as const;

/** Owner-namespace key prefix the wisdom agent writes its advisories to (the LOCKED contract). */
export function outboxPrefix(app: string): string {
  return `eco.${app}.advisory.outbox.`;
}

/** Owner-namespace key the gated advisory is parked at until the owner approves/rejects it. */
export function pendingKey(app: string, advisoryId: string): string {
  return `eco.${app}.advisory.pending.${advisoryId}`;
}

/** Owner-namespace prefix for the gated, awaiting-approval advisories of one app. */
export function pendingPrefix(app: string): string {
  return `eco.${app}.advisory.pending.`;
}

/** The shape parked on a pending advisory-delivery memory record. */
export interface PendingAdvisoryRecord {
  type: typeof PENDING_TYPE;
  id: string;
  app: string;
  recipeId: string | null;
  advisory: unknown; // a `support-advisory@1` payload
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  /** Set after an approve: did the delivery land, retry (offline), or fail? */
  delivery?: 'delivered' | 'offline-retry' | 'failed';
  deliveredId?: string | null;
}

/** A delivery attempt result, surfaced to callers (immediate drain logs it; approve route returns it). */
export type DeliveryOutcome =
  | { state: 'delivered'; deliveredId: string | null; status: string | null }
  | { state: 'offline-retry'; reason: string }
  | { state: 'failed'; reason: string };

/** Extract the advisory id from a payload (its `id`), falling back to the outbox key's last segment. */
function advisoryIdOf(advisory: unknown, fallbackKey: string): string {
  const id = (advisory as { id?: unknown })?.id;
  if (typeof id === 'string' && id.trim()) return id.trim();
  const seg = fallbackKey.split('.').pop();
  return seg && seg.trim() ? seg.trim() : `adv-${Date.now()}`;
}

/**
 * B8 — deliver one `support-advisory@1` payload into the app's guidance sink by invoking the app's
 * `deliver-advisory` capability over the connector tunnel. Reuses the EXACT path the schedule executor
 * uses (getActiveConnectTunnelManager + invokeOnPrincipal on the `eco:<app>#<owner>@<node>` principal).
 *
 * Returns a typed outcome instead of throwing so both callers (the immediate drain + the approve route)
 * can decide what to do with the outbox/pending key:
 *   - delivered     → the app accepted it; the caller should remove the source key.
 *   - offline-retry → the app isn't connected right now; the caller should LEAVE the key for a retry.
 *   - failed        → the app refused or errored; the caller should LEAVE the key (a later run retries).
 */
export async function deliverAdvisory(
  config: AimeatConfig,
  app: string,
  ownerName: string,
  advisory: unknown,
): Promise<DeliveryOutcome> {
  const mgr = getActiveConnectTunnelManager();
  if (!mgr) {
    return { state: 'offline-retry', reason: 'connect-tunnel unavailable' };
  }
  const geai = buildGEAI(app, ownerName, config.nodeId);
  const caller = `${ownerName}@${config.nodeId}`;
  try {
    const reply = await mgr.invokeOnPrincipal(geai, { capability: 'deliver-advisory', input: { advisory }, caller });
    if (!reply.ok) {
      return { state: 'failed', reason: `app "${app}" refused or failed deliver-advisory` };
    }
    const result = (reply.result ?? {}) as { delivered_id?: unknown; status?: unknown };
    const deliveredId = typeof result.delivered_id === 'string' ? result.delivered_id : null;
    const status = typeof result.status === 'string' ? result.status : null;
    return { state: 'delivered', deliveredId, status };
  } catch (err) {
    const code = (err as { code?: string }).code;
    // Offline at invoke time is a SKIP/RETRY, not a hard failure — leave the key for the next run.
    if (code === 'ECOSYSTEM_OFFLINE' || code === 'ECOSYSTEM_TIMEOUT') {
      return { state: 'offline-retry', reason: `app "${app}" ${code === 'ECOSYSTEM_OFFLINE' ? 'offline' : 'timed out'}` };
    }
    return { state: 'failed', reason: String(err) };
  }
}

/**
 * Drain the owner's advisory outbox for the app that produced this automation task. Called
 * fire-and-forget from the agent-task /complete route, as a sibling to notifyAutomationTaskComplete.
 *
 * Best-effort + fully isolated: any failure is logged and swallowed so it can never break task
 * completion. Does nothing for tasks not produced by an automation recipe.
 */
export async function processAutomationAdvisories(
  storage: Storage,
  config: AimeatConfig,
  task: AgentTaskRecord,
): Promise<void> {
  try {
    const auto = task.automation;
    if (!auto || !auto.recipeId || !auto.app) return;

    const app = auto.app;
    const ownerGhii = task.ownerGaii; // owner GHII (owner@node), set by materialiseAgentTask
    const ownerName = ownerGhii.split('@')[0];

    // Load the recipe so requireApproval reflects the owner's CURRENT setting (the task's stamped value
    // is a snapshot; prefer the live recipe, fall back to the snapshot if the recipe is gone).
    let recipe: EcoAutomationRecipe | null = null;
    try {
      recipe = await storage.getAutomationRecipe(ownerName, app);
    } catch (err) {
      logger.warn('advisory drain: recipe lookup failed, using task snapshot', { owner: ownerName, app, error: String(err) });
    }
    const requireApproval = recipe ? !!recipe.requireApproval : !!auto.requireApproval;
    const recipeId = recipe?.id ?? auto.recipeId;

    // List the owner's outbox entries for this app.
    let outbox: MemoryRecord[];
    try {
      outbox = await storage.listMemory(ownerGhii, { prefix: outboxPrefix(app) });
    } catch (err) {
      logger.error('advisory drain: outbox list failed', { owner: ownerName, app, error: String(err) });
      return;
    }
    if (!outbox.length) return;

    for (const rec of outbox) {
      const advisory = rec.value;
      const advisoryId = advisoryIdOf(advisory, rec.key);
      try {
        if (requireApproval) {
          // ── B7: gate — park the payload on a pending key so it survives until the owner decides. ──
          const now = new Date().toISOString();
          const pending: PendingAdvisoryRecord = {
            type: PENDING_TYPE,
            id: advisoryId,
            app,
            recipeId,
            advisory,
            status: 'pending',
            createdAt: now,
          };
          const pRecord: MemoryRecord = {
            key: pendingKey(app, advisoryId),
            ownerGaii: ownerGhii,
            value: pending,
            visibility: 'owner',
            tags: ['advisory-pending', app],
            ttlHours: null,
            version: 1,
            createdAt: now,
            updatedAt: now,
          };
          await storage.setMemory(pRecord);
          await storage.deleteMemory(ownerGhii, rec.key);
          logger.info('advisory gated for owner approval', { owner: ownerName, app, advisoryId });
        } else {
          // ── B8: no approval — deliver immediately over the tunnel. ──
          const outcome = await deliverAdvisory(config, app, ownerName, advisory);
          if (outcome.state === 'delivered') {
            await storage.deleteMemory(ownerGhii, rec.key);
            logger.info('advisory delivered to app', { owner: ownerName, app, advisoryId, deliveredId: outcome.deliveredId });
          } else {
            // offline-retry | failed → LEAVE the outbox key for a later run/manual retry.
            logger.warn('advisory delivery deferred (left in outbox for retry)', { owner: ownerName, app, advisoryId, outcome });
          }
        }
      } catch (err) {
        // One advisory failing must not stop the others or break task completion.
        logger.error('advisory drain: per-advisory handling failed (left in place)', { owner: ownerName, app, advisoryId, error: String(err) });
      }
    }
  } catch (err) {
    // Absolute isolation: B7/B8 must never break task completion.
    logger.error('processAutomationAdvisories failed (ignored)', { taskId: task.id, error: String(err) });
  }
}
