/**
 * @file test/unit/check-find-fields.test.ts
 * @description Proof of the two halves of the find-field autofill defence. The guard
 *   (public/js/find-field-guard.js) refuses an input event the browser's own autofill made, which
 *   is trusted, and one an extension made, which is not, and lets a person's typing and an emptied
 *   field through. The gate (scripts/check-find-fields.ts) refuses a find field the guard cannot
 *   see and stays quiet for a guarded one and for a field that only contains a find word in its
 *   fallback sentence.
 * @usage cd aimeat && pnpm exec vitest run test/unit/check-find-fields.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial, with the guard and the gate.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { checkInput, checkTextField } from '../../scripts/check-find-fields.js';

type Guard = typeof import('../../public/js/find-field-guard.js');
let guard: Guard;

beforeAll(async () => {
  // The guard reads which autofill selectors the engine knows when it loads.
  (globalThis as { CSS?: unknown }).CSS = { supports: (q: string) => q === 'selector(:autofill)' };
  guard = await import('../../public/js/find-field-guard.js');
});

function field(value: string, autofilled: boolean) {
  return { tagName: 'INPUT', type: 'search', value, hasAttribute: () => false, matches: (s: string) => autofilled && s === ':autofill' };
}

describe('find-field guard', () => {
  it('refuses the browser autofill: a trusted event on a field in the autofill state', () => {
    const el = field('happydude500001', true);
    expect(guard.refusedInput({ isTrusted: true, currentTarget: el, target: el } as unknown as Event)).toBe(true);
  });

  it('refuses an extension fill: an untrusted event with text', () => {
    const el = field('alice', false);
    expect(guard.refusedInput({ isTrusted: false, currentTarget: el, target: el } as unknown as Event)).toBe(true);
  });

  it('lets typing through, and an emptied field whatever made it', () => {
    const typed = field('notes', false);
    expect(guard.refusedInput({ isTrusted: true, currentTarget: typed, target: typed } as unknown as Event)).toBe(false);
    const emptied = field('', true);
    expect(guard.refusedInput({ isTrusted: false, currentTarget: emptied, target: emptied } as unknown as Event)).toBe(false);
  });

  it('knows a find field by type="search" or data-find', () => {
    expect(guard.isFindField({ tagName: 'INPUT', type: 'search', hasAttribute: () => false } as unknown as Element)).toBe(true);
    expect(guard.isFindField({ tagName: 'INPUT', type: 'text', hasAttribute: (a: string) => a === 'data-find' } as unknown as Element)).toBe(true);
    expect(guard.isFindField({ tagName: 'INPUT', type: 'text', hasAttribute: () => false } as unknown as Element)).toBe(false);
  });
});

describe('check:find-fields', () => {
  it('refuses a text input that is a find field and is neither type="search" nor data-find', () => {
    expect(checkInput('<input class="og-input cat-search" type="text" value=${q} onInput=${(e) => setQ(e.target.value)} />')).not.toBeNull();
    expect(checkInput('<input class="x" type="text" autocomplete="off" data-lpignore="true" data-form-type="other" />')).not.toBeNull();
    // SearchLine before 2026-11-14: the App Catalog search, type="text" by the `text` prop.
    expect(checkInput('<input class="og-input" id=${id} type=${text ? \'text\' : \'search\'} value=${value} autocomplete="off" />')).not.toBeNull();
  });

  it('accepts a guarded find field, a computed type, a non-text type and an opt-out', () => {
    expect(checkInput('<input class="cat-search" type="search" />')).toBeNull();
    expect(checkInput('<input class="cat-search" type="text" data-find />')).toBeNull();
    expect(checkInput('<input class="og-input" type=${kind} />')).toBeNull();
    expect(checkInput('<input class="og-input" type=${text ? \'text\' : \'search\'} data-find />')).toBeNull();
    expect(checkInput('<input type="checkbox" class="filter-toggle" />')).toBeNull();
    expect(checkInput('<input class="filter-value" type="text" data-not-find />')).toBeNull();
  });

  it('does not take a handler or a plain text field for a find field', () => {
    expect(checkInput('<input type="text" placeholder="e.g. Alice" onInput=${e => setFilter(e.target.value)} />')).toBeNull();
  });

  it('refuses a TextField find without `search`, and not one whose fallback sentence says find', () => {
    expect(checkTextField('<${TextField} placeholder=${c(\'searchPlaceholder\')} value=${q} onInput=${setQ} />')).not.toBeNull();
    expect(checkTextField('<${TextField} search placeholder=${c(\'searchPlaceholder\')} value=${q} />')).toBeNull();
    expect(checkTextField('<${TextField} placeholder=${g(\'askPlaceholder\', \'For example: find out our competitors\')} />')).toBeNull();
    expect(checkTextField('<${TextField} placeholder=${g(\'skillsPh\', \'research, writing\')} />')).toBeNull();
  });
});
