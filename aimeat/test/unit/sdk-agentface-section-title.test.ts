/**
 * @file sdk-agentface-section-title.test.ts
 * @description AIMEAT.agentface.compose takes `title` on a section as another name for `heading`
 *   (appdev pitfall app/agentface-sections-need-heading). A section written { title, body }, the
 *   shape the document itself uses, threw "Every section needs a non-empty string heading", so the
 *   face was never written.
 *
 *   FIRST FAIL: against aimeat-agentface v1.2.0 the { title, body } section throws.
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: () => void;
let face: any;

beforeAll(async () => {
  restore = installGlobals({});
  await import('../../src/static/sdk-libs/agentface/index.js');
  face = (window as any).AIMEAT.agentface;
});
afterAll(() => restore());

describe('agentface compose', () => {
  it('reads a section title as its heading', () => {
    expect(face.compose({ title: 'Shop', sections: [{ title: 'Open orders', body: '3 waiting' }] }))
      .toBe('# Shop\n\n## Open orders\n\n3 waiting\n');
  });

  it('prefers heading when a section gives both', () => {
    expect(face.compose({ sections: [{ heading: 'Stock', title: 'ignored', body: 'ok' }] })).toBe('## Stock\n\nok\n');
  });

  it('still refuses a section with neither, naming both names', () => {
    expect(() => face.compose({ sections: [{ body: 'x' }] })).toThrow(/heading.*title/);
  });
});
