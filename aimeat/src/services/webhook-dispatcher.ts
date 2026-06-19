/**
 * @file webhook-dispatcher.ts
 * @description Webhook delivery service for the AIMEAT push layer.
 *   Loads an agent's webhook configuration, validates the target URL,
 *   signs the payload with HMAC-SHA256, and fires HTTP POST with retry.
 *   Auto-disables webhooks after 10 consecutive failures.
 *   Logs every delivery attempt (success or failure) and prunes old entries.
 *
 * @structure
 *   - createWebhookDispatcher({ config, storage }) -- factory, returns { dispatchWebhookEvent }
 *   - dispatchWebhookEvent(agentGaii, event, data) -- main entry point
 *   - fireWithRetry(url, body, secret, attempt) -- recursive retry with backoff
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
 *   v1.0.0 -- 2026-05-23 -- Initial creation with retry, HMAC signing, auto-disable
 */

import { createHmac, randomUUID } from 'node:crypto';
import type { Storage, WebhookDeliveryLog } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { validateOutboundUrl, safeFetch } from '../utils/url-validator.js';
import { logger } from '../utils/logger.js';
import { type WebhookEventType, type WebhookPayload, buildWebhookEnvelope } from '../models/webhook-schemas.js';

// ── Constants ──────────────────────────────────────────────────────────

/** Retry delays in ms: 5s, 30s, 2min */
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];

/** Auto-disable webhook after this many consecutive failures */
const MAX_CONSECUTIVE_FAILURES = 10;

/** Keep only the last N delivery log entries per agent */
const DELIVERY_LOG_KEEP = 50;

/** HTTP timeout for each delivery attempt */
const FETCH_TIMEOUT_MS = 10_000;

// ── Types ──────────────────────────────────────────────────────────────

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
   */
  async function dispatchWebhookEvent(
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

    // Fire with retry (async, does not block the caller's response)
    fireWithRetry(agentGaii, agent.webhookUrl, body, agent.webhookSecret, event, data, 0);
  }

  /**
   * Fire HTTP POST with exponential backoff retry.
   * Each attempt has a 10s timeout. Retries are scheduled via setTimeout
   * so the caller is not blocked.
   */
  function fireWithRetry(
    agentGaii: string,
    url: string,
    body: string,
    secret: string,
    event: WebhookEventType,
    data: Record<string, unknown>,
    attempt: number,
  ): void {
    const startMs = Date.now();

    // HMAC-SHA256 signature
    const signature = createHmac('sha256', secret).update(body).digest('hex');

    // safeFetch re-validates every redirect hop so the webhook URL can't bounce to an internal target.
    safeFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AIMEAT-Signature': `sha256=${signature}`,
        'X-AIMEAT-Event': event,
        'X-AIMEAT-Delivery': randomUUID(),
      },
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
      .then(async (response) => {
        const latencyMs = Date.now() - startMs;

        if (response.ok) {
          // Success (2xx)
          logger.info('Webhook delivered', { agentGaii, event, attempt: attempt + 1, httpStatus: response.status, latencyMs });
          await onSuccess(agentGaii);
          await logDelivery(agentGaii, event, data, {
            status: 'success',
            httpStatus: response.status,
            attemptCount: attempt + 1,
            latencyMs,
          });
        } else {
          // Non-2xx response -- treat as failure
          const errorMessage = `HTTP ${response.status} ${response.statusText}`;
          logger.warn('Webhook delivery failed (non-2xx)', { agentGaii, event, attempt: attempt + 1, httpStatus: response.status });
          await handleRetryOrFail(agentGaii, url, body, secret, event, data, attempt, errorMessage, response.status, latencyMs);
        }
      })
      .catch(async (err: unknown) => {
        const latencyMs = Date.now() - startMs;
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.warn('Webhook delivery failed (network)', { agentGaii, event, attempt: attempt + 1, error: errorMessage });
        await handleRetryOrFail(agentGaii, url, body, secret, event, data, attempt, errorMessage, undefined, latencyMs);
      });
  }

  /**
   * Decide whether to retry or record final failure.
   */
  async function handleRetryOrFail(
    agentGaii: string,
    url: string,
    body: string,
    secret: string,
    event: WebhookEventType,
    data: Record<string, unknown>,
    attempt: number,
    errorMessage: string,
    httpStatus: number | undefined,
    latencyMs: number,
  ): Promise<void> {
    if (attempt < RETRY_DELAYS_MS.length) {
      // Schedule retry
      const delayMs = RETRY_DELAYS_MS[attempt]!;
      logger.info('Webhook retry scheduled', { agentGaii, event, attempt: attempt + 1, nextAttempt: attempt + 2, delayMs });
      setTimeout(() => {
        fireWithRetry(agentGaii, url, body, secret, event, data, attempt + 1);
      }, delayMs);
    } else {
      // All retries exhausted
      logger.error('Webhook delivery failed permanently', { agentGaii, event, totalAttempts: attempt + 1 });

      // Load current fail count (may have changed during retries)
      const agent = await storage.getAgent(agentGaii);
      const currentFailCount = agent?.webhookFailCount ?? 0;
      await onFailure(agentGaii, currentFailCount);

      await logDelivery(agentGaii, event, data, {
        status: 'failed',
        httpStatus,
        errorMessage,
        attemptCount: attempt + 1,
        latencyMs,
      });
    }
  }

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
      logger.error('Failed to update agent webhook success state', { agentGaii, error: err });
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
      logger.error('Failed to update agent webhook failure state', { agentGaii, error: err });
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
      logger.error('Failed to persist webhook delivery log', { agentGaii, event, error: err });
    }
  }

  return { dispatchWebhookEvent };
}
