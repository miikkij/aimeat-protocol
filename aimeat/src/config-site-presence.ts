/**
 * @file src/config-site-presence.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How the node presents itself to the public web: the robots.txt content signals,
 *   the AI-training crawler decision, outbound Web Bot Auth signing, and which front page the
 *   root serves. Kept together because they answer one question — what does a stranger (human
 *   or crawler) meet at the door.
 *
 *   Its own file rather than more lines in config-types.ts, which crossed the 800-line ceiling
 *   the moment the front-page switch was added. Pure extraction, same pattern and reason as
 *   config-security.ts: the diff stays the thing being added instead of reflowing a file two
 *   sessions are working in.
 * @structure SitePresenceConfig
 * @usage interface AimeatConfig extends SitePresenceConfig { … }
 * @version-history
 *   v1.0.0 — 2026-08-19 — Extracted contentSignal, aiTraining and webBotAuthSign verbatim from
 *     config-types.ts; frontPage (AIMEAT_FRONT_PAGE) added as the new member.
 */

export interface SitePresenceConfig {
  /**
   * robots.txt Content Signals Policy directive ("search=yes, ai-input=yes, ai-train=no"); 'off'
   * removes it. Empty means "pair it to `aiTraining`", which is the default.
   */
  contentSignal: string;
  /**
   * Whether the AI training crawlers are allowed in robots.txt. Search and retrieval bots are
   * always allowed and are not covered by this; see `public/robots.node.txt`.
   */
  aiTraining: 'allow' | 'deny';
  /** Web Bot Auth: sign outbound safeFetch requests (RFC 9421, node Ed25519 key). OFF by default. */
  webBotAuthSign: boolean;
  /**
   * Which front page the root serves to a browser: 'classic' is the SPA landing, 'demo' is the
   * static showroom page (public/front-demo.html) and 'os' is the static OS page
   * (public/front-os.html), each with a .fi sibling by language. One switch, so a new front can
   * be staged, flipped on, and flipped back without touching anything else. The static pages
   * stay directly reachable at their own paths either way.
   */
  frontPage: 'classic' | 'demo' | 'os';
}
