/**
 * @file src/utils/eur-per-usd.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The check for site.ai_credit_eur_per_usd, the euros of AI credit per dollar of a
 *   store-sold node's key. Its own module because both the environment reader
 *   (config/site-contacts.ts) and the settings row (services/config/schema-site-links.ts) use it,
 *   and the second already reaches the first through config-types.ts: a shared import in either
 *   direction is a cycle.
 * @structure isEurPerUsd(v)
 * @usage if (isEurPerUsd(raw)) siteLinks.aiCreditEurPerUsd = raw;
 * @version-history
 *   v1.2.0 — 2026-11-01 — isEurPerMessage removed with its setting (Jouni, 1.11 04.00: no message counts).
 *   v1.1.0 — 2026-11-01 — isEurPerMessage, for site.ai_eur_per_message (Jouni's review A3: one
 *     count of messages for the store and the place).
 *   v1.0.0 — 2026-10-31 — Initial (Jouni's C, 2026-10-31: the AI credit in euros).
 */

/**
 * Euros per US dollar as the fleet service writes it: empty, or a plain positive decimal up to 10
 * ("0.8634"). Ten is far above any EUR/USD rate there has been; a larger number is a typo.
 */
export function isEurPerUsd(v: unknown): boolean {
  if (v === '') return true;
  if (typeof v !== 'string' || !/^\d{1,2}(\.\d{1,8})?$/.test(v)) return false;
  const n = Number(v);
  return n > 0 && n <= 10;
}
