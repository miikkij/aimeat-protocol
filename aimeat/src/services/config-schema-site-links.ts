/**
 * @file src/services/config-schema-site-links.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The site-link settings on the admin Config tab: the apps, the store and the people
 *   this node's public pages point at. A pure move out of config-schema.ts (max-file-lines):
 *   CONFIG_FIELDS spreads these rows where they stood, so the Config tab lists them in the same order.
 * @structure SITE_LINK_CONFIG_FIELDS
 * @usage import { SITE_LINK_CONFIG_FIELDS } from './config-schema-site-links.js';
 * @version-history
 *   v1.2.1 — 2026-10-08 — site.store_soon_code's description: the store checks the code (ext:shop's
 *     DISCOUNT_CODE), not Stripe; a Stripe coupon makes the store refuse the payment.
 *   v1.2.0 — 2026-10-06 — site.store_soon_code: the shared discount code "Opens soon" shows when pressed.
 *   v1.1.0 — 2026-10-06 — site.store_status ('open' | 'soon') and site.store_note_en / _fi / _es: the
 *     front page shows the store and its prices while the store does not take orders yet.
 *   v1.0.0 — 2026-10-06 — Moved from config-schema.ts, unchanged.
 */
import type { SiteLinksConfig } from '../config-types-site-links.js';
import type { ConfigFieldShape } from './config-field-def.js';
import { isEmptyOrHttpUrl, isContactList, oneOf } from './config-schema-validators.js';

/** A note is one sentence on the front page: plain text, short. */
const isStoreNote = (v: unknown) => typeof v === 'string' && v.length <= 300;
/** A discount code as the store takes one: letters, digits, - and _, at most 40; empty is none. */
const isSoonCode = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]{0,40}$/.test(v);

export const SITE_LINK_CONFIG_FIELDS: ConfigFieldShape<`siteLinks.${keyof SiteLinksConfig}`>[] = [
  // ── Site links (mutable) ──
  // The apps, the store and the people this node's public pages point at. Every one is empty on a
  // fresh clone and every page renders without it (the link, the nav item or the whole section is
  // dropped), so none of these may ever be required. Mutable: a store opens, an app moves, and the
  // front page should follow without a restart. These are the one nested group in this file; the
  // key addresses config.siteLinks.<name> through readConfigField / writeConfigField.
  { key: 'siteLinks.learn', dotPath: 'site.learn_url', envVar: 'AIMEAT_SITE_LEARN_URL', type: 'string', validate: isEmptyOrHttpUrl, immutable: false, description: 'Hands-on academy / showroom app. Renders the "Learn" nav item when set; empty hides it' },
  { key: 'siteLinks.exchange', dotPath: 'site.exchange_url', envVar: 'AIMEAT_SITE_EXCHANGE_URL', type: 'string', validate: isEmptyOrHttpUrl, immutable: false, description: 'Capability marketplace app. Renders the "EXCHANGE" nav item and the front page\'s live-proof link when set' },
  { key: 'siteLinks.assessment', dotPath: 'site.assessment_url', envVar: 'AIMEAT_SITE_ASSESSMENT_URL', type: 'string', validate: isEmptyOrHttpUrl, immutable: false, description: 'Free AI current-state assessment, the business page\'s entry point' },
  { key: 'siteLinks.roadmap', dotPath: 'site.roadmap_url', envVar: 'AIMEAT_SITE_ROADMAP_URL', type: 'string', validate: isEmptyOrHttpUrl, immutable: false, description: 'Public roadmap and portfolio surface' },
  { key: 'siteLinks.paper', dotPath: 'site.paper_url', envVar: 'AIMEAT_SITE_PAPER_URL', type: 'string', validate: isEmptyOrHttpUrl, immutable: false, description: 'Agent-written publication, the "work happens without you" proof on the business page' },
  { key: 'siteLinks.crm', dotPath: 'site.crm_url', envVar: 'AIMEAT_SITE_CRM_URL', type: 'string', validate: isEmptyOrHttpUrl, immutable: false, description: 'CRM app shown as a business case' },
  { key: 'siteLinks.radar', dotPath: 'site.radar_url', envVar: 'AIMEAT_SITE_RADAR_URL', type: 'string', validate: isEmptyOrHttpUrl, immutable: false, description: 'Company-intelligence / mention radar app shown as a business case' },
  { key: 'siteLinks.briefing', dotPath: 'site.briefing_url', envVar: 'AIMEAT_SITE_BRIEFING_URL', type: 'string', validate: isEmptyOrHttpUrl, immutable: false, description: 'Morning briefing board app shown as a business case' },
  { key: 'siteLinks.apiAccelerator', dotPath: 'site.api_accelerator_url', envVar: 'AIMEAT_SITE_API_ACCELERATOR_URL', type: 'string', validate: isEmptyOrHttpUrl, immutable: false, description: 'Make-an-existing-API-agent-native app shown as a business case' },
  { key: 'siteLinks.playbooks', dotPath: 'site.playbooks_url', envVar: 'AIMEAT_SITE_PLAYBOOKS_URL', type: 'string', validate: isEmptyOrHttpUrl, immutable: false, description: 'Playbook app (the repeatable change package) shown as a business case' },
  { key: 'siteLinks.showcase', dotPath: 'site.showcase_url', envVar: 'AIMEAT_SITE_SHOWCASE_URL', type: 'string', validate: isEmptyOrHttpUrl, immutable: false, description: 'An external site running on AIMEAT, shown as third-party proof' },
  { key: 'siteLinks.store', dotPath: 'site.store_url', envVar: 'AIMEAT_SITE_STORE_URL', type: 'string', validate: isEmptyOrHttpUrl, immutable: false, description: 'The store where a visitor buys their own AIMEAT: the ONE price door. Empty hides the front page\'s store section, every "get your own" control and every price; set, the section renders, the ladder is read from the store\'s public ext:shop/tiers record, and /v1/pricing redirects there' },
  // Whether the store takes orders yet. 'soon' keeps the store section and its prices on the front
  // page and turns every "get your own" control into an "Opens soon" label; /v1/pricing still goes to
  // the store. The default is 'open', so a node that never sets it behaves as before.
  { key: 'siteLinks.storeStatus', dotPath: 'site.store_status', envVar: 'AIMEAT_SITE_STORE_STATUS', type: 'string', ...oneOf('open', 'soon'), immutable: false, description: 'Whether the store takes orders: "open" links every "get your own" control to the store; "soon" keeps the store section and its prices, says the marketplace opens soon, and shows "Opens soon" in place of every link to the store. Has no effect while the store link is empty', range: 'open | soon' },
  { key: 'siteLinks.storeNoteEn', dotPath: 'site.store_note_en', envVar: 'AIMEAT_SITE_STORE_NOTE_EN', type: 'string', validate: isStoreNote, immutable: false, description: 'The English sentence the store section shows while the store status is "soon". Empty shows the default: "The marketplace opens soon."' },
  { key: 'siteLinks.storeNoteFi', dotPath: 'site.store_note_fi', envVar: 'AIMEAT_SITE_STORE_NOTE_FI', type: 'string', validate: isStoreNote, immutable: false, description: 'The Finnish sentence the store section shows while the store status is "soon". Empty shows the default: "Kauppapaikka aukeaa pian."' },
  { key: 'siteLinks.storeNoteEs', dotPath: 'site.store_note_es', envVar: 'AIMEAT_SITE_STORE_NOTE_ES', type: 'string', validate: isStoreNote, immutable: false, description: 'The Spanish sentence the store section shows while the store status is "soon". Empty shows the default: "El mercado abre pronto."' },
  // One discount code for everybody. The store checks it (ext:shop's secret config field DISCOUNT_CODE)
  // and takes the discount off the first payment; a Stripe coupon would make the Stripe total differ
  // from the order, and the store would refuse to settle. This node only shows it: a visitor who
  // presses "Opens soon" gets it to use when the store opens.
  { key: 'siteLinks.storeSoonCode', dotPath: 'site.store_soon_code', envVar: 'AIMEAT_SITE_STORE_SOON_CODE', type: 'string', validate: isSoonCode, immutable: false, description: 'The discount code a visitor gets by pressing "Opens soon" while the store status is "soon": one code for everybody. Set the same code in the store\'s own setting DISCOUNT_CODE (the shop extension); the store checks the code and takes the discount off the first payment. Do not make it a Stripe coupon: the Stripe total then differs from the order and the store refuses the payment. This node only shows the code. Letters, digits, - and _, at most 40. Empty keeps "Opens soon" a label with nothing to press' },
  { key: 'siteLinks.signage', dotPath: 'site.signage_url', envVar: 'AIMEAT_SITE_SIGNAGE_URL', type: 'string', validate: isEmptyOrHttpUrl, immutable: false, description: 'The signage screen the front page frames as its "built by asking" example. Empty hides the example; aimeat.io sets its own screen here' },
  { key: 'siteLinks.signageAdmin', dotPath: 'site.signage_admin_url', envVar: 'AIMEAT_SITE_SIGNAGE_ADMIN_URL', type: 'string', validate: isEmptyOrHttpUrl, immutable: false, description: 'The admin panel the front page\'s signage example was made in (its second door)' },
  { key: 'siteLinks.incubator', dotPath: 'site.incubator_url', envVar: 'AIMEAT_SITE_INCUBATOR_URL', type: 'string', validate: isEmptyOrHttpUrl, immutable: false, description: 'The agent incubator (adopt a ready-made helper): the "start here" door on the front page\'s incubator card' },
  { key: 'siteLinks.contacts', dotPath: 'site.contacts', envVar: 'AIMEAT_SITE_CONTACTS', type: 'object', validate: isContactList, immutable: false, description: 'People printed on the public pages, in the order they should be approached: a JSON list of {name, role, email, phone, linkedin}. The first entry with an email fields every "talk to us" control; empty prints no contact card at all' },
];
