/**
 * @file agent-webhook.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Repository interface for agent webhook delivery logs.
 * @version-history
 *   v1.1.0 -- 2026-09-09 -- AgentTelemetryRepository deleted: appendTelemetry and listTelemetry had
 *     no caller once the in-process ring in services/telemetry-buffer.ts replaced them.
 *   v1.0.0 -- 2026-05-23 -- Initial creation (Phase A push layer)
 */
import type { WebhookDeliveryLog } from '../interface.js';

export interface AgentWebhookRepository {
  appendDeliveryLog(log: WebhookDeliveryLog): Promise<void>;
  listDeliveryLog(agentGaii: string, limit?: number): Promise<WebhookDeliveryLog[]>;
  pruneDeliveryLog(agentGaii: string, keepCount: number): Promise<number>;
}
