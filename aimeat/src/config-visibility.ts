/**
 * @file src/config-visibility.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's switches for visibility and visitors: one switch per layer, so that
 *   which tier carries which layer can be decided later without touching the code that counts.
 *
 *   Its own file because config.ts is at the line ceiling, and these switches answer one question:
 *   what this node may measure about the people and the AIs that reach the places it serves.
 * @structure VisibilityConfig · visibilityDefaults()
 * @usage
 *   import { visibilityDefaults } from './config-visibility.js';
 *   const config = { ...visibilityDefaults(), ... };
 * @version-history
 *   v1.4.0 — 2026-10-08 — behaviourEnabled (layer D).
 *   v1.3.0 — 2026-10-08 — agentExperienceEnabled (layer C).
 *   v1.2.0 — 2026-10-08 — merchantFeedEnabled (layer E).
 *   v1.1.0 — 2026-10-08 — analyticsTagsEnabled (layer B).
 *   v1.0.0 — 2026-10-08 — Initial: aiVisibilityEnabled (layer A).
 */

/** Declared here, not picked from AimeatConfig, so this file imports nothing (config-decide.ts gives the reason). */
export interface VisibilityConfig {
  /**
   * Layer A: count page loads by channel, AI fetches by family and target, discovery-file fetches and
   * purchases by channel, for every owner on this node unless the owner switches it off. On by
   * default: the record holds counts only (models/visibility-schemas.ts).
   */
  aiVisibilityEnabled: boolean;
  /**
   * Layer B: an owner may add their own Microsoft Clarity or Google Analytics 4 to the pages and
   * apps of their place. On by default; the tags wait for consent when the cookie banner is on.
   */
  analyticsTagsEnabled: boolean;
  /**
   * Layer E: an owner may publish their products as a Merchant Center feed and push them into their
   * own Stripe for agent checkout (Copilot Checkout). On by default; each owner switches their own on.
   */
  merchantFeedEnabled: boolean;
  /**
   * Layer C: count, for the owner, outside agents' calls to their tools by outcome and agents'
   * checkouts by stage, and say where they stop. On by default: counts per AI family, no agent named.
   */
  agentExperienceEnabled: boolean;
  /**
   * Layer D: a script on every owner's apps counts clicks on a coarse grid, scroll depth, dead and
   * rage clicks and the screen size, and the owner's opt-in fixing agent writes a corrected draft.
   * On by default: aggregates only, no identifier, keystroke, page text or recording.
   */
  behaviourEnabled: boolean;
}

export function visibilityDefaults(env: NodeJS.ProcessEnv = process.env): VisibilityConfig {
  return {
    aiVisibilityEnabled: env.AIMEAT_AI_VISIBILITY !== 'false',
    analyticsTagsEnabled: env.AIMEAT_ANALYTICS_TAGS !== 'false',
    merchantFeedEnabled: env.AIMEAT_MERCHANT_FEED !== 'false',
    agentExperienceEnabled: env.AIMEAT_AGENT_EXPERIENCE !== 'false',
    behaviourEnabled: env.AIMEAT_BEHAVIOUR !== 'false',
  };
}
