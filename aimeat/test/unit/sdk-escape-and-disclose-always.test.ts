/**
 * @file test/unit/sdk-escape-and-disclose-always.test.ts
 * @description Two helpers an app needs and used to write itself, wrong:
 *   - AIMEAT.escapeHtml (_core/escape.js, put on the page by every served library through
 *     _core/namespace.js) escapes & < > " and ', so a value is safe in text and in a quoted
 *     attribute; the DOM form apps copied (textContent then innerHTML) left the quotes;
 *   - AIMEAT.ai.disclose(provenance, { always: true }) draws the short AI label for content that
 *     owes none (a private answer), where it drew nothing and the person could not tell it was AI.
 * @usage cd aimeat && pnpm exec vitest run test/unit/sdk-escape-and-disclose-always.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (pitfall round A6: app/comment-arrow-and-esc-quotes,
 *     ai/ai-disclose-draws-nothing-for-private-answer).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: () => void;
let disclose: any;
let ns: any;
let escape: any;

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  disclose = await import('../../src/static/sdk-libs/ai/disclose.js');
  ns = await import('../../src/static/sdk-libs/_core/namespace.js');
  escape = await import('../../src/static/sdk-libs/_core/escape.js');
});
afterAll(() => restore());

describe('AIMEAT.escapeHtml', () => {
  it('is on the page once any library attaches, and escapes all five characters', () => {
    delete (window as any).AIMEAT;
    ns.attach('probe', {});
    const esc = (window as any).AIMEAT.escapeHtml;
    expect(typeof esc).toBe('function');
    expect(esc('" onmouseover="alert(1)')).toBe('&quot; onmouseover=&quot;alert(1)');
    expect(esc("<b>Tom's & Jerry's</b>")).toBe('&lt;b&gt;Tom&#39;s &amp; Jerry&#39;s&lt;/b&gt;');
  });

  it('turns null and undefined into an empty string and a number into its digits', () => {
    expect(escape.escapeHtml(null)).toBe('');
    expect(escape.escapeHtml(undefined)).toBe('');
    expect(escape.escapeHtml(42)).toBe('42');
  });

  it('leaves an app\'s own escapeHtml as it is', () => {
    const mine = (s: string) => `[${s}]`;
    (window as any).AIMEAT = { escapeHtml: mine };
    ns.attach('probe', {});
    expect((window as any).AIMEAT.escapeHtml).toBe(mine);
  });
});

describe('disclose(provenance, { always: true })', () => {
  const PRIVATE = { record: { spec: 'aimeat.provenance/v1', level: 'ai-generated', disclosure: { required: false } } };
  const hasClass = (n: any, c: string): boolean =>
    !!n && ((typeof n.className === 'string' && n.className.split(' ').includes(c)) || (n.children || []).some((k: any) => hasClass(k, c)));

  it('draws the short, light label for an answer that owes none', () => {
    const label = disclose.disclose(PRIVATE, { always: true, variant: 'block' });
    expect(label).not.toBeNull();
    expect(label.className).toContain('ai-label--inline');
    expect(label.className).toContain('ai-label--light');
    expect(hasClass(label, 'ai-label__short')).toBe(true);
    expect(hasClass(label, 'ai-label__long')).toBe(false);
  });

  it('without always it still draws nothing for that answer', () => {
    expect(disclose.disclose(PRIVATE)).toBeNull();
  });

  it('content no model made draws nothing even with always', () => {
    const original = { record: { spec: 'aimeat.provenance/v1', level: 'original', disclosure: { required: false } } };
    expect(disclose.disclose(original, { always: true })).toBeNull();
  });
});
