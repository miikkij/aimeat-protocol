/**
 * @file public/views/profile/companies/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Companies pages share: the words (a front page kind, a sender, what a
 *   missing detail costs), the detail-field inventory with its consequences, relative time, the
 *   crumb and the cross-page rail links. The field labels themselves come from the established
 *   profile.companies.field.* keys, which all three languages already carry.
 * @structure c · day · rel · FIELDS · factsOf · missingWord · kindWord · senderWord · crumb · pageLinks
 * @usage import { c, FIELDS, factsOf, crumb, pageLinks } from './frame.js';
 * @version-history
 *   v1.1.0 — 2026-09-26 — The crumb and the rail's sibling pages are data for SettingsPage; goTab is
 *     the Rail's openTab (component plan C9); this file writes no markup (page group G8).
 *   v1.0.0 — 2026-08-31 — Initial (design canvas "AIMEAT Yritysten sivu", direction A).
 */
import { t } from '/js/i18n.js';
import { openTab } from '/components/Rail.js';
import { date as fmtDate } from '/js/format.js';
import { formatRelativeTime } from '/views/profile/memory-tab/helpers.js';

export const c = (key, vars) => t('companypage.' + key, vars);
// The locale() helper here derived the FORMAT from the LANGUAGE. They are different settings:
// /js/format.js reads the reader's own, from their profile, falling back to their browser.
export const day = (iso) => (iso ? fmtDate(iso) : '');
export const rel = (iso) => { if (!iso) return ''; const d = new Date(iso); return Date.now() - d.getTime() > 30 * 864e5 ? day(iso) : formatRelativeTime(iso); };

/**
 * The twelve registered details, each with what its absence costs: 'invoice' blocks the invoice
 * itself, 'payment' leaves the invoice without payment details, 'finvoice' blocks the e-invoice,
 * 'plain' costs nothing until something asks for it. Wire names match the PUT body and the
 * profile.companies.field.* label keys.
 */
export const FIELDS = [
  ['business_id', 'businessId', 'invoice'],
  ['vat_id', 'vatId', 'plain'],
  ['street_address', 'streetAddress', 'invoice'],
  ['postal_code', 'postalCode', 'invoice'],
  ['city', 'city', 'invoice'],
  ['country', 'country', 'plain'],
  ['email', 'email', 'plain'],
  ['phone', 'phone', 'plain'],
  ['iban', 'iban', 'payment'],
  ['bic', 'bic', 'payment'],
  ['einvoice_address', 'einvoiceAddress', 'finvoice'],
  ['einvoice_operator', 'einvoiceOperator', 'finvoice'],
];

export const fieldLabel = (wire) => t('profile.companies.field.' + wire);

/** Which of the twelve are filled in, and what the gaps cost. */
export function factsOf(company) {
  const missing = FIELDS.filter(([, rec]) => !company?.[rec]);
  return {
    done: FIELDS.length - missing.length,
    total: FIELDS.length,
    missing,
    blocksInvoice: missing.some(([, , tag]) => tag === 'invoice'),
    blocksFinvoice: missing.some(([, , tag]) => tag === 'finvoice'),
  };
}

export const missingWord = (tag) => (tag === 'plain' ? c('missing') : c('missing') + ' · ' + c('costs.' + tag));

/** A front page kind as a person reads it, from the tab's established keys. */
export const kindWord = (kind) => t('profile.companies.front' + (kind === 'app' ? 'App' : kind === 'portfolio' ? 'Portfolio' : kind === 'redirect' ? 'Redirect' : 'None'));

/** Whose server the company's mail leaves from. */
export const senderWord = (smtpSet) => c(smtpSet ? 'senderOwn' : 'senderShared');

/** The crumb's steps (SettingsPage draws them): the company's name is the page you are on. */
export function crumb(company) {
  return [t('nav.profile'), ...(company ? [c('title'), company.name] : [c('title')])];
}

/** The sibling pages in the rail, as data (SettingsPage draws them → … →). */
export function pageLinks() {
  return [
    { tab: 'pnl', label: t('profile.tabs.pnl') },
    { tab: 'email', label: t('profile.tabs.email') },
    { tab: 'apps', label: t('profile.tabs.apps') },
  ];
}
export const goTab = openTab;

/** The two-letter mark a company row wears. */
export function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}
