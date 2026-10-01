/**
 * @file test/unit/atelier-shop-words.test.ts
 * @description The Atelier shop and flow parts (priceTable, cart, checkout, thread, sortable,
 *   notices, facets, the calendar's weekday row) take their words from the kit dictionary: in
 *   Finnish and Spanish no English word of theirs is left, in English every word is the text the
 *   parts drew before, an app overrides one with i18n.use(), and en/fi/es carry the same keys. Also
 *   the cart's unit price under a line with more than one item ("2 × 5,90 €"), and the dropzone's
 *   refusal line, which is an alert.
 * @usage cd aimeat && pnpm exec vitest run test/unit/atelier-shop-words.test.ts
 * @version-history
 *   v1.0.0 - 2026-10-01 - Initial (atelier 0.62.1, the shop parts in three languages).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: any;
let doc: any;
let kit: any;
let fmt: any;
let anime: any;
let lenis: any;
let flow: any;
let shop: any;
let parts: any;

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  doc = restore.document;
  fmt = await import('../../src/static/sdk-libs/_core/format.js');
  kit = await import('../../src/static/sdk-libs/atelier/i18n.js');
  anime = await import('../../src/static/sdk-libs/atelier/anime-parts.js');
  lenis = await import('../../src/static/sdk-libs/atelier/lenis-parts.js');
  flow = await import('../../src/static/sdk-libs/atelier/flow-parts.js');
  shop = await import('../../src/static/sdk-libs/atelier/cart.js');
  parts = await import('../../src/static/sdk-libs/atelier/parts.js');
});
afterEach(() => { doc.body.innerHTML = ''; kit.i18n.setLang('en'); });
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
const byClass = (root: any, cls: string) => all(root)
  .filter((n) => String(n.className || '').split(/\s+/).includes(cls));
const click = (n: any) => n.dispatchEvent({ type: 'click', bubbles: true });

/** What a person sees or hears: the text of every leaf, every aria-label and placeholder. */
function heard(root: any): string[] {
  const out: string[] = [];
  for (const n of all(root)) {
    if (!(n.children || []).length && n.textContent) out.push(String(n.textContent).trim());
    for (const a of ['aria-label', 'placeholder']) if (n.attrs && n.attrs[a]) out.push(String(n.attrs[a]).trim());
  }
  return out.filter(Boolean);
}

/** A symbol after the number, the way cart and checkout write '€'. */
const after = (n: number, sym: string, d: number) =>
  fmt.num(n, { minimumFractionDigits: d, maximumFractionDigits: d }) + ' ' + sym;

/** Every part, drawn with data that brings out all of its own words. */
function drawAll(): any {
  const h = host();
  anime.priceTable({ target: h, data: { currency: '€', plans: [
    { id: 'pro', name: 'Pro', price: 19, priceYearly: 190, highlight: true },
    { id: 'base', name: 'Base', price: 9 },
  ] } });
  anime.calendar({ target: h, data: { month: '2026-09' } });
  shop.cart({ target: h, data: { currency: '€', lines: [{ id: 'a', title: 'Flour', price: 5.9, qty: 2 }] } });
  shop.cart({ target: h, data: { lines: [] } });
  const co = lenis.checkout({ target: h, onBack() {}, data: {
    lines: [{ id: 'l1', title: 'Coffee', price: 18.9, qty: 2 }],
    shipping: [{ id: 'std', label: 'Posti', price: 5.9 }] } });
  lenis.checkout({ target: h, data: { lines: [] } });
  lenis.thread({ target: h, onSend() {}, data: { messages: [
    { id: 'm1', who: 'a', text: 'x', at: new Date().toISOString(), status: 'sent' },
    { id: 'm2', who: 'b', text: 'y', at: new Date(Date.now() - 86400000).toISOString(), status: 'read' },
    { id: 'm3', who: 'c', text: 'z', at: 'not a date', status: 'failed' },
  ] } });
  lenis.thread({ target: h, onSend() {}, data: { messages: [] } });
  flow.sortable({ target: h, data: { items: [{ id: 'a', label: 'Flour' }] } });
  flow.sortable({ target: h, data: { items: [] } });
  flow.notices({ target: h, data: { items: [
    { id: 'n1', title: 'A', at: new Date().toISOString() },
    { id: 'n2', title: 'B', at: new Date(Date.now() - 86400000).toISOString() },
    { id: 'n3', title: 'C', at: 'never' },
  ] } });
  flow.notices({ target: h, data: { items: [] } });
  flow.facets({ target: h, data: { facets: [{ id: 'f', label: 'Kind', options: [{ id: 'x', label: 'X' }] }] } });
  flow.facets({ target: h, selected: { f: ['x'] }, data: { facets: [{ id: 'f', label: 'Kind', options: [{ id: 'x', label: 'X' }] }] } });
  flow.facets({ target: h, selected: { f: ['x', 'y'] }, data: { facets: [{ id: 'f', label: 'Kind', multi: true, options: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }] }] } });
  flow.facets({ target: h, data: { facets: [] } });
  // The refusals of an empty contact form, and the settled line after a good order.
  click(byClass(co.el, 'ak-checkout__place')[0]);
  return h;
}

/** Each English word the parts drew before this change, as it was drawn. */
const ENGLISH = [
  // priceTable and the calendar
  'Month', 'Year', '/month', 'Choose', 'Most chosen', 'Billing period',
  'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat',
  // cart
  'Remove', 'Total', 'Checkout', 'One fewer', 'One more', 'Your cart is empty', 'Anything you add shows up here.',
  // checkout
  'Your order', 'Details', 'Delivery', 'Review', 'Items', 'Full name', 'Email', 'Where the receipt goes.',
  'Street address', 'Postcode', 'City', 'Country', 'Continue to delivery', 'Place order', 'Order steps',
  'A note with the order', 'Anything we should know?', '↩ Back', 'Nothing in the order',
  'Add something and it appears here.', 'Delivery is agreed after the order is in.',
  'Full name is needed before the order can go.',
  // thread
  'Sent', 'Read', 'Not sent', 'Today', 'Yesterday', 'Earlier', 'Discussion', 'Write a message…', 'Send',
  'No messages yet', 'Write the first one.',
  // sortable, notices, facets
  'Move Flour', 'Nothing to put in order', 'Mark all read', 'Nothing new', 'Notices land here as they arrive.',
  'Clear', 'No filters', '1 filter', '2 filters', 'Nothing to filter by',
];

describe('the shop parts in English', () => {
  it('draw every word exactly as before', () => {
    kit.i18n.setLang('en');
    const seen = heard(drawAll());
    const missing = ENGLISH.filter((w) => !seen.includes(w));
    expect(missing).toEqual([]);
  });

  it('draw the checkout totals as before when no delivery is offered', () => {
    kit.i18n.setLang('en');
    const h = host();
    lenis.checkout({ target: h, data: { lines: [{ id: 'l1', title: 'Coffee', price: 1, qty: 1 }] } });
    expect(heard(h)).toContain('Chosen after the order');
  });
});

for (const lang of ['fi', 'es']) {
  describe('the shop parts in ' + lang, () => {
    it('leave no English word of their own', () => {
      kit.i18n.setLang(lang);
      // A word that is the same in this language ('Total' in Spanish) is not English left behind.
      const same = new Set(kit.KIT_KEYS.en.map((k: string) => kit.i18n.t(k)));
      const seen = heard(drawAll());
      const left = ENGLISH.filter((w) => !same.has(w) && seen.includes(w));
      expect(left).toEqual([]);
      const h = host();
      lenis.checkout({ target: h, data: { lines: [{ id: 'l1', title: 'Coffee', price: 1, qty: 1 }] } });
      expect(heard(h)).not.toContain('Chosen after the order');
      expect(heard(h)).toContain(kit.i18n.t('coShipLater'));
    });

    it('take the words from the dictionary', () => {
      kit.i18n.setLang(lang);
      const seen = heard(drawAll());
      for (const key of ['priceMonth', 'priceYear', 'pricePerMonth', 'priceChoose', 'priceMostChosen',
        'pricePeriods', 'wd1', 'cartRemove', 'cartCheckout', 'cartFewer', 'cartMore', 'cartEmpty', 'total',
        'coOrder', 'coDetails', 'coDelivery', 'coReview', 'coItems', 'coName', 'coEmail', 'coEmailHint',
        'coAddress', 'coPostcode', 'coCity', 'coCountry', 'coContinue', 'coNoShipping', 'coNote',
        'coNotePlaceholder', 'coPlace', 'coSteps', 'coNeeded', 'threadSent', 'threadRead', 'threadFailed',
        'today', 'yesterday', 'earlier', 'threadLabel', 'threadPlaceholder', 'threadEmpty', 'send',
        'sortEmpty', 'noticesMarkAll', 'noticesEmpty', 'facetsClear', 'facetsNone', 'facets1', 'facetsEmpty']) {
        expect(seen, key).toContain(kit.i18n.t(key, { field: kit.i18n.t('coName') }));
      }
      expect(seen).toContain(kit.i18n.t('facetsN', { n: 2 }));
      expect(seen).toContain(kit.i18n.t('sortMove', { label: 'Flour' }));
      expect(seen).toContain('↩ ' + kit.i18n.t('back'));
    });
  });
}

describe('an app overrides a word', () => {
  it('through i18n.use()', () => {
    kit.i18n.setLang('fi');
    kit.i18n.use({ fi: { cartCheckout: 'Maksamaan' } });
    const h = host();
    shop.cart({ target: h, data: { lines: [{ id: 'a', title: 'Flour', price: 1, qty: 1 }] } });
    expect(byClass(h, 'ak-cart__checkout')[0].textContent).toBe('Maksamaan');
    kit.i18n.use({ fi: { cartCheckout: '' } });
  });
});

describe('the kit dictionary', () => {
  it('carries the same keys in en, fi and es', () => {
    const { en, fi, es } = kit.KIT_KEYS;
    expect([...fi].sort()).toEqual([...en].sort());
    expect([...es].sort()).toEqual([...en].sort());
  });
});

describe('the cart line', () => {
  const sub = (h: any) => byClass(h, 'ak-cart__linesub')[0];

  it('shows the unit price when there is more than one', () => {
    const h = host();
    shop.cart({ target: h, data: { currency: '€', lines: [{ id: 'a', title: 'Flour', price: 5.9, qty: 2 }] } });
    expect(sub(h).textContent).toBe('2 × ' + after(5.9, '€', 2));
    expect(sub(h).hidden).toBe(false);
    expect(byClass(h, 'ak-cart__price')[0].textContent).toBe(after(11.8, '€', 2));
  });

  it('keeps its own sub text and puts the unit price after it', () => {
    const h = host();
    shop.cart({ target: h, data: { currency: '€', lines: [{ id: 'a', title: 'Flour', sub: 'Rye, 1 kg', price: 5.9, qty: 3 }] } });
    expect(sub(h).textContent).toBe('Rye, 1 kg · 3 × ' + after(5.9, '€', 2));
  });

  it('reads the unit price from micro-units the same way as the total', () => {
    const h = host();
    shop.cart({ target: h, data: { currency: 'EUR', lines: [{ id: 'a', title: 'Call', priceMicros: 1500, qty: 2 }] } });
    expect(sub(h).textContent).toBe('2 × ' + fmt.money(0.0015, 'EUR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }));
  });

  it('says nothing extra for one item, and follows the stepper', () => {
    const h = host();
    shop.cart({ target: h, data: { currency: '€', lines: [{ id: 'a', title: 'Flour', price: 5.9, qty: 1 }] } });
    expect(sub(h).textContent).toBe('');
    expect(sub(h).hidden).toBe(true);
    const [fewer, more] = byClass(h, 'ak-cart__step');
    click(more);
    expect(sub(h).textContent).toBe('2 × ' + after(5.9, '€', 2));
    expect(sub(h).hidden).toBe(false);
    click(fewer);
    expect(sub(h).textContent).toBe('');
    expect(sub(h).hidden).toBe(true);
  });

  it('keeps a one-item line with its own sub as it was', () => {
    const h = host();
    shop.cart({ target: h, data: { currency: '€', lines: [{ id: 'a', title: 'Flour', sub: 'Rye', price: 5.9, qty: 1 }] } });
    expect(sub(h).textContent).toBe('Rye');
  });
});

describe('the dropzone refusal', () => {
  it('is an alert from the start, and says the refusal', () => {
    const h = host();
    const z = parts.dropzone({ target: h, accept: ['.png'], maxBytes: 1e6 });
    const err = byClass(z.el, 'ak-dropzone__err')[0];
    expect(err.getAttribute('role')).toBe('alert');
    expect(err.hidden).toBe(true);
    const input = all(z.el).find((n) => n.tagName === 'INPUT');
    input.files = [{ name: 'a.txt', size: 10, type: 'text/plain' }];
    input.dispatchEvent({ type: 'change' });
    expect(err.hidden).toBe(false);
    expect(err.textContent).toContain('a.txt');
    expect(err.getAttribute('role')).toBe('alert');
    z.destroy();
  });
});
