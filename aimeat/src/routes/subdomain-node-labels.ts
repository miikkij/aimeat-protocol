/**
 * @file subdomain-node-labels.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The single-label names under the apex that a person reads as the node's own pages
 *   (sign-in, account, payment, support) and the labels of the node's own host families. A
 *   published app never gets one of these as its per-app label, an operator cannot map one to an
 *   app, and the apex namespace (`<label>.<apex>`) never serves an app under one. The per-app
 *   origin (`<label>.<appHost>`) is session-less and isolated, so an app row that already holds
 *   such a label keeps serving there; the apex answers with a redirect to it.
 *   RESERVED_SUBDOMAINS (routes/subdomains.ts) is the stricter list: those labels are refused on
 *   every host family.
 * @structure
 *   - NODE_APEX_LABELS            — the fixed names
 *   - isNodeApexLabel(label, cfg) — a fixed name, or the label of a configured node host
 *   - nodeLabelAppOrigin(cfg, label, originalUrl) — the per-app origin address for that label, or null
 * @usage import { isNodeApexLabel, nodeLabelAppOrigin } from './subdomain-node-labels.js';
 * @version-history
 *   v1.0.0 — 2026-10-24 — Initial (secaudit2026oct22, subdomains.ts app-label-served-on-apex-namespace).
 */
import type { AimeatConfig } from '../config.js';

/**
 * Names a visitor takes for the node's own sign-in, account, payment or support pages. A page on
 * `login.<apex>` shares nothing with the apex origin in the browser, but the name tells the person
 * it is the node, and the node's own SPA pages, its sign-in included, answer on that host too.
 */
export const NODE_APEX_LABELS: ReadonlySet<string> = new Set([
  'login', 'logout', 'signin', 'sign-in', 'signout', 'sign-out', 'signup', 'sign-up', 'register',
  'auth', 'oauth', 'sso', 'id', 'idp', 'identity', 'passkey', 'password', 'session', 'verify',
  'account', 'accounts', 'my', 'me', 'profile', 'security', 'secure',
  'pay', 'payment', 'payments', 'billing', 'checkout', 'wallet',
  'support', 'help', 'operator', 'operators', 'node', 'aimeat',
  'pages', 'webmail', 'smtp', 'imap',
]);

type HostConfig = Pick<AimeatConfig, 'baseUrl' | 'appHost' | 'portfolioHost' | 'coHost' | 'pageHost'>;

/** The label of `host` when it is exactly one label under `apexHost`, else null. */
function labelUnderApex(host: string, apexHost: string): string | null {
  if (!host || !apexHost || !host.endsWith('.' + apexHost)) return null;
  const label = host.slice(0, -(apexHost.length + 1));
  return label && !label.includes('.') ? label : null;
}

/** True when `label` is a node name: a fixed one, or the label of a configured node host family. */
export function isNodeApexLabel(label: string, config: HostConfig): boolean {
  if (NODE_APEX_LABELS.has(label)) return true;
  // A baseUrl that is not a URL has no host families.
  if (!URL.canParse(config.baseUrl)) return false;
  const apexHost = new URL(config.baseUrl).hostname.toLowerCase();
  for (const host of [config.appHost, config.portfolioHost, config.coHost, config.pageHost]) {
    if (labelUnderApex((host || '').toLowerCase(), apexHost) === label) return true;
  }
  return false;
}

/**
 * The per-app origin address for an app row that holds a node label, keeping the request's path
 * and query, or null when this node has no app origin (the apex then answers 404).
 */
export function nodeLabelAppOrigin(
  config: Pick<AimeatConfig, 'baseUrl' | 'appHost' | 'appOriginEnabled'>, label: string, originalUrl: string,
): string | null {
  if (!config.appHost || !config.appOriginEnabled) return null;
  // A baseUrl that is not a URL keeps https and no port.
  const b = URL.canParse(config.baseUrl) ? new URL(config.baseUrl) : null;
  const scheme = b ? b.protocol.replace(':', '') : 'https';
  const portSuffix = b?.port ? `:${b.port}` : '';
  const rest = originalUrl.startsWith('/') ? originalUrl : '/';
  return `${scheme}://${label}.${config.appHost}${portSuffix}${rest}`;
}
