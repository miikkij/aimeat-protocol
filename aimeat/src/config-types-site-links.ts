/**
 * @file config-types-site-links.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The site-link half of the config types: the apps, the store and the people this
 *   node's public pages point at. Extracted verbatim from config-types.ts on 2026-08-28, when the
 *   store and incubator links took that file past its 800-line limit; config-types.ts re-exports
 *   both interfaces, so every importer is unchanged.
 * @structure SiteContact · SiteLinksConfig
 * @usage import type { SiteLinksConfig, SiteContact } from './config-types-site-links.js';
 * @version-history
 *   v1.0.0 — 2026-08-28 — Pure extraction from config-types.ts v1.6.0. No field changed.
 */

/**
 * Links the public marketing pages (landing, how-it-works, business, help) point at.
 *
 * These are THIS node's own apps and contacts, not protocol features. aimeat.io fills them
 * in from its deployment environment; a fresh clone leaves them empty and every page renders
 * without the link, the nav item or the whole section. Nothing here may be required for a
 * page to work — an operator who sets none of it still gets a coherent site that never
 * advertises somebody else's apps or phone number.
 *
 * Same posture rule as the rest of the config (Rule 10): safe public default in the repo,
 * documented per-node override.
 */
/**
 * One person printed on the public pages. The FIRST entry with an email is the one every
 * "book a demo" / "talk to us" call to action mails, so order it by who should field the
 * first contact rather than by seniority.
 */
export interface SiteContact {
  /** Display name. */
  name: string;
  /** Role line under the name (e.g. "CEO and co-founder"). Optional. */
  role: string;
  /** Contact email. An entry with no email is dropped — it would render as a dead card. */
  email: string;
  /** Phone, rendered as a tel: link. Optional. */
  phone: string;
  /** Profile URL (LinkedIn or equivalent), rendered as a link. Optional. */
  linkedin: string;
}

export interface SiteLinksConfig {
  /** Hands-on academy / showroom app. Renders the "Learn" nav item when set. */
  learn: string;
  /** Capability marketplace app. Renders the "EXCHANGE" nav item when set. */
  exchange: string;
  /** Free AI current-state assessment used as the business-page entry point. */
  assessment: string;
  /** Public roadmap + portfolio surface. */
  roadmap: string;
  /** Agent-written publication, used as the "work happens without you" proof. */
  paper: string;
  /** CRM app. */
  crm: string;
  /** Company-intelligence / mention radar app. */
  radar: string;
  /** Morning briefing board app. */
  briefing: string;
  /** API-acceleration app (make an existing API agent-native). */
  apiAccelerator: string;
  /** Playbook app (the repeatable change package). */
  playbooks: string;
  /** An external node running on AIMEAT, shown as third-party proof. */
  showcase: string;
  /**
   * The store where a visitor buys their own AIMEAT. This is the ONE price door: while it is
   * empty the front page carries no store section and no price, and every "get your own" control
   * elsewhere hides itself. The store is its own AIMEAT instance, so prices live there and only
   * there; this node never states one on its own.
   */
  store: string;
  /** The agent incubator: where a visitor adopts a ready-made helper. Empty hides its card's door. */
  incubator: string;
  /**
   * People shown on the public pages, in the order they should be approached. Empty means the
   * node prints no contact card and no "talk to us" control at all, which is a valid state.
   */
  contacts: SiteContact[];
}
