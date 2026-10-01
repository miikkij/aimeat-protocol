/**
 * @file test/unit/atelier-money-units.test.ts
 * @description The Atelier price parts (priceTable, checkout, cart) read amounts the way
 *   AIMEAT.commerce gives them: `unit: 'micros'` and the `...Micros` fields divide by 1000000 and
 *   keep up to six decimals when sub-cent, currency 'morsels' is a count with the kit's word, and
 *   plain numbers come out exactly as before. Expected money strings are built with the same
 *   _core/format.js calls the parts make, so the test holds in any default locale.
 * @usage cd aimeat && pnpm exec vitest run test/unit/atelier-money-units.test.ts
 * @version-history
 *   v1.0.1 - 2026-10-01 - cart is read from atelier/cart.js, where it moved out of flow-parts.js.
 *   v1.0.0 - 2026-10-01 - Initial (atelier 0.62.0, commerce amounts in the price parts).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: any;
let doc: any;
let units: any;
let anime: any;
let lenis: any;
let shop: any;
let fmt: any;

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  doc = restore.document;
  fmt = await import('../../src/static/sdk-libs/_core/format.js');
  units = await import('../../src/static/sdk-libs/atelier/money-units.js');
  anime = await import('../../src/static/sdk-libs/atelier/anime-parts.js');
  lenis = await import('../../src/static/sdk-libs/atelier/lenis-parts.js');
  shop = await import('../../src/static/sdk-libs/atelier/cart.js');
});
afterEach(() => { doc.body.innerHTML = ''; });
afterAll(() => restore());

function host(): any {
  const node = doc.createElement('div');
  doc.body.appendChild(node);
  return node;
}
function all(root: any): any[] {
  const out: any[] = [];
  const walk = (n: any) => { out.push(n); for (const c of n.children || []) walk(c); };
  walk(root);
  return out;
}
const texts = (root: any, cls: string) => all(root)
  .filter((n) => String(n.className || '').split(/\s+/).includes(cls))
  .map((n) => n.textContent);

/** An ISO amount written the way the parts write it: the SDK's money(), fixed decimals. */
const iso = (n: number, code: string, d: number) =>
  fmt.money(n, code, { minimumFractionDigits: d, maximumFractionDigits: d });
/** A number with a symbol after it, the way checkout and cart write '€'. */
const after = (n: number, sym: string, d: number) =>
  fmt.num(n, { minimumFractionDigits: d, maximumFractionDigits: d }) + ' ' + sym;

describe('money-units', () => {
  it('reads micros, keeps sub-cent decimals, and never divides morsels', () => {
    expect(units.readAmount({ priceMicros: 1500000 }, 'price', null)).toBe(1.5);
    expect(units.readAmount({ price: 1500000 }, 'price', { unit: 'micros' })).toBe(1.5);
    expect(units.readAmount({ price: 19 }, 'price', {})).toBe(19);
    expect(units.readAmount({ priceMicros: 40 }, 'price', { currency: 'Morsels', unit: 'micros' })).toBe(40);
    expect(units.fractionDigits(1.5)).toBe(2);
    expect(units.fractionDigits(0.002)).toBe(3);
    expect(units.fractionDigits(0.000001)).toBe(6);
    expect(units.isMorsels('MORSEL')).toBe(true);
    expect(units.isMorsels('morsels')).toBe(true);
    expect(units.isMorsels('EUR')).toBe(false);
    expect(units.morselText(1)).toBe('1 morsel');
    expect(units.morselText(12)).toBe('12 morsels');
  });
});

describe('priceTable', () => {
  it('plain numbers: a whole price stays whole, a price with cents shows them', () => {
    const h = host();
    anime.priceTable({ target: h, data: { currency: '€', plans: [{ id: 'pro', price: 19 }] } });
    expect(texts(h, 'ak-price__amount')).toEqual(['€' + fmt.num(19, { maximumFractionDigits: 0 })]);
    const h2 = host();
    anime.priceTable({ target: h2, data: { currency: 'EUR', plans: [{ id: 'pro', price: 18.9 }] } });
    // It read "€19" until 2026-10-01: rounding told the buyer a price they would not pay.
    expect(texts(h2, 'ak-price__amount')).toEqual([iso(18.9, 'EUR', 2)]);
  });

  it('unit micros and priceMicros: divided, decimals kept, sub-cent to six', () => {
    const h = host();
    anime.priceTable({
      target: h,
      data: { currency: 'EUR', unit: 'micros', plans: [{ id: 'a', price: 1500000 }, { id: 'b', price: 2000 }] },
    });
    expect(texts(h, 'ak-price__amount')).toEqual([iso(1.5, 'EUR', 2), iso(0.002, 'EUR', 3)]);
    const h2 = host();
    anime.priceTable({ target: h2, data: { currency: 'EUR', plans: [{ id: 'a', priceMicros: 19000000, priceYearlyMicros: 190000000 }] } });
    expect(texts(h2, 'ak-price__amount')).toEqual([iso(19, 'EUR', 2)]);
    // A yearly price in micros is what offers the year switch, the same as a plain priceYearly.
    expect(all(h2).filter((n) => n.className === 'ak-price__period').length).toBe(2);
  });

  it('morsels: an integer and the word, never money', () => {
    const h = host();
    anime.priceTable({ target: h, data: { currency: 'morsels', plans: [{ id: 'a', price: 40 }] } });
    expect(texts(h, 'ak-price__amount')).toEqual(['40 morsels']);
  });
});

describe('checkout', () => {
  it('plain numbers: two decimals, exactly as before', () => {
    const h = host();
    lenis.checkout({ target: h, data: {
      lines: [{ id: 'l1', title: 'Coffee', price: 18.9, qty: 2 }],
      shipping: [{ id: 'std', label: 'Posti', price: 5.9 }] } });
    const fig = texts(h, 'ak-checkout__figure');
    expect(fig).toContain(after(37.8, '€', 2));
    expect(fig).toContain(after(5.9, '€', 2));
    expect(fig).toContain(after(43.7, '€', 2));
  });

  it('unit micros on lines and shipping, and priceMicros alone', () => {
    const h = host();
    lenis.checkout({ target: h, data: {
      currency: 'EUR', unit: 'micros',
      lines: [{ id: 'l1', title: 'Coffee', price: 18900000, qty: 2 }],
      shipping: [{ id: 'std', label: 'Posti', price: 5900000 }] } });
    const fig = texts(h, 'ak-checkout__figure');
    expect(fig).toContain(iso(37.8, 'EUR', 2));
    expect(fig).toContain(iso(5.9, 'EUR', 2));
    expect(fig).toContain(iso(43.7, 'EUR', 2));
    const h2 = host();
    lenis.checkout({ target: h2, data: {
      currency: 'USD', lines: [{ id: 'l1', title: 'Call', priceMicros: 2000, qty: 1 }],
      shipping: [{ id: 'free', label: 'None', priceMicros: 0 }] } });
    expect(texts(h2, 'ak-checkout__figure')).toContain(iso(0.002, 'USD', 3));
  });

  it('morsels: integer counts with the word', () => {
    const h = host();
    lenis.checkout({ target: h, data: { currency: 'MORSEL', lines: [{ id: 'l1', title: 'Post', price: 1, qty: 1 }] } });
    expect(texts(h, 'ak-checkout__figure')).toContain('1 morsel');
  });
});

describe('cart', () => {
  it('plain numbers: two decimals, exactly as before', () => {
    const h = host();
    shop.cart({ target: h, data: { currency: '€', lines: [{ id: 'a', title: 'Flour', price: 2.5, qty: 3 }] } });
    expect(texts(h, 'ak-cart__price')).toEqual([after(7.5, '€', 2)]);
    expect(texts(h, 'ak-cart__totalvalue')).toEqual([after(7.5, '€', 2)]);
  });

  it('priceMicros and unit micros, sub-cent kept', () => {
    const h = host();
    shop.cart({ target: h, data: { currency: 'EUR', lines: [{ id: 'a', title: 'Call', priceMicros: 1500, qty: 2 }] } });
    expect(texts(h, 'ak-cart__price')).toEqual([iso(0.003, 'EUR', 3)]);
    const h2 = host();
    shop.cart({ target: h2, data: { currency: 'EUR', unit: 'micros', lines: [{ id: 'a', title: 'Flour', price: 2500000, qty: 3 }] } });
    expect(texts(h2, 'ak-cart__totalvalue')).toEqual([iso(7.5, 'EUR', 2)]);
  });

  it('morsels: the total is a count with the word', () => {
    const h = host();
    shop.cart({ target: h, data: { currency: 'morsels', lines: [{ id: 'a', title: 'Post', price: 5, qty: 3 }] } });
    expect(texts(h, 'ak-cart__totalvalue')).toEqual(['15 morsels']);
  });
});
