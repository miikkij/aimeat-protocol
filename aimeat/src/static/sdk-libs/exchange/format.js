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

/** The units this formatter recognises. Anything else is a caller mistake, not a default. */
const MORSEL_UNITS = ['morsels', 'morsel', 'MORSEL', 'MORSELS'];
const MONEY_UNITS = ['money'];

/**
 * Format one EXCHANGE figure in the unit it is actually denominated in.
 *
 * `unit: 'money'` formats integer micro-units through `AIMEAT.commerce.fmtMoney`; `unit: 'morsels'`
 * formats plain integers. Omit the unit entirely and pass a currency and it is money. The two units
 * are never combined into one figure — a capability priced in both is two prices, and an app should
 * show them as two.
 *
 * AN UNRECOGNISED UNIT THROWS, and that is the whole point of this function rather than a nicety.
 * It used to fall through to morsels, so `fmtUnit(17793800, 'EUR')` — the currency put in the unit
 * slot, which is the obvious mistake to make with this signature — rendered 17.79 EUR as
 * "17793800 morsels". The number was wrong by a factor of a million, the unit was wrong, and the
 * explanatory line beside it still said money. A silent unit fallback cannot be safe here: money
 * and morsels are different KINDS, so guessing between them is guessing at the value (R-S8).
 *
 * @param {number} amount   Micro-units for money, whole morsels otherwise.
 * @param {string} [unit]   `'money'` | `'morsels'` — or omit it and pass a currency.
 * @param {string} [currency]  `'EUR'` / `'USD'` when the unit is money.
 * @returns {string}
 * @throws {Error} On an unrecognised unit, and when the unit is money but aimeat-commerce is not
 *   loaded — the alternative there is rendering micro-units as if they were whole euros.
 */
export function fmtUnit(amount, unit, currency) {
  // Nothing said at all: a currency decides it, and without one this is the morsel meter.
  if (unit === undefined || unit === null || unit === '') {
    const impliedMoney = !!currency && currency !== 'morsel' && currency !== 'MORSEL';
    return impliedMoney ? money(amount, currency) : fmtMorsels(amount);
  }
  if (MORSEL_UNITS.indexOf(unit) !== -1) return fmtMorsels(amount);
  if (MONEY_UNITS.indexOf(unit) !== -1) return money(amount, currency);

  // Name the mistake and the fix. The commonest one by far is a currency in the unit slot, so it
  // gets its own sentence rather than a generic "invalid argument".
  throw new Error(
    `fmtUnit: unknown unit "${unit}". The signature is fmtUnit(amount, unit, currency), where unit `
    + `is "money" or "morsels". If "${unit}" is a currency, you want fmtUnit(amount, "money", "${unit}") `
    + `— passing it as the unit used to render money as morsels, silently and wrongly.`,
  );
}

/** Money always goes through aimeat-commerce, so the two libraries cannot disagree on the shape. */
function money(amount, currency) {
  const c = commerce();
  if (!c) {
    throw new Error('AIMEAT.commerce is required to format money. Include aimeat-commerce.js before aimeat-exchange.js');
  }
  return c.fmtMoney(amount, currency);
}
