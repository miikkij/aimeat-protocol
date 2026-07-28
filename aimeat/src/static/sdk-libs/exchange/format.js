/**
 * @file exchange/format.js
 * @description Unit formatting for EXCHANGE figures. AIMEAT carries two units that must never be
 *   added together or shown in each other's shape: money is an integer count of 6-decimal
 *   micro-units in a named currency, morsels are plain integers and a throttle rather than a
 *   currency. A figure that mixes them is not a rounding bug, it is a wrong number.
 *
 *   Money formatting itself belongs to aimeat-commerce and is NOT restated here — this delegates to
 *   `AIMEAT.commerce.fmtMoney`, so the two libraries can never render "1.50 EUR" two different ways.
 *   That is also why aimeat-commerce is a hard dependency of this library rather than a suggestion.
 * @structure commerce() · fmtUnit(amount, unit, currency) · fmtMorsels(amount)
 * @usage AIMEAT.exchange.fmtUnit(1500000, 'money', 'EUR')  // "1.50 EUR"
 *        AIMEAT.exchange.fmtUnit(10, 'morsels')            // "10 morsels"
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial (NOSTE prompt 02 — the EXCHANGE browser library, gap G19).
 */

/** The aimeat-commerce surface, or null when it was not included. */
function commerce() {
  return (window.AIMEAT && window.AIMEAT.commerce) || null;
}

/** Morsels are plain integers — never a symbol, never a decimal, never an emoji. */
export function fmtMorsels(amount) {
  const n = Math.round(Number(amount) || 0);
  return n + (Math.abs(n) === 1 ? ' morsel' : ' morsels');
}

/**
 * Format one EXCHANGE figure in the unit it is actually denominated in.
 *
 * `unit: 'money'` (or any currency other than `morsel`) formats the integer micro-units through
 * `AIMEAT.commerce.fmtMoney`; anything else formats plain morsels. The two are never combined into
 * one figure — a capability priced in both is two prices, and an app should show them as two.
 *
 * @param {number} amount   Micro-units for money, whole morsels otherwise.
 * @param {string} [unit]   `'money'` | `'morsels'` — or omit and pass a currency.
 * @param {string} [currency]  `'EUR'` / `'USD'` when the unit is money.
 * @returns {string}
 * @throws {Error} When the unit is money and aimeat-commerce is not loaded — the alternative is
 *   silently rendering micro-units as if they were euros, which is wrong by a factor of a million.
 */
export function fmtUnit(amount, unit, currency) {
  const isMoney = unit === 'money' || (!!currency && currency !== 'morsel' && currency !== 'MORSEL');
  if (!isMoney) return fmtMorsels(amount);
  const c = commerce();
  if (!c) {
    throw new Error('AIMEAT.commerce is required to format money. Include aimeat-commerce.js before aimeat-exchange.js');
  }
  return c.fmtMoney(amount, currency);
}
