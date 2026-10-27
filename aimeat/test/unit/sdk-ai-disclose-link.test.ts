/**
 * @file test/unit/sdk-ai-disclose-link.test.ts
 * @description The "How this was made" link of AIMEAT.ai.disclose() and AIMEAT.ai.chatNotice() takes
 *   only a link the browser opens as a page: http(s), mailto or a relative address, by the same rule
 *   AIMEAT.md.sanitizeHref applies (secaudit2026oct26, sdk-libs/ai/disclose:buildLabel-recordUrl-unchecked-scheme).
 *   The record an app labels can be an item another person stored, so its recordUrl is that
 *   person's text. A link the node builds (https, or a relative /v1/... address) is drawn as before.
 * @usage pnpm exec vitest run test/unit/sdk-ai-disclose-link.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Initial (secaudit2026oct26).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: () => void;
let ai: any;

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  ai = await import('../../src/static/sdk-libs/ai/disclose.js');
});
afterAll(() => restore());

/** A record that owes a label, as the node mints it, with the given recordUrl in its attestation. */
const recordWith = (recordUrl?: string) => ({
  id: 'prov-1',
  level: 'ai-generated',
  disclosure: { required: true, strength: 'light' },
  attestation: recordUrl === undefined ? {} : { recordUrl },
});

function links(root: any): any[] {
  const out: any[] = [];
  const walk = (n: any) => {
    if (!n) return;
    if (typeof n.className === 'string' && n.className.includes('ai-label__link')) out.push(n);
    for (const c of n.children || []) walk(c);
  };
  walk(root);
  return out;
}

describe('disclose() draws the link only for an address the browser opens as a page', () => {
  it('a javascript: recordUrl stored in the item draws the label and no link', () => {
    const label = ai.disclose({ record: recordWith('javascript:alert(document.domain)') });
    expect(label).not.toBeNull();
    expect(links(label)).toHaveLength(0);
  });

  it('the same with tabs and controls in the scheme, and a data: or vbscript: address', () => {
    for (const bad of ['java\tscript:alert(1)', '\u0001javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x']) {
      const label = ai.disclose({ record: recordWith(bad) });
      expect(links(label), bad).toHaveLength(0);
    }
  });

  it('a recordUrl given beside the record is checked the same way', () => {
    const label = ai.disclose({ record: recordWith(), recordUrl: 'javascript:alert(1)' });
    expect(links(label)).toHaveLength(0);
  });

  it('a link the node builds is drawn as before: https and a relative address', () => {
    const https = ai.disclose({ record: recordWith(), recordUrl: 'https://node.example/v1/ai/provenance/prov-1' });
    expect(links(https).map(a => a.href)).toEqual(['https://node.example/v1/ai/provenance/prov-1']);
    const relative = ai.disclose(recordWith('/v1/ai/provenance/prov-1'));
    expect(links(relative).map(a => a.href)).toEqual(['/v1/ai/provenance/prov-1']);
    expect(links(relative)[0].target).toBe('_blank');
  });

  it('a record that owes no label still draws nothing', () => {
    expect(ai.disclose({ record: { disclosure: { required: false } } })).toBeNull();
  });
});

describe('chatNotice() checks its recordUrl the same way', () => {
  it('a javascript: recordUrl draws the notice and no link', () => {
    const notice = ai.chatNotice({ recordUrl: 'javascript:alert(1)' });
    expect(notice).not.toBeNull();
    expect(links(notice)).toHaveLength(0);
  });
  it('an https recordUrl is drawn as before', () => {
    const notice = ai.chatNotice({ recordUrl: 'https://node.example/v1/ai/provenance/prov-2' });
    expect(links(notice).map(a => a.href)).toEqual(['https://node.example/v1/ai/provenance/prov-2']);
  });
});
