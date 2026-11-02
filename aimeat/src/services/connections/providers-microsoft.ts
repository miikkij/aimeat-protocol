/**
 * @file providers-microsoft.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Microsoft's three OAuth URLs, built in one place for every Microsoft provider (the mail
 *   pair in providers-mail.ts, the files pair in providers-files.ts). Moved out of providers-mail.ts
 *   unchanged, so the files pair need not import the mail module, which imports the registry, which
 *   imports the files pair: dependency-cruiser counts that as a cycle.
 * @structure microsoftEndpoints
 * @usage import { microsoftEndpoints } from './providers-microsoft.js';
 * @version-history
 *   v1.0.0 — 2026-11-02 — Moved from providers-mail.ts unchanged.
 */
import type { OAuthEndpoints } from './providers-types.js';

/** One place that builds Microsoft's three URLs, so the tenant cannot end up in two of them. */
export function microsoftEndpoints(tenant: string): OAuthEndpoints {
  // A tenant reaches this from config or from a principal's own client row, so it is checked rather
  // than interpolated: it goes into a URL path, and anything outside this shape is either a typo or
  // an attempt to send a token somewhere else.
  const safe = /^[A-Za-z0-9-]{1,64}$/.test(tenant) ? tenant : 'common';
  const base = `https://login.microsoftonline.com/${safe}/oauth2/v2.0`;
  return {
    authorize: `${base}/authorize`,
    token: `${base}/token`,
    // Microsoft's logout endpoint ends a SESSION; it does not retire a refresh token the way
    // Google's revoke does. Null is the honest value: revoking is local, and the person removes the
    // app's consent from their Microsoft account page if they want it gone at both ends.
    revoke: null,
  };
}
