/**
 * @file src/config-types-capabilities.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The capability registry's settings, mixed into AimeatConfig. Moved out of
 *   config-types.ts unchanged when that file reached the 800-line ceiling.
 * @structure CapabilitiesConfig
 * @usage import type { CapabilitiesConfig } from './config-types-capabilities.js';
 * @version-history
 *   v1.0.0 — 2026-09-24 — Moved from config-types.ts (a pure move).
 */

export interface CapabilitiesConfig {
  // Capabilities
  capabilityPublishing: 'disabled' | 'self_only' | 'moderated' | 'open';
  capabilityPublishers: 'all_users' | 'trusted_only' | 'allowlist';
  capabilityMinPublisherTrust: number;
  capabilityPublisherAllowlist: string[];
  capabilityWebhooks: 'disabled' | 'allowlist_only' | 'open';
  capabilityWebhookDomainAllowlist: string[];
  capabilityLogRetentionDays: number;
  /** Count direct extension calls into capability stats (proxy calls always count). Default false. */
  capabilityCallCounting: boolean;
}
