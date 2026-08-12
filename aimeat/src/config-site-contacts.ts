/**
 * @file src/config-site-contacts.ts
 * @description parseSiteContacts(): the people printed on the public pages, read from
 *   AIMEAT_SITE_CONTACTS. Moved out of config.ts by pure extraction when that file reached the
 *   800-line limit; the code is unchanged and config.ts calls it exactly where it used to.
 * @structure parseSiteContacts() — the only export
 * @usage import { parseSiteContacts } from './config-site-contacts.js';
 * @version-history
 *   v1.0.0 — 2026-08-11 — Pure extraction from config.ts (max-file-lines). No behaviour change.
 */
import type { SiteContact } from './config-types.js';
import { logger } from './utils/logger.js';

/**
 * The people printed on the public pages, from `AIMEAT_SITE_CONTACTS` (a JSON array of
 * `{ name, role, email, phone }`, ordered by who should field the first contact).
 *
 * Falls back to the single-contact vars this replaced, and finally to the operator email, so a
 * node configured before multi-contact keeps its card. An entry without an email is dropped:
 * a "talk to a human" card with no way to reach anyone is worse than no card.
 *
 * Malformed JSON degrades to the fallback and warns rather than refusing to boot — a typo in a
 * marketing contact must never take a node down.
 */
export function parseSiteContacts(): SiteContact[] {
  const raw = (process.env.AIMEAT_SITE_CONTACTS ?? '').trim();
  const clean = (c: Partial<SiteContact>): SiteContact => ({
    name: String(c.name ?? '').trim(),
    role: String(c.role ?? '').trim(),
    email: String(c.email ?? '').trim(),
    phone: String(c.phone ?? '').trim(),
    linkedin: String(c.linkedin ?? '').trim(),
  });
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(c => clean(c as Partial<SiteContact>)).filter(c => c.email !== '');
      logger.warn('AIMEAT_SITE_CONTACTS is not a JSON array — ignoring it and falling back');
    } catch (err) {
      logger.warn('AIMEAT_SITE_CONTACTS is not valid JSON — ignoring it and falling back', { error: String(err) });
    }
  }
  const single = clean({
    name: process.env.AIMEAT_SITE_CONTACT_NAME,
    role: process.env.AIMEAT_SITE_CONTACT_ROLE,
    email: process.env.AIMEAT_SITE_CONTACT_EMAIL ?? process.env.AIMEAT_OPERATOR_EMAIL,
    phone: process.env.AIMEAT_SITE_CONTACT_PHONE,
    linkedin: process.env.AIMEAT_SITE_CONTACT_LINKEDIN,
  });
  return single.email ? [single] : [];
}
