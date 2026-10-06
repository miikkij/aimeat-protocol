/**
 * @file src/config-site-contacts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description parseSiteContacts(): the people printed on the public pages, read from
 *   AIMEAT_SITE_CONTACTS. Moved out of config.ts by pure extraction when that file reached the
 *   800-line limit; the code is unchanged and config.ts calls it exactly where it used to.
 * @structure parseSiteContacts() · siteLinksFromEnv()
 * @usage import { siteLinksFromEnv } from './config-site-contacts.js';
 * @version-history
 *   v1.3.0 — 2026-10-06 — AIMEAT_SITE_STORE_SOON_CODE.
 *   v1.2.0 — 2026-10-06 — AIMEAT_SITE_STORE_STATUS ('open' unless it says 'soon') and
 *     AIMEAT_SITE_STORE_NOTE_EN / _FI / _ES.
 *   v1.1.0 — 2026-09-29 — siteLinksFromEnv(): config.ts's siteLinks object, moved here unchanged
 *     when config.ts reached 800 lines, plus the signage screen and its admin panel
 *     (AIMEAT_SITE_SIGNAGE_URL, AIMEAT_SITE_SIGNAGE_ADMIN_URL): the front page showed aimeat.io's own
 *     signage example on every node.
 *   v1.0.0 — 2026-08-11 — Pure extraction from config.ts (max-file-lines). No behaviour change.
 */
import type { SiteContact, SiteLinksConfig } from './config-types.js';
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

/**
 * Links the public pages point at, from the AIMEAT_SITE_* variables. Empty by design: the marketing
 * pages point at apps that belong to whoever runs the node, and a fresh clone must not advertise
 * aimeat.io's apps or Jouni's phone number. Each empty value hides its link, nav item or section.
 */
export function siteLinksFromEnv(): SiteLinksConfig {
  return {
    learn: process.env.AIMEAT_SITE_LEARN_URL ?? '',
    exchange: process.env.AIMEAT_SITE_EXCHANGE_URL ?? '',
    assessment: process.env.AIMEAT_SITE_ASSESSMENT_URL ?? '',
    roadmap: process.env.AIMEAT_SITE_ROADMAP_URL ?? '',
    paper: process.env.AIMEAT_SITE_PAPER_URL ?? '',
    crm: process.env.AIMEAT_SITE_CRM_URL ?? '',
    radar: process.env.AIMEAT_SITE_RADAR_URL ?? '',
    briefing: process.env.AIMEAT_SITE_BRIEFING_URL ?? '',
    apiAccelerator: process.env.AIMEAT_SITE_API_ACCELERATOR_URL ?? '',
    playbooks: process.env.AIMEAT_SITE_PLAYBOOKS_URL ?? '',
    showcase: process.env.AIMEAT_SITE_SHOWCASE_URL ?? '',
    store: (process.env.AIMEAT_SITE_STORE_URL ?? '').trim(),
    // Anything but 'soon' is 'open', so a typo keeps today's behaviour rather than closing the store.
    storeStatus: (process.env.AIMEAT_SITE_STORE_STATUS ?? '').trim().toLowerCase() === 'soon' ? 'soon' : 'open',
    storeNoteEn: (process.env.AIMEAT_SITE_STORE_NOTE_EN ?? '').trim(),
    storeNoteFi: (process.env.AIMEAT_SITE_STORE_NOTE_FI ?? '').trim(),
    storeNoteEs: (process.env.AIMEAT_SITE_STORE_NOTE_ES ?? '').trim(),
    storeSoonCode: (process.env.AIMEAT_SITE_STORE_SOON_CODE ?? '').trim(),
    incubator: (process.env.AIMEAT_SITE_INCUBATOR_URL ?? '').trim(),
    signage: (process.env.AIMEAT_SITE_SIGNAGE_URL ?? '').trim(),
    signageAdmin: (process.env.AIMEAT_SITE_SIGNAGE_ADMIN_URL ?? '').trim(),
    contacts: parseSiteContacts(),
  };
}
