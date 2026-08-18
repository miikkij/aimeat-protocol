/**
 * @file config-hosts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How the origin-family hosts are derived from the node's baseUrl: the app
 *   origin (`apps.<apex>`), the standalone-portfolio origin (`portfolio.<apex>`) and the
 *   company origin (`co.<apex>`). One rule in one place — each family is an apex subdomain
 *   with a fixed label, and each returns '' for localhost/IP baseUrls where a public
 *   subdomain family makes no sense (an operator can still set the host explicitly).
 * @structure deriveAppHost · derivePortfolioHost · deriveCoHost
 * @usage import { deriveAppHost } from './config-hosts.js';
 * @version-history
 *   v1.0.0 — 2026-08-07 — Extracted from config.ts (max-file-lines) when the company origin
 *     landed; derivations unchanged.
 */

/**
 * Derive the app-origin host (`apps.<apexHost>`) from a baseUrl. Returns '' for
 * localhost / IP / host-less baseUrls where a public app subdomain makes no sense
 * (the operator can still set AIMEAT_APP_HOST explicitly, e.g. for local testing).
 */
export function deriveAppHost(baseUrl: string): string {
  let host: string;
  // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the input is not of that shape
  try { host = new URL(baseUrl).hostname.toLowerCase(); } catch { return ''; }
  if (!host || host === 'localhost' || /^[\d.]+$/.test(host) || host.endsWith('.localhost')) return '';
  return `apps.${host}`;
}

/** Same derivation for the standalone-portfolio origin (`portfolio.<apexHost>`). */
export function derivePortfolioHost(baseUrl: string): string {
  const appHost = deriveAppHost(baseUrl);
  return appHost ? appHost.replace(/^apps\./, 'portfolio.') : '';
}

/** Same derivation for the company origin (`co.<apexHost>`) — the co family is to companies
 *  what the apps family is to apps. */
export function deriveCoHost(baseUrl: string): string {
  const appHost = deriveAppHost(baseUrl);
  return appHost ? appHost.replace(/^apps\./, 'co.') : '';
}
