/**
 * @file src/config-pages.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The setting of the HTML pages of workspaces: the one host their frame is served from
 *   (routes/page-host.ts, services/html-page.ts). Its own file because config.ts and config-types.ts
 *   are at the line ceiling.
 * @structure PagesConfig · pagesDefaults()
 * @usage
 *   import { pagesDefaults } from './config-pages.js';
 *   const config = { ...pagesDefaults(), ... };
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial: pageHost (AIMEAT_PAGE_HOST).
 */

/** Declared here, not picked from AimeatConfig, so this file imports nothing (config-decide.ts gives the reason). */
export interface PagesConfig {
  /**
   * The one host the HTML pages of workspaces are served from, inside the page frame, e.g.
   * `pages.aimeat.io`. One host for every page, with the page in the path, so nothing in DNS, TLS,
   * nginx or any header grows with the number of pages. Empty when unset: the node then shows an
   * HTML page as its text. Set it once the host has its own certificate and proxy block
   * (docs/operations/production-deployment.md, "The page host").
   */
  pageHost: string;
}

/**
 * Explicit only. Empty is the safe value on every node until the host is provisioned. A scheme, a
 * path or a port written into the setting is dropped: the frame's origin takes the scheme and port
 * of the node's own address (services/html-page.ts pageOriginOf).
 */
export function pagesDefaults(): PagesConfig {
  return {
    pageHost: (process.env.AIMEAT_PAGE_HOST ?? '').trim().toLowerCase()
      .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, ''),
  };
}
