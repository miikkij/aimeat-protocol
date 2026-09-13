/**
 * @file test/unit/sdk-atelier-appref.test.ts
 * @description The two ends of `#aimeat-app-ref` agree. The node writes the block
 *   (utils/app-agent-discovery.ts appRefSnippet) and the kit reads it (atelier/mosaic-layout.js
 *   appRef). Until 2026-09-13 the node HTML-escaped the JSON, which a script element's text never
 *   decodes, so every reader had to undo entities by hand and the WebMCP bridge, which did not,
 *   read null. The node now writes script-safe JSON; this proves the kit reads that form straight,
 *   and still reads the escaped form a page served before the change carries.
 * @usage cd aimeat && pnpm exec vitest run test/unit/sdk-atelier-appref.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial (appdev pitfall appref-block-is-injected-after-your-script).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';
import { appRefSnippet } from '../../src/utils/app-agent-discovery.js';

type AnyEl = any;

let restore: any;
let appRef: () => { owner: string; filename: string } | null;
let doc: AnyEl;

beforeAll(async () => {
  restore = installGlobals({ motion: 'auto' });
  doc = restore.document;
  ({ appRef } = await import(new URL('../../src/static/sdk-libs/atelier/mosaic-layout.js', import.meta.url).href));
});

afterAll(() => { if (restore) restore(); });

/** Put a ref block with this raw text into the head, the way the browser's parser leaves it. */
function withBlock(text: string, run: () => void): void {
  const node = doc.createElement('script');
  node.id = 'aimeat-app-ref';
  node.textContent = text;
  doc.head.appendChild(node);
  try { run(); } finally { node.remove(); }
}

/** The text between the tags of a snippet, which is what textContent answers in a browser. */
function innerOf(snippet: string): string {
  return snippet.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
}

describe('appRef reads what the node writes', () => {
  it('reads the block the node serves today, a filename with markup characters included', () => {
    const snippet = appRefSnippet({ owner: 'alice', filename: 'a&b<c>.html', baseUrl: 'https://aimeat.io' });
    withBlock(innerOf(snippet), () => {
      expect(appRef()).toEqual({ owner: 'alice', filename: 'a&b<c>.html' });
    });
  });

  it('still reads the HTML-escaped block of a page served before the change', () => {
    withBlock('{&quot;owner&quot;:&quot;alice&quot;,&quot;app_id&quot;:&quot;demo.html&quot;}', () => {
      expect(appRef()).toEqual({ owner: 'alice', filename: 'demo.html' });
    });
  });

  it('answers null when the page has no block', () => {
    expect(appRef()).toBe(null);
  });
});
