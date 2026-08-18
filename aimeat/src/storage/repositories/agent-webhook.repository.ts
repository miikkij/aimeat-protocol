/**
 * @file agent-webhook.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Repository interfaces for agent telemetry events and webhook delivery logs.
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation (Phase A push layer)
 */
import type { TelemetryEvent, WebhookDeliveryLog } from '../interface.js';

export interface AgentTelemetryRepository {
  appendTelemetry(event: TelemetryEvent): Promise<void>;
  listTelemetry(agentGaii: string, opts: { since?: string; type?: string; limit?: number }): Promise<TelemetryEvent[]>;
}

export interface AgentWebhookRepository {
  appendDeliveryLog(log: WebhookDeliveryLog): Promise<void>;
  listDeliveryLog(agentGaii: string, limit?: number): Promise<WebhookDeliveryLog[]>;
  pruneDeliveryLog(agentGaii: string, keepCount: number): Promise<number>;
}
