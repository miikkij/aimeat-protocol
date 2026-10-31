/**
 * @file test/unit/sdk-ai-disclose-lang.test.ts
 * @description The AI label an app draws (AIMEAT.ai.disclose) speaks the language the sign-in pill
 *   speaks: the place's own language before the browser, and `<html lang>` does not override it.
 *   Every genre ships `<html lang="en">`, so on a Finnish place with an English browser the label read
 *   "AI-generated" beside a Finnish pill (crew34 check, 2026-10-31). The source was broken.
 * @usage pnpm exec vitest run test/unit/sdk-ai-disclose-lang.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-31 -- Initial (v31, the language finding of the crew34 check).
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: (() => void) & { document?: any };
let ai: any;

/** The page as a genre leaves it: `lang="en"`, the place's language in the prelude, an English browser. */
function place(defaultLocale: string | undefined, extra: { stored?: string; html?: string } = {}) {
  restore = installGlobals({ motion: 'less', navigator: { language: 'en-US' } } as any) as any;
  (globalThis as any).__AIMEAT_SDK_CFG__ = { nodeId: 'stub-node', baseUrl: 'http://localhost:40050', defaultLocale };
  restore.document.documentElement.lang = extra.html ?? 'en';
  if (extra.stored) (globalThis as any).localStorage.setItem('aimeat-lang', extra.stored);
}

const record = { id: 'prov-1', level: 'ai-generated', disclosure: { required: true, strength: 'light' }, attestation: {} };

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' }) as any;
  ai = await import('../../src/static/sdk-libs/ai/disclose.js');
  restore();
});
afterEach(() => restore());

describe('the AI label speaks the place\'s language', () => {
  it('Finnish on a Finnish place, though the page says lang="en" and the browser is English', () => {
    place('fi');
    expect(ai.disclose({ record }).textContent).toContain('Tekoälyn tuottama');
  });

  it('Spanish on a Spanish place', () => {
    place('es');
    expect(ai.disclose({ record }).textContent).toContain('Generado por IA');
  });

  it('the person\'s stored choice before the place', () => {
    place('fi', { stored: 'en' });
    expect(ai.disclose({ record }).textContent).toContain('AI-generated');
  });

  it('the browser when the place names no language', () => {
    place(undefined);
    expect(ai.disclose({ record }).textContent).toContain('AI-generated');
  });
});
