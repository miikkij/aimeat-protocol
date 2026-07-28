/**
 * @file game/units.js
 * @description The two units an AIMEAT game shows, formatted the one correct way.
 *
 *   MONEY is an integer count of 6-decimal micro-units — 1 EUR is 1000000, exactly as
 *   aimeat-commerce and the node ledger store it. Never a float, never a currency symbol glued
 *   to a number by hand.
 *
 *   MORSELS are plain integers, and the word beside them is a translated word. Never the meat
 *   emoji: it is not a currency symbol, it does not align, and it does not survive a font change.
 *
 *   THE TWO NEVER MEET IN ONE FIGURE. There is deliberately no combined formatter here — a view
 *   showing both shows them as two rows, because a sum of morsels and euros means nothing.
 * @structure MONEY_UNIT · money(micros, currency) · morsels(n) · isMoneyCurrency(c)
 * @usage  AIMEAT.game.money(1500000, 'EUR')  // "1.50 EUR"
 *         AIMEAT.game.morsels(12)            // "12 morsels" / "12 morselia"
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial (NOSTE prompt 01).
 */
import { i18n } from './i18n.js';

/** Micro-units in one whole currency unit. Matches aimeat-commerce.MONEY_UNIT and x402/USDC. */
export const MONEY_UNIT = 1000000;

/**
 * Format money micro-units: two decimals normally, more only when the amount is sub-cent.
 * Same convention as `AIMEAT.commerce.fmtMoney`, so a page that loads both agrees with itself.
 * @param {number} micros    Integer micro-units (1 EUR = 1000000).
 * @param {string} [currency] ISO code appended when given ("EUR", "USD").
 * @returns {string}
 */
export function money(micros, currency) {
  const s = ((Number(micros) || 0) / MONEY_UNIT).toFixed(6).replace(/(\.\d{2}\d*?)0+$/, '$1');
  return currency ? s + ' ' + currency : s;
}

/**
 * Format a morsel amount: an integer and a translated word, never a symbol or an emoji.
 * @param {number} n
 * @param {{ bare?: boolean }} [opts]  `bare: true` returns the number alone.
 * @returns {string}
 */
export function morsels(n, opts) {
  const v = Math.round(Number(n) || 0);
  return opts && opts.bare ? String(v) : v + ' ' + i18n.t('morsels');
}

/**
 * Is this currency real money (as opposed to the morsel meter)? The branch every seller view needs.
 * @param {string} [currency]
 * @returns {boolean}
 */
export function isMoneyCurrency(currency) {
  return !!currency && currency !== 'morsel' && currency !== 'MORSEL';
}
