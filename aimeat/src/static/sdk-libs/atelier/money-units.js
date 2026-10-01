/**
 * @file atelier/money-units.js
 * @description The one rule the kit's three price parts (priceTable, checkout, cart) share for
 *   reading an amount the way AIMEAT.commerce and the node give it.
 *
 *   MICRO-UNITS. The node stores money as an integer count of 6-decimal micro-units: 1.50 EUR is
 *   1500000, the same as `AIMEAT.commerce.MONEY_UNIT` and x402/USDC. A part's data says so with
 *   `unit: 'micros'`, or one item says so with a `...Micros` field (`priceMicros`,
 *   `priceYearlyMicros`), and the amount is divided by 1000000 before it is written. Such an amount
 *   shows two decimals, and up to six when it is sub-cent, which is what `commerce.fmtMoney` does,
 *   so a page that loads both agrees with itself.
 *
 *   MORSELS. A currency of 'morsel' or 'morsels', in any case, is the write pacer and never money:
 *   an integer count followed by the kit's own word, never a currency figure. A morsel count is an
 *   integer at the source, so `unit: 'micros'` and a `...Micros` field never divide it.
 *
 *   Data with neither is read exactly as before: whole currency units, formatted by each part's own
 *   code, so an app that passes `price: 19` sees the same text it saw before this module existed.
 * @structure MONEY_UNIT · isMorsels · speaksMicros · hasAmount · readAmount · fractionDigits ·
 *   roundMicros · morselText
 * @usage import { readAmount, speaksMicros, isMorsels, morselText } from './money-units.js';
 *   const micros = speaksMicros(data, data.lines, ['price']);
 *   const each = readAmount(line, 'price', data);   // 1500000 with unit 'micros' → 1.5
 * @version-history
 *   v0.62.0 — 2026-10-01 — Initial: priceTable, checkout and cart take commerce amounts directly.
 */
import { num } from '../_core/format.js';
import { t } from './i18n.js';

/** Micro-units in one whole currency unit. Matches AIMEAT.commerce.MONEY_UNIT. */
export const MONEY_UNIT = 1000000;

/**
 * Is this currency the morsel meter rather than money? 'morsel', 'morsels', 'MORSEL', any case.
 * @param {unknown} currency
 * @returns {boolean}
 */
export function isMorsels(currency) {
  return /^morsels?$/i.test(String(currency == null ? '' : currency).trim());
}

/**
 * Whether a part's figures are micro-units: the data says `unit: 'micros'`, or any item carries a
 * `...Micros` field for one of the named fields. A morsel currency never speaks micros.
 * @param {{ unit?: string, currency?: string }|null|undefined} data
 * @param {Array<Record<string, any>>|null|undefined} items
 * @param {string[]} fields  the plain field names, e.g. ['price', 'priceYearly']
 * @returns {boolean}
 */
export function speaksMicros(data, items, fields) {
  if (data && isMorsels(data.currency)) return false;
  if (data && data.unit === 'micros') return true;
  return (Array.isArray(items) ? items : []).some(function (item) {
    return !!item && fields.some(function (f) { return typeof item[f + 'Micros'] === 'number'; });
  });
}

/**
 * Does this item carry the amount at all, in either form?
 * @param {Record<string, any>|null|undefined} item
 * @param {string} field  'price' or 'priceYearly'
 * @returns {boolean}
 */
export function hasAmount(item, field) {
  return !!item && (typeof item[field] === 'number' || typeof item[field + 'Micros'] === 'number');
}

/**
 * One amount off an item, in whole currency units (or a morsel count). `<field>Micros` wins when
 * it is a number; otherwise `<field>`, divided when the data says `unit: 'micros'`. A missing or
 * unreadable amount is 0, as the parts read it before.
 * @param {Record<string, any>|null|undefined} item
 * @param {string} field
 * @param {{ unit?: string, currency?: string }|null|undefined} data
 * @returns {number}
 */
export function readAmount(item, field, data) {
  if (!item) return 0;
  const morsels = !!data && isMorsels(data.currency);
  const micros = item[field + 'Micros'];
  if (typeof micros === 'number' && Number.isFinite(micros)) {
    return morsels ? micros : micros / MONEY_UNIT;
  }
  const plain = Number(item[field]) || 0;
  return (!morsels && data && data.unit === 'micros') ? plain / MONEY_UNIT : plain;
}

/**
 * An amount rounded to the micro-unit, which is the finest the node stores; float sums lose
 * nothing that matters by it.
 * @param {number} value  whole currency units
 * @returns {number}
 */
export function roundMicros(value) {
  return Math.round((Number(value) || 0) * MONEY_UNIT) / MONEY_UNIT;
}

/**
 * How many decimals an amount from micro-units shows: two, and up to six when the amount is
 * sub-cent. The same cut as `commerce.fmtMoney`: 1.5 → 2, 0.002 → 3, 0.000001 → 6.
 * @param {number} value  whole currency units
 * @returns {number}
 */
export function fractionDigits(value) {
  const s = (Number(value) || 0).toFixed(6).replace(/(\.\d{2}\d*?)0+$/, '$1');
  const dot = s.indexOf('.');
  return dot < 0 ? 2 : s.length - dot - 1;
}

/**
 * A morsel count for a person to read: an integer in the reader's own grouping and the kit's word.
 * @param {number} n
 * @returns {string}
 */
export function morselText(n) {
  const v = Math.round(Number(n) || 0);
  if (v === 1) return t('morsel1');
  return t('morsels', { n: num(v, { maximumFractionDigits: 0 }) });
}
