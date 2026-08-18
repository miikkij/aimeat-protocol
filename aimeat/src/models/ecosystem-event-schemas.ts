/**
 * @file ecosystem-event-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Zod schemas + builder for the bidirectional GEAI (ecosystem app) event envelope —
 *   the sibling of webhook-schemas.ts with `agent_gaii` renamed to `geai`. Events flow two ways:
 *   OUTBOUND (AIMEAT → a subscribed GEAI, e.g. memory.write) and INBOUND (a GEAI → AIMEAT, e.g.
 *   ticket.resolved, consumed by the workflow engine's ecosystem.event trigger). The inbound catalog
 *   is intentionally OPEN (apps declare their own emit set in their manifest); consumers MUST ignore
 *   unknown event types. The `version` field is the event-type MAJOR; a workflow trigger pins it and
 *   is fail-safe (does not fire) on a major mismatch.
 * @structure ECOSYSTEM_EVENT_VERSION · OUTBOUND_EVENTS/INBOUND_EVENTS · EcosystemEnvelopeBase ·
 *   EcosystemInboundEnvelopeSchema · buildEcosystemEnvelope
 * @usage import { buildEcosystemEnvelope, EcosystemInboundEnvelopeSchema } from '../models/ecosystem-event-schemas.js';
 * @version-history
 *   v1.0.0 — 2026-06-14 — Created for ecosystem events & triggers (chunk 2).
 */
import { z } from 'zod';

/** Envelope/event MAJOR version. Bump only on a breaking change to the envelope or a shared field. */
export const ECOSYSTEM_EVENT_VERSION = 1;

/**
 * Outbound catalog (AIMEAT → GEAI). A subscribed GEAI receives these, gated by its owner's grant.
 * `organism.update` is intentionally absent (agents read organisms directly + memory.write covers it).
 */
export const OUTBOUND_EVENTS = [
  'memory.write',
  'memory.delete',
  'offer.ordered',
  'workflow.step',
  'binding.revoked',
] as const;
export type OutboundEcosystemEvent = typeof OUTBOUND_EVENTS[number];

/**
 * Initial inbound catalog (GEAI → AIMEAT). EXTENSIBLE: an app may emit any event its manifest
 * declares; this list is documentation + the typed-data reference, not a closed enum.
 */
export const INBOUND_EVENTS = [
  'ticket.resolved',
  'feedback.received',
  'csat.dropped',
  'table.updated',
  'note.changed',
] as const;
export type InboundEcosystemEvent = typeof INBOUND_EVENTS[number];

/** Shared envelope fields. Mirrors WebhookEnvelopeBase with `agent_gaii` → `geai`. */
export const EcosystemEnvelopeBase = z.object({
  version: z.number().int().min(1),       // event-type MAJOR version
  event: z.string().min(1).max(120),      // event name (open set)
  timestamp: z.string().datetime(),
  node_id: z.string(),
  geai: z.string(),                       // the principal this event concerns
});

/**
 * Inbound validation. The data shape is per-event and app-defined, so it is validated as a generic
 * record here; the workflow engine matches on { app, event, version } and exposes data downstream.
 * Permissive by design — unknown inbound events are accepted (they simply match no trigger).
 */
export const EcosystemInboundEnvelopeSchema = EcosystemEnvelopeBase.extend({
  data: z.record(z.string(), z.unknown()).default({}),
});
export type EcosystemInboundEnvelope = z.infer<typeof EcosystemInboundEnvelopeSchema>;

export interface EcosystemEnvelope {
  version: number;
  event: string;
  timestamp: string;
  node_id: string;
  geai: string;
  data: Record<string, unknown>;
}

/** Build an outbound (or test inbound) ecosystem event envelope. Mirrors buildWebhookEnvelope. */
export function buildEcosystemEnvelope(
  event: string,
  nodeId: string,
  geai: string,
  data: Record<string, unknown>,
): EcosystemEnvelope {
  return {
    version: ECOSYSTEM_EVENT_VERSION,
    event,
    timestamp: new Date().toISOString(),
    node_id: nodeId,
    geai,
    data,
  };
}
