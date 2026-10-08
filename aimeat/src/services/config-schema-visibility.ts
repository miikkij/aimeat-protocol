/**
 * @file src/services/config-schema-visibility.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The config rows for visibility and visitors (config-visibility.ts): one switch per
 *   layer, so which tier carries which layer can be decided without touching the code. Its own file
 *   because config-schema.ts is near the line ceiling; spread into the schema where the other
 *   visitor settings stand.
 * @structure VISIBILITY_CONFIG_FIELDS
 * @usage import { VISIBILITY_CONFIG_FIELDS } from './config-schema-visibility.js';
 * @version-history
 *   v1.3.0 — 2026-10-08 — visibility.agent_experience (layer C).
 *   v1.2.0 — 2026-10-08 — visibility.merchant_feed (layer E).
 *   v1.1.0 — 2026-10-08 — visibility.analytics_tags (layer B).
 *   v1.0.0 — 2026-10-08 — Initial: visibility.ai (layer A).
 */
import type { VisibilityConfig } from '../config-visibility.js';
import type { ConfigFieldShape } from './config-field-def.js';

export const VISIBILITY_CONFIG_FIELDS: ConfigFieldShape<keyof VisibilityConfig>[] = [
  { key: 'aiVisibilityEnabled', dotPath: 'visibility.ai', envVar: 'AIMEAT_AI_VISIBILITY', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Count, for every owner, where the people who open their pages and apps came from (an AI answer, search, social, another site), which AIs fetched what, who read the discovery files, and which purchases followed. Counts only: no address, cookie or visitor id, so no consent banner is needed. Each owner can switch it off for their own place; off here is off for everybody' },
  { key: 'analyticsTagsEnabled', dotPath: 'visibility.analytics_tags', envVar: 'AIMEAT_ANALYTICS_TAGS', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'An owner may add their own Microsoft Clarity or Google Analytics 4 to the pages and apps of their place, and the data goes to their own accounts. With the cookie banner on, a tag waits for the visitor\'s consent to analytics; with it off, the tag loads at once and the owner is told EU visitors need consent. Off here removes every owner\'s tags' },
  { key: 'merchantFeedEnabled', dotPath: 'visibility.merchant_feed', envVar: 'AIMEAT_MERCHANT_FEED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'An owner may publish their USD-priced products as a Microsoft Merchant Center feed (for Copilot Checkout) and push them into their own Stripe for agent checkout. Each owner switches their own feed on; their own Merchant Center and Stripe accounts receive it. Off here answers 404 for every feed' },
  { key: 'agentExperienceEnabled', dotPath: 'visibility.agent_experience', envVar: 'AIMEAT_AGENT_EXPERIENCE', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Count, for each owner, the calls outside AI agents make to their tools (by outcome and reason) and agents\' checkouts by stage, and tell the owner in one line where agents stop. Counts per AI family; no agent is named. Off here counts none of it' },
];
