/**
 * @file test/unit/app-ai-posture-atelier.test.ts
 * @description The publish check counts the AI label an Atelier component draws on the app's behalf.
 *
 *   THE DEFECT (2026-10-02). lintAppAiDisclosure looked for the app's OWN call to AIMEAT.ai.disclose(),
 *   chatNotice() or declare(). The Atelier components aide, aiChat and aiTask make those calls
 *   themselves (atelier/aide.js, ai-chat.js, ai-task.js), and a mosaic block named aide, aiTask or
 *   aiChat renders one of them (atelier/mosaic.js, mosaic-self.js). An app that uses one shows the EU
 *   AI label and was still recorded with AI_DISCLOSURE_MISSING.
 *
 *   THE REAL CASE is happydude500001/design-book.html on aimeat.io: its only model use is
 *   `K.aide({...})` with `var K = AIMEAT.atelier`, about 393 kB into a 415 kB file, and its manifest
 *   carried the gap. The fixture under test/fixtures/apps/ is that app's stored source as
 *   `curl -s https://aimeat.io/v1/apps/happydude500001/design-book.html` returned it on 2026-10-02,
 *   unchanged, so the last case runs the check on real bytes rather than on a hand-made page.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-ai-posture-atelier.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial. Every Atelier case and the real-source case failed against
 *     DISCLOSURE_CALL as of app-ai-posture.ts v1.5.0 (disclosureCallFound false, gap
 *     AI_DISCLOSURE_MISSING); the silent case passed before and after.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { lintAppAiDisclosure } from '../../src/services/app-ai-posture.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_SOURCE = join(HERE, '..', 'fixtures', 'apps', 'design-book.happydude500001.html');

/** An app on the Atelier track that asks for ai:use and declares no posture. */
const HEAD = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  + '<meta name="aimeat-app" content="atelier.html"><meta name="aimeat-track" content="atelier">'
  + '<meta name="aimeat-scopes" content="memory:read ai:use">'
  + '<title>Atelier app</title></head><body><main id="app"></main>'
  + '<script src="/v1/libs/aimeat-atelier.js"></script>';
const TAIL = '</body></html>';

function app(script: string): string {
  return `${HEAD}<script>${script}</script>${TAIL}`;
}

/** 100 kB of comment: the check must read the whole file, as the real app's call sits deep in it. */
const FAR = '/*' + 'x'.repeat(100 * 1024) + '*/\n';

function expectDisclosed(html: string, label: string) {
  const { posture, hints } = lintAppAiDisclosure(html);
  expect(posture.usesAi, `${label}: ai:use not read`).toBe(true);
  expect(posture.disclosureCallFound, `${label}: the component's label was not seen`).toBe(true);
  expect(posture.gap, `${label}: a labelled app owes no gap`).toBeUndefined();
  // The quieter nudge still applies: it labels, but told no catalogue so.
  expect(hints.join(' ')).toContain('declares no posture');
}

describe('lintAppAiDisclosure: an Atelier component that labels on the app\'s behalf', () => {
  it('aide, called on AIMEAT.atelier', () => {
    expectDisclosed(app(
      'AIMEAT.atelier.aide({ target: "#app", appName: "Errands", sources: {}, actions: [] });',
    ), 'AIMEAT.atelier.aide');
  });

  it('aide through an alias, deep in the file, as design-book.html writes it', () => {
    expectDisclosed(app(
      `var K = AIMEAT.atelier;\n${FAR}K.aide({ target: "#app", appName: "Design Book", sources: { pages: load } });`,
    ), 'K.aide');
  });

  it('aiChat and aiTask through an alias', () => {
    expectDisclosed(app('const K = AIMEAT.atelier; K.aiChat({ target: "#app", appId: "atelier", context: doc });'), 'K.aiChat');
    expectDisclosed(app('const K = AIMEAT.atelier; K.aiTask({ target: "#app", appId: "atelier", prompt: (t) => t });'), 'K.aiTask');
  });

  it('a component taken out of the library by name', () => {
    expectDisclosed(app('const { aide, hero } = AIMEAT.atelier; hero({ target: "#app" }); aide({ target: "#app" });'), 'destructured aide');
  });

  it('a mosaic block that renders aide, aiTask or aiChat', () => {
    expectDisclosed(app(
      'AIMEAT.atelier.mosaic({ target: "#app", blocks: [{ id: "ask", component: "aide", props: { title: "Ask" } }] });',
    ), 'mosaic aide block');
    expectDisclosed(app(
      'const spec = { "blocks": [ { "id": "sum", "component": "aiTask", "props": { "prompt": "Summarise {input}" } } ] };',
    ), 'mosaic aiTask block as JSON');
    expectDisclosed(app('K.mosaic({ blocks: [{ id: "chat", component: \'aiChat\', props: {} }] });'), 'mosaic aiChat block');
  });

  it('still records the gap for an Atelier app that uses none of them', () => {
    const { posture } = lintAppAiDisclosure(app(
      'var K = AIMEAT.atelier; K.hero({ target: "#app", title: "Hi" }); K.table({ target: "#app", rows: [] });'
      + 'document.title = "Ask the aide. aiChat and aiTask are words here, not calls.";',
    ));
    expect(posture.usesAi).toBe(true);
    expect(posture.disclosureCallFound).toBe(false);
    expect(posture.gap?.code).toBe('AI_DISCLOSURE_MISSING');
  });

  it('the real design-book.html source: K.aide() deep in a 415 kB file, no disclose call of its own', () => {
    const html = readFileSync(REAL_SOURCE, 'utf8');
    // What makes this fixture the real case: the alias, the one call, and nothing the old regex read.
    expect(html).toContain('var K = AIMEAT.atelier');
    expect(html.indexOf('K.aide({')).toBeGreaterThan(300 * 1024);
    expect(html).not.toMatch(/\bai\s*\.\s*(disclose|chatNotice|declare)\s*\(/);
    expect(html).not.toMatch(/ai-label|AiLabel|aiProvenance|name="aimeat-ai"/);
    expectDisclosed(html, 'design-book.html');
  });
});
