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
 *   v1.7.0 — 2026-10-18 — publishGate: who asks the owner before making something public (V4).
 *   v1.6.0 — 2026-10-17 — appDefaultListing, appDefaultAccess, appDefaultAccessCode: how a new app starts.
 *   v1.5.0 — 2026-10-17 — contentAccess: 'signed-in' serves the node's content to its own accounts only.
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
  /**
   * Who this node shows its content to. 'open' (the default) serves public content to anyone.
   * 'signed-in' serves nothing to a caller who is not an account of this node: every route outside
   * the short list sign-in and machine connections need answers 401, the app, portfolio and company
   * origins ask for a sign-in, and nothing can be made public (middleware/content-access-gate.ts,
   * plan doc-mvcn6c7e4e5q V1). Stored values are untouched, so switching back restores them.
   */
  contentAccess: ContentAccess;
  /**
   * How a NEW app starts, the first time it is published (plan doc-mvcn6c7e4e5q V2.4). A later
   * publish keeps whatever the owner chose. Listing: listed (default), community or unlisted.
   */
  appDefaultListing: 'listed' | 'community' | 'unlisted';
  /** Who may open a new app: anyone (default) or signed-in (accounts of this node). */
  appDefaultAccess: 'anyone' | 'signed-in';
  /** A new app gets an access code of its own (generated, returned to the publisher). Off by default. */
  appDefaultAccessCode: boolean;
  /**
   * Who may make something public without the owner answering a request first (plan
   * doc-mvcn6c7e4e5q, V4; services/publish-gate.ts). 'off' (the code default, so a running node does
   * not change under its apps): anyone who may write it. 'agents': an agent needs publish:public,
   * otherwise its attempt becomes a request the owner approves. 'agents-and-apps': an app grant
   * needs the word too. The owner in person is never asked.
   */
  publishGate: PublishGate;
}

/** Who must ask the owner before making something public. */
export type PublishGate = 'off' | 'agents' | 'agents-and-apps';
export const PUBLISH_GATE_VALUES: readonly PublishGate[] = ['off', 'agents', 'agents-and-apps'];

/** Who a node shows its content to: anyone, or its own signed-in accounts only. */
export type ContentAccess = 'open' | 'signed-in';
export const CONTENT_ACCESS_VALUES: readonly ContentAccess[] = ['open', 'signed-in'];

/** True when this node serves content to its own signed-in accounts only. */
export function signedInOnly(config: { contentAccess?: ContentAccess }): boolean {
  return config.contentAccess === 'signed-in';
}

export function visibilityDefaults(env: NodeJS.ProcessEnv = process.env): VisibilityConfig {
  return {
    aiVisibilityEnabled: env.AIMEAT_AI_VISIBILITY !== 'false',
    analyticsTagsEnabled: env.AIMEAT_ANALYTICS_TAGS !== 'false',
    merchantFeedEnabled: env.AIMEAT_MERCHANT_FEED !== 'false',
    agentExperienceEnabled: env.AIMEAT_AGENT_EXPERIENCE !== 'false',
    behaviourEnabled: env.AIMEAT_BEHAVIOUR !== 'false',
    contentAccess: env.AIMEAT_CONTENT_ACCESS === 'signed-in' ? 'signed-in' : 'open',
    appDefaultListing: env.AIMEAT_APP_DEFAULT_LISTING === 'community' || env.AIMEAT_APP_DEFAULT_LISTING === 'unlisted'
      ? env.AIMEAT_APP_DEFAULT_LISTING : 'listed',
    appDefaultAccess: env.AIMEAT_APP_DEFAULT_ACCESS === 'signed-in' ? 'signed-in' : 'anyone',
    appDefaultAccessCode: env.AIMEAT_APP_DEFAULT_ACCESS_CODE === 'true',
    publishGate: env.AIMEAT_PUBLISH_GATE === 'agents' || env.AIMEAT_PUBLISH_GATE === 'agents-and-apps'
      ? env.AIMEAT_PUBLISH_GATE : 'off',
  };
}
