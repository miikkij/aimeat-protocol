/**
 * @file src/services/operator/security-txt.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's security.txt (RFC 9116): where a security researcher reports a
 *   vulnerability in this node. The operator sets the contact (operator.security_contact) and,
 *   optionally, the disclosure policy page (operator.security_policy_url); the route
 *   routes/well-known/security-txt.ts serves the file at `/.well-known/security.txt`.
 *
 *   THE NODE NEVER INVENTS A CONTACT. With no contact set there is no file: a scanner that reads a
 *   made-up address, or the upstream author's, sends a report to somebody who does not run this
 *   node. The privacy and security e-mails of the operator block are not used in its place: an
 *   operator who wants them in the file names them here.
 *
 *   EXPIRES IS COMPUTED, NOT STORED. RFC 9116 makes Expires required and says a file past it is
 *   stale. A date the operator types goes stale unseen; a date computed at each request is always
 *   180 days ahead, which is what the file promises: the contact is read from the live setting.
 * @structure
 *   - parseSecurityContacts(text) — the contact list, or null when one entry is not an address
 *   - isSecurityContactSetting(v), isSecurityPolicySetting(v) — the config rows' checks
 *   - buildSecurityTxt(config, now) — the file, or null when no contact is set
 * @usage
 *   const body = buildSecurityTxt(config);
 *   if (body) res.type('text/plain; charset=utf-8').send(body);
 * @version-history
 *   v1.0.1 — 2026-11-19 — Moved from services/security-txt.ts into services/operator/.
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, report 4.7).
 */
import type { AimeatConfig } from '../../config.js';

/** How far ahead the Expires line points. RFC 9116 recommends less than a year. */
export const SECURITY_TXT_DAYS = 180;
/** The most addresses one contact setting takes. */
const MAX_CONTACTS = 10;
const MAX_ENTRY = 300;

const MAILTO = /^mailto:[^\s@,<>"]+@[^\s@,<>"]+\.[^\s@,<>"]+$/i;

/** One `https:` address with a host, and nothing a line of the file cannot hold. */
function isHttpsAddress(s: string): boolean {
  if (!/^https:\/\/\S+$/i.test(s) || !URL.canParse(s)) return false;
  const u = new URL(s);
  return u.protocol === 'https:' && u.hostname.length > 0 && !u.username && !u.password;
}

/**
 * The contact list: comma-separated `mailto:` or `https:` addresses, in the order to try them. An
 * empty text is an empty list. Null when an entry is not one of the two kinds, when there are more
 * than ten, or when one is longer than 300 characters.
 */
export function parseSecurityContacts(text: string): string[] | null {
  const entries = text.split(',').map(s => s.trim()).filter(Boolean);
  if (entries.length > MAX_CONTACTS) return null;
  for (const e of entries) {
    if (e.length > MAX_ENTRY) return null;
    if (!MAILTO.test(e) && !isHttpsAddress(e)) return null;
  }
  return entries;
}

/** The check of operator.security_contact: empty, or a list parseSecurityContacts accepts. */
export function isSecurityContactSetting(v: unknown): boolean {
  return typeof v === 'string' && parseSecurityContacts(v) !== null;
}

/** The check of operator.security_policy_url: empty, or one `https:` address. */
export function isSecurityPolicySetting(v: unknown): boolean {
  return typeof v === 'string' && (v.trim() === '' || (v.trim().length <= MAX_ENTRY && isHttpsAddress(v.trim())));
}

/** An ISO 8601 date-time in UTC without the milliseconds, as RFC 9116's examples write it. */
function isoSeconds(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * The security.txt of this node, or null when no contact is set (the route then answers 404). The
 * Canonical line is the address the file is served at on the node's public address.
 */
export function buildSecurityTxt(
  config: Pick<AimeatConfig, 'baseUrl' | 'operator'>, now: Date = new Date(),
): string | null {
  const contacts = parseSecurityContacts(config.operator?.securityContact ?? '') ?? [];
  if (!contacts.length) return null;
  const expires = new Date(now.getTime() + SECURITY_TXT_DAYS * 24 * 60 * 60 * 1000);
  const base = config.baseUrl.replace(/\/+$/, '');
  const policy = (config.operator?.securityPolicyUrl ?? '').trim();
  const lines = [
    ...contacts.map(c => `Contact: ${c}`),
    `Expires: ${isoSeconds(expires)}`,
    `Canonical: ${base}/.well-known/security.txt`,
    ...(policy && isSecurityPolicySetting(policy) ? [`Policy: ${policy}`] : []),
    'Preferred-Languages: en, fi',
  ];
  return `${lines.join('\n')}\n`;
}
