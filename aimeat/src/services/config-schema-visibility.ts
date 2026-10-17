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
 *   v1.6.0 — 2026-10-17 — apps.default_listing, apps.default_access, apps.default_access_code (V2.4).
 *   v1.5.0 — 2026-10-17 — visibility.content_access (open | signed-in), plan doc-mvcn6c7e4e5q V1.
 *   v1.4.0 — 2026-10-08 — visibility.behaviour (layer D).
 *   v1.3.0 — 2026-10-08 — visibility.agent_experience (layer C).
 *   v1.2.0 — 2026-10-08 — visibility.merchant_feed (layer E).
 *   v1.1.0 — 2026-10-08 — visibility.analytics_tags (layer B).
 *   v1.0.0 — 2026-10-08 — Initial: visibility.ai (layer A).
 */
import type { VisibilityConfig } from '../config-visibility.js';
import type { ConfigFieldShape } from './config-field-def.js';
import { oneOf } from './config-schema-validators.js';

export const VISIBILITY_CONFIG_FIELDS: ConfigFieldShape<keyof VisibilityConfig>[] = [
  { key: 'aiVisibilityEnabled', dotPath: 'visibility.ai', envVar: 'AIMEAT_AI_VISIBILITY', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Count, for every owner, where the people who open their pages and apps came from (an AI answer, search, social, another site), which AIs fetched what, who read the discovery files, and which purchases followed. Counts only: no address, cookie or visitor id, so no consent banner is needed. Each owner can switch it off for their own place; off here is off for everybody' },
  { key: 'analyticsTagsEnabled', dotPath: 'visibility.analytics_tags', envVar: 'AIMEAT_ANALYTICS_TAGS', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'An owner may add their own Microsoft Clarity or Google Analytics 4 to the pages and apps of their place, and the data goes to their own accounts. With the cookie banner on, a tag waits for the visitor\'s consent to analytics; with it off, the tag loads at once and the owner is told EU visitors need consent. Off here removes every owner\'s tags' },
  { key: 'merchantFeedEnabled', dotPath: 'visibility.merchant_feed', envVar: 'AIMEAT_MERCHANT_FEED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'An owner may publish their USD-priced products as a Microsoft Merchant Center feed (for Copilot Checkout) and push them into their own Stripe for agent checkout. Each owner switches their own feed on; their own Merchant Center and Stripe accounts receive it. Off here answers 404 for every feed' },
  { key: 'agentExperienceEnabled', dotPath: 'visibility.agent_experience', envVar: 'AIMEAT_AGENT_EXPERIENCE', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Count, for each owner, the calls outside AI agents make to their tools (by outcome and reason) and agents\' checkouts by stage, and tell the owner in one line where agents stop. Counts per AI family; no agent is named. Off here counts none of it' },
  { key: 'behaviourEnabled', dotPath: 'visibility.behaviour', envVar: 'AIMEAT_BEHAVIOUR', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'A small script on every owner\'s apps counts where clicks land, how far the page is scrolled, clicks that change nothing (dead clicks) and repeated clicks (rage clicks), by screen size. Counts only: no address, cookie, visitor id, keystroke, page text or recording. Each owner can switch it off per app, and may switch on a weekly fixing agent that writes a corrected draft with their own AI and never publishes. Off here removes the script and the fixing agent for everybody' },
  { key: 'contentAccess', dotPath: 'visibility.content_access', envVar: 'AIMEAT_CONTENT_ACCESS', type: 'string', ...oneOf('open', 'signed-in'), immutable: false, description: 'Who this node shows its content to. open: public content is served to anyone. signed-in: nothing is served to someone who is not signed in to an account of THIS node: every page and address outside sign-in and the machine connections asks for a sign-in, apps, portfolios and company pages open only after one, and nothing can be made public. Content keeps its own setting underneath, so switching back to open restores what was public. For a company or a closed group, together with the registration mode and, for Microsoft accounts, the tenant allowlist', range: 'open|signed-in' },
  { key: 'appDefaultListing', dotPath: 'apps.default_listing', envVar: 'AIMEAT_APP_DEFAULT_LISTING', type: 'string', ...oneOf('listed', 'community', 'unlisted'), immutable: false, description: 'Where a NEW app is listed the first time it is published. listed: the public catalogue and search. community: only in the list signed-in people of this node see. unlisted: in no list but the owner\'s. Listing is not access: the link opens an unlisted app for anyone unless access says otherwise. A later publish keeps what the owner chose', range: 'listed|community|unlisted' },
  { key: 'appDefaultAccess', dotPath: 'apps.default_access', envVar: 'AIMEAT_APP_DEFAULT_ACCESS', type: 'string', ...oneOf('anyone', 'signed-in'), immutable: false, description: 'Who may OPEN a new app the first time it is published. anyone: the link opens it. signed-in: only people signed in to an account of this node (the app asks the others to sign in first). The owner can change it per app, also to the members of one organism. A later publish keeps what the owner chose', range: 'anyone|signed-in' },
  { key: 'appDefaultAccessCode', dotPath: 'apps.default_access_code', envVar: 'AIMEAT_APP_DEFAULT_ACCESS_CODE', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'A NEW app gets an access code of its own the first time it is published, and the publish answer tells the publisher the code. Whoever opens the app types it first. Off by default. A later publish keeps what the owner chose' },
];
