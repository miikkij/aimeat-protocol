/**
 * @file test/unit/csp-script-hashes.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description addedScriptHashes() and withScriptHashes() (utils/csp-nonce.ts): a page served without
 *   the CSP nonce still runs the inline scripts the node's own serve marks added, by their hash, and
 *   only those. A script the page already carried gets no hash, even when the marks add the same text.
 * @version-history
 *   v1.1.0 — 2026-10-30 — A script's end tag is read as a browser reads it (code scanning 1774).
 *   v1.0.0 — 2026-10-30 — Initial (the Design Book preview's AI-label script was refused on a grown
 *     genre's frame card).
 */
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { addedScriptHashes, withScriptHashes } from '../../src/utils/csp-nonce.js';

const hash = (s: string) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;
const LABEL = '(function(){var e=document.getElementById("aimeat-ai-label");})();';

describe('addedScriptHashes', () => {
  it('names the inline script the marks added', () => {
    const before = '<html><body><p>card</p></body></html>';
    const after = `<html><body><p>card</p><div id="aimeat-ai-label"></div><script>${LABEL}</script></body></html>`;
    expect(addedScriptHashes(before, after)).toEqual([hash(LABEL)]);
  });

  it('leaves out a script the page already carried', () => {
    const smuggled = 'alert(1)';
    const before = `<body><script>${smuggled}</script></body>`;
    const after = `<body><script>${smuggled}</script><script>${LABEL}</script></body>`;
    expect(addedScriptHashes(before, after)).toEqual([hash(LABEL)]);
  });

  it('skips scripts with a src and data blocks', () => {
    const before = '<body></body>';
    const after = '<body><script src="/x.js"></script><script type="application/ld+json">{"a":1}</script></body>';
    expect(addedScriptHashes(before, after)).toEqual([]);
  });

  it('ends a script where a browser ends it: "</script >" and "</SCRIPT foo>" close it, "</scripts>" does not', () => {
    const before = '<body><script>a()</script ><script>b()</SCRIPT foo></body>';
    const after = `${before.replace('</body>', '')}<script>c("</scripts>")</script\t></body>`;
    expect(addedScriptHashes(before, after)).toEqual([hash('c("</scripts>")')]);
  });

  it('counts copies: a second copy of a script the page had is the marks\' own', () => {
    const before = `<body><script>${LABEL}</script></body>`;
    const after = `<body><script>${LABEL}</script><script>${LABEL}</script></body>`;
    expect(addedScriptHashes(before, after)).toEqual([hash(LABEL)]);
  });
});

describe('withScriptHashes', () => {
  it('adds the hashes to script-src and changes nothing else', () => {
    const csp = "default-src 'self'; script-src 'self' https://cdn.example; style-src 'self'";
    expect(withScriptHashes(csp, ["'sha256-abc'"])).toBe("default-src 'self'; script-src 'self' https://cdn.example 'sha256-abc'; style-src 'self'");
  });

  it('is a no-op without hashes', () => {
    expect(withScriptHashes("script-src 'self'", [])).toBe("script-src 'self'");
  });
});
