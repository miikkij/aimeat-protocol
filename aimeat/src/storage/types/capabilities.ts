/**
 * @file src/storage/types/capabilities.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The CAPABILITY LAYER record types — a capability, what it exports, what it depends
 *   on, how far it is trusted, and the filter the discovery list is read through.
 *
 *   Extracted from ./agents-messaging.ts, which had grown past the 800-line ceiling and was carrying
 *   two unrelated subjects under one name: a capability is not a message. Pure extraction — the
 *   declarations below are byte-identical to what that file held, and it re-exports them, so every
 *   existing `import { CapabilityRecord } from '../storage/interface.js'` keeps resolving.
 * @usage
 *   import type { CapabilityRecord } from '../storage/interface.js';
 * @version-history
 *   v1.0.0 — 2026-08-01 — Extracted from types/agents-messaging.ts (max-file-lines).
 */
// ── Capability Layer ────────────────────────────────────────────────

export interface CapabilitySource {
  // 'ecosystem' = invocation routed over the connect-tunnel to a bound GEAI; ref = 'eco:{app}:{capId}'.
  type: 'extension' | 'action' | 'cortex' | 'app' | 'manual' | 'ecosystem';
  ref: string;
  version: string;
}

export interface CapabilityExport {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  example: { input: Record<string, unknown>; output: Record<string, unknown> } | null;
}

export interface CapabilityDependency {
  type: 'sdk' | 'capability';
  id: string;
  required: boolean;
  minVersion: string | null;
}

export interface CapabilityTrust {
  operatorReviewed: boolean;
  reviewedAt: string | null;
  vouchCount: number;
  publisherTrustScore: number;
  codeAudited: boolean;
  auditNotes: string | null;
}

export interface CapabilityStats {
  totalInvocations: number;
  successCount: number;
  errorCount: number;
  lastInvokedAt: string | null;
  avgResponseMs: number;
  lastError: string | null;
}

export interface CapabilityOverride {
  summary?: string;
  visibility?: 'private' | 'owner' | 'public';
  disabled?: boolean;
  notes?: string;
}

export interface CapabilityRecord {
  id: string;
  name: string;
  summary: string;
  ownerGhii: string;
  visibility: 'private' | 'owner' | 'public';
  scope: 'local';
  status: 'draft' | 'pending_review' | 'active' | 'deprecated' | 'rejected' | 'disabled';
  rejectionReason: string | null;
  deprecationMessage: string | null;
  replacedBy: string | null;
  source: CapabilitySource;
  authRequired: 'none' | 'anonymous' | 'registered';
  callable: boolean;
  inputSchema: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;
  exports: CapabilityExport[] | null;
  usage: string;
  whenToUse: string;
  whenNotToUse: string;
  examples: Array<{ description: string; input: Record<string, unknown>; output: Record<string, unknown> }>;
  dependencies: CapabilityDependency[];
  schemaHash: string;
  webhookUrl: string | null;
  cost: { morsels: number; perUnit?: string } | null;
  trustRequired: number | null;
  trust: CapabilityTrust;
  redactedFields: string[];
  operatorOverride: CapabilityOverride | null;
  stats: CapabilityStats;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CapabilityLogEntry {
  id: string;
  capabilityId: string;
  callerGhii: string;
  input: Record<string, unknown>;
  status: 'success' | 'error';
  durationMs: number;
  error: string | null;
  timestamp: string;
}

export interface CapabilityFilter {
  ownerGhii?: string;
  visibility?: string;
  /** When set to a GHII, restricts results to `visibility='public' OR ownerGhii=<this>` — public
   *  capabilities plus the caller's OWN (any visibility). Stops a registered non-owner from seeing
   *  other owners' private rows (webhookUrl/ownerGhii) via the discovery list. */
  publicOrOwner?: string;
  status?: string;
  sourceType?: string;
  callable?: boolean;
  authRequired?: string;
  tags?: string[];
  search?: string;
  page?: number;
  perPage?: number;
}

