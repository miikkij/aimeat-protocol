/**
 * @file webhook-dispatcher.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Webhook delivery service for the AIMEAT push layer.
 *   Loads an agent's webhook configuration, validates the target URL,
 *   signs the payload with HMAC-SHA256, and fires HTTP POST with retry.
 *   Auto-disables webhooks after 10 consecutive failures.
 *   Logs every delivery attempt (success or failure) and prunes old entries.
 *
 * @structure
 *   - createWebhookDispatcher({ config, storage }) -- factory, returns { dispatchWebhookEvent }
 *   - dispatchWebhookEvent(agentGaii, event, data) -- main entry point
 *   - fireOnce(delivery, attemptNo) -- one signed POST; the retries run in the stored outbox (outbox.ts)
 *   - recordFinalFailure(delivery, attempts) -- every attempt failed
 *   - onSuccess(agentGaii) -- resets fail counter
 *   - onFailure(agentGaii, failCount) -- increments counter, auto-disables at threshold
 *   - logDelivery(agentGaii, event, payload, result) -- persists + prunes
 *
 * @usage
 *   import { createWebhookDispatcher } from '../services/webhook-dispatcher.js';
 *   const { dispatchWebhookEvent } = createWebhookDispatcher({ config, storage });
 *   await dispatchWebhookEvent('claude#alice@node', 'task.queued', { task_id: '...' });
 *
 * @maintenance Adding a new webhook event type:
 *   1. Define the payload schema in webhook-schemas.ts:
 *      - Add a Zod schema for the new event's `data` field
 *      - Use snake_case for all field names (vendor contract)
 *      - Include the standard envelope (version, event, timestamp, node_id, agent_gaii)
 *      - Document "Expected agent action" in a comment above the schema
 *   2. Add the event constant to WEBHOOK_EVENTS in webhook-schemas.ts
 *   3. Add the dispatch call in the relevant route handler:
 *      - Import dispatchWebhookEvent from webhook-dispatcher.ts
 *      - Call it AFTER the storage write succeeds, BEFORE res.json()
 *      - Pass the agent's GAII so the dispatcher can resolve webhook config
 *   4. Add MCP notification (parallel delivery):
 *      - In the same route handler, call mcpServer.notify() with the matching event name
 *      - MCP uses the same event name (e.g., 'notifications/tasks/failed')
 *   5. Update the skill bundle SKILL.md template:
 *      - Add the event to the "Events you may receive" list
 *      - Document the expected agent action
 *   6. Update openapi.yaml:
 *      - Add the event to the webhook events enum
 *      - Add the payload schema to components/schemas
 *   7. Update locales (en.json + fi.json):
 *      - Add delivery log display string for the event
 *   8. Add E2E test:
 *      - Test that the event fires on the correct trigger
 *      - Test payload shape matches schema
 *      - Test HMAC signature is valid
 *   9. Update this header's event list below.
 *
 *   Current event types (v1):
 *     task.queued, task.approved, task.updated, task.paused,
 *     message.inbound, directive.updated, onboarding.step
 *
 *   Versioning: new event types are non-breaking (v1 stays).
 *   Consumers MUST ignore unknown event types.
 *   See: docs/superpowers/specs/2026-05-23-agent-integration-architecture-design.md, Appendix A
 *
 * @version-history
 *   v1.5.0 -- 2026-11-08 -- An agent of a deactivated account gets no webhook; reactivation resumes
 *     delivery (secaudit2026nov08 round 14, older item O2).
 *   v1.4.0 -- 2026-11-04 -- The retries are kept in the stored outbox (services/outbox.ts), so a restart
 *     resumes them and a second process does not send them twice; schedule, log lines and delivery log
 *     unchanged (codebase analysis 2026-11-03, HA stage 1 item 1.5).
 *   2026-10-16 — Caught errors are logged with errorFields(err), so the line carries the message and the stack instead of {} (QA audit E1-04).
 *   v1.3.0 -- 2026-10-11 -- A stopped agent gets no task.queued, task.approved or message.inbound
 *     (./agent-stop-rules.ts); events about work in flight still go out.
 *   v1.2.0 -- 2026-09-06 -- Review item 4.2: dispatchWebhookEvent never rejects, and the delivery
 *     chain's own bookkeeping has a terminal catch. Fifteen call sites, one of which awaits.
 *   v1.0.0 -- 2026-05-23 -- Initial creation with retry, HMAC signing, auto-disable
 */

import { createHmac, randomUUID } from 'node:crypto';
import type { Storage, WebhookDeliveryLog } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { validateOutboundUrl, safeFetch } from '../utils/url-validator.js';
import { logger } from '../utils/logger.js';
import { errorFields } from '../utils/error-fields.js';
import { type WebhookEventType, buildWebhookEnvelope } from '../models/webhook-schemas.js';
import { isStopped, isWakeWebhookEvent } from './agent-stop-rules.js';
import { deliverWithRetries, registerOutboxHandler } from './outbox.js';
import { deactivatedSince } from './account-deactivated.js';

// ── Constants ──────────────────────────────────────────────────────────

/** Retry delays in ms: 5s, 30s, 2min */
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];

/** Auto-disable webhook after this many consecutive failures */
const MAX_CONSECUTIVE_FAILURES = 10;

/** Keep only the last N delivery log entries per agent */
const DELIVERY_LOG_KEEP = 50;

/** HTTP timeout for each delivery attempt */
const FETCH_TIMEOUT_MS = 10_000;

/** How long one claimed attempt may take before another process may take a stored retry over. */
const WEBHOOK_LEASE_MS = FETCH_TIMEOUT_MS + 50_000;

// ── Types ──────────────────────────────────────────────────────────────

/** One delivery: what the outbox stores (agent, event, data, URL, body) and two in-memory fields. */
interface WebhookDelivery {
  agentGaii: string;
  event: WebhookEventType;
  data: Record<string, unknown>;
  url: string;
  body: string;
  /** The secret read at dispatch. Not stored: a resumed attempt reads the agent's current one. */
  secret?: string;
  /** The last failed attempt, for the final delivery-log row. Not stored. */
  last?: { errorMessage: string; httpStatus?: number; latencyMs: number };
}

export interface DispatchOptions {
  config: AimeatConfig;
  storage: Storage;
}

interface DeliveryResult {
  status: 'success' | 'failed';
  httpStatus?: number;
  errorMessage?: string;
  attemptCount: number;
  latencyMs: number;
}

// ── Factory ────────────────────────────────────────────────────────────

export function createWebhookDispatcher({ config, storage }: DispatchOptions) {

  /**
   * Main entry point: dispatch a webhook event to an agent's configured URL.
   * Returns silently if the agent has no webhook configured or it is disabled.
   *
   * IT NEVER REJECTS, AND THAT IS THE POINT. Fifteen call sites invoke this and exactly one of them
   * awaits or catches — every other one is `webhookDispatcher.dispatchWebhookEvent(...)` on its own
   * line, after the route has already answered 200. So a throw ABOVE the inner try blocks (the agent
   * lookup is a database read) was an unhandled rejection: the webhook was never sent, onFailure
   * never ran, webhookFailCount stayed clean, and nothing anywhere said so. Wrapping it here rather
   * than at fifteen call sites is the same argument as withDeclaredInputOnly on the CLI dispatch —
   * a per-caller version leaves whichever one somebody forgets still swallowing it, which is the bug.
   *
   * THE FAILURE COUNTER IS NOT TOUCHED HERE. It counts what the AGENT's endpoint did; an exception
   * before we reach that endpoint is this node's fault, and marking the agent's webhook unhealthy
   * for our own storage hiccup would eventually disable a perfectly good one.
   */
  async function dispatchWebhookEvent(
    agentGaii: string,
    event: WebhookEventType,
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      await dispatch(agentGaii, event, data);
    } catch (err) {
      logger.error('Webhook dispatch threw before delivery was attempted', {
        agentGaii, event, error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function dispatch(
    agentGaii: string,
    event: WebhookEventType,
    data: Record<string, unknown>,
  ): Promise<void> {
    // Load agent record
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      logger.warn('Webhook dispatch: agent not found', { agentGaii, event });
      return;
    }

    // A stopped agent is not woken for new work over its webhook either (services/agent-stop-rules.ts).
    // Events about work it is already doing still go out.
    if (isStopped(agent) && isWakeWebhookEvent(event)) {
      logger.debug('Webhook dispatch: skipped (the agent is stopped)', { agentGaii, event });
      return;
    }

    // A deactivated account's agents get no webhook, as its schedules do not run
    // (services/account-deactivated.ts). Nothing is switched off or counted, so reactivation resumes
    // delivery. A failed owner read is logged and does not stop the delivery: this path never rejects.
    let deactivated: string | null = null;
    try { deactivated = await deactivatedSince(storage, agentGaii); }
    catch (err) { logger.warn('Webhook dispatch: the account could not be read', { agentGaii, event, ...errorFields(err) }); }
    if (deactivated) {
      logger.info('Webhook dispatch: skipped (the account is deactivated)', { agentGaii, event, since: deactivated });
      return;
    }

    // Check webhook is configured and enabled
    if (!agent.webhookUrl || !agent.webhookEnabled) {
      logger.debug('Webhook dispatch: skipped (not configured or disabled)', { agentGaii, event });
      return;
    }

    if (!agent.webhookSecret) {
      logger.warn('Webhook dispatch: skipped (no secret configured)', { agentGaii, event });
      return;
    }

    // Validate URL (SSRF protection)
    const urlCheck = await validateOutboundUrl(agent.webhookUrl);
    if (!urlCheck.valid) {
      logger.warn('Webhook dispatch: URL validation failed', {
        agentGaii,
        event,
        url: agent.webhookUrl,
        reason: urlCheck.reason,
      });
      await onFailure(agentGaii, agent.webhookFailCount ?? 0);
      await logDelivery(agentGaii, event, data, {
        status: 'failed',
        errorMessage: `URL validation failed: ${urlCheck.reason}`,
        attemptCount: 0,
        latencyMs: 0,
      });
      return;
    }

    // Build the signed payload
    const envelope = buildWebhookEnvelope(event, config.nodeId, agentGaii, data);
    const body = JSON.stringify(envelope);

    // Fire with retry (async, does not block the caller's response). The retries are kept in the
    // stored outbox (services/outbox.ts), so a restart inside the 2.5-minute window resumes them.
    void deliverWithRetries<WebhookDelivery>(storage, config.nodeId, 'webhook', {
      agentGaii, event, data, url: agent.webhookUrl, body, secret: agent.webhookSecret,
    }).catch((err: unknown) => {
      logger.error('Webhook delivery bookkeeping failed after the request finished', {
        agentGaii, event, error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  /**
   * One HTTP POST, signed, with a 10 s timeout, and its bookkeeping on success. The retry schedule
   * (5 s, 30 s, 2 min) and the final failure are the outbox handler's (registered below). The secret
   * is the one read when the event was dispatched; an attempt resumed after a restart reads the
   * agent's current one, because the outbox does not store secrets.
   */
  async function fireOnce(d: WebhookDelivery, attemptNo: number): Promise<boolean> {
    const startMs = Date.now();
    const { agentGaii, event, data, url, body } = d;
    const secret = d.secret ?? (await storage.getAgent(agentGaii))?.webhookSecret;
    if (!secret) {
      d.last = { errorMessage: 'The agent has no webhook secret any more', latencyMs: 0 };
      logger.warn('Webhook delivery failed (no secret)', { agentGaii, event, attempt: attemptNo });
      return false;
    }

    // HMAC-SHA256 signature
    const signature = createHmac('sha256', secret).update(body).digest('hex');

    try {
      // safeFetch re-validates every redirect hop so the webhook URL can't bounce to an internal target.
      const response = await safeFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AIMEAT-Signature': `sha256=${signature}`,
          'X-AIMEAT-Event': event,
          'X-AIMEAT-Delivery': randomUUID(),
        },
        body,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const latencyMs = Date.now() - startMs;
      if (!response.ok) {
        // Non-2xx response -- treat as failure
        d.last = { errorMessage: `HTTP ${response.status} ${response.statusText}`, httpStatus: response.status, latencyMs };
        logger.warn('Webhook delivery failed (non-2xx)', { agentGaii, event, attempt: attemptNo, httpStatus: response.status });
        return false;
      }
      // Success (2xx)
      logger.info('Webhook delivered', { agentGaii, event, attempt: attemptNo, httpStatus: response.status, latencyMs });
      // THE BOOKKEEPING CAN FAIL TOO. Each step is a database write; a throw here is caught and
      // logged below rather than counted as a failed delivery, which would send the event again.
      try {
        await onSuccess(agentGaii);
        await logDelivery(agentGaii, event, data, { status: 'success', httpStatus: response.status, attemptCount: attemptNo, latencyMs });
      } catch (err) {
        logger.error('Webhook delivery bookkeeping failed after the request finished', {
          agentGaii, event, attempt: attemptNo, error: err instanceof Error ? err.message : String(err),
        });
      }
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      d.last = { errorMessage, latencyMs: Date.now() - startMs };
      logger.warn('Webhook delivery failed (network)', { agentGaii, event, attempt: attemptNo, error: errorMessage });
      return false;
    }
  }

  /** All retries exhausted: count the failure against the webhook and log the last attempt. */
  async function recordFinalFailure(d: WebhookDelivery, attempts: number): Promise<void> {
    const { agentGaii, event, data } = d;
    logger.error('Webhook delivery failed permanently', { agentGaii, event, totalAttempts: attempts });

    // Load current fail count (may have changed during retries)
    const agent = await storage.getAgent(agentGaii);
    const currentFailCount = agent?.webhookFailCount ?? 0;
    await onFailure(agentGaii, currentFailCount);

    await logDelivery(agentGaii, event, data, {
      status: 'failed',
      httpStatus: d.last?.httpStatus,
      errorMessage: d.last?.errorMessage ?? 'failed',
      attemptCount: attempts,
      latencyMs: d.last?.latencyMs ?? 0,
    });
  }

  registerOutboxHandler<WebhookDelivery>('webhook', {
    delays: RETRY_DELAYS_MS,
    leaseMs: WEBHOOK_LEASE_MS,
    attempt: fireOnce,
    onRetry: (d, attemptNo, delayMs) => logger.info('Webhook retry scheduled', {
      agentGaii: d.agentGaii, event: d.event, attempt: attemptNo, nextAttempt: attemptNo + 1, delayMs,
    }),
    onExhausted: recordFinalFailure,
    // The secret and the last result stay in memory; the delivery log already keeps `data`.
    seal: ({ agentGaii, event, data, url, body }) => ({ agentGaii, event, data, url, body }),
    open: (stored) => {
      const s = stored as Partial<WebhookDelivery>;
      if (!s || typeof s.agentGaii !== 'string' || typeof s.url !== 'string' || typeof s.body !== 'string' || typeof s.event !== 'string') {
        throw new Error('not a webhook delivery');
      }
      return { agentGaii: s.agentGaii, event: s.event as WebhookEventType, data: (s.data ?? {}) as Record<string, unknown>, url: s.url, body: s.body };
    },
  });

  /**
   * Handle successful delivery: reset fail counter and record timestamp.
   */
  async function onSuccess(agentGaii: string): Promise<void> {
    try {
      await storage.updateAgent(agentGaii, {
        webhookFailCount: 0,
        webhookLastSuccess: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('Failed to update agent webhook success state', { agentGaii, ...errorFields(err) });
    }
  }

  /**
   * Handle failed delivery: increment fail counter, auto-disable at threshold.
   */
  async function onFailure(agentGaii: string, currentFailCount: number): Promise<void> {
    const newFailCount = currentFailCount + 1;
    try {
      const updates: Record<string, unknown> = {
        webhookFailCount: newFailCount,
        webhookLastFailure: new Date().toISOString(),
      };

      if (newFailCount >= MAX_CONSECUTIVE_FAILURES) {
        updates.webhookEnabled = false;
        logger.warn('Webhook auto-disabled after consecutive failures', {
          agentGaii,
          failCount: newFailCount,
          threshold: MAX_CONSECUTIVE_FAILURES,
        });
      }

      await storage.updateAgent(agentGaii, updates);
    } catch (err) {
      logger.error('Failed to update agent webhook failure state', { agentGaii, ...errorFields(err) });
    }
  }

  /**
   * Persist a delivery log entry and prune old records.
   */
  async function logDelivery(
    agentGaii: string,
    event: WebhookEventType,
    data: Record<string, unknown>,
    result: DeliveryResult,
  ): Promise<void> {
    const log: WebhookDeliveryLog = {
      id: randomUUID(),
      agentGaii,
      event,
      payload: data,
      status: result.status,
      httpStatus: result.httpStatus,
      errorMessage: result.errorMessage,
      attemptCount: result.attemptCount,
      latencyMs: result.latencyMs,
      createdAt: new Date().toISOString(),
    };

    try {
      await storage.appendDeliveryLog(log);
      await storage.pruneDeliveryLog(agentGaii, DELIVERY_LOG_KEEP);
    } catch (err) {
      logger.error('Failed to persist webhook delivery log', { agentGaii, event, ...errorFields(err) });
    }
  }

  return { dispatchWebhookEvent };
}
