/**
 * @file src/config-types-capabilities.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The capability registry's settings, mixed into AimeatConfig. Moved out of
 *   config-types.ts unchanged when that file reached the 800-line ceiling.
 * @structure CapabilitiesConfig
 * @usage import type { CapabilitiesConfig } from './config-types-capabilities.js';
 * @version-history
 *   v1.1.0 — 2026-10-16 — capabilityPublishers, capabilityMinPublisherTrust, capabilityPublisherAllowlist and capabilityLogRetentionDays removed: no code acted on them, and the first was reported as the node's policy (QA audit D8-05).
 *   v1.0.0 — 2026-09-24 — Moved from config-types.ts (a pure move).
 */

export interface CapabilitiesConfig {
  // Capabilities
  capabilityPublishing: 'disabled' | 'self_only' | 'moderated' | 'open';
  capabilityWebhooks: 'disabled' | 'allowlist_only' | 'open';
  capabilityWebhookDomainAllowlist: string[];
  /** Count direct extension calls into capability stats (proxy calls always count). Default false. */
  capabilityCallCounting: boolean;
}
