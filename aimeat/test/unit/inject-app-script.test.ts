/**
 * @file inject-app-script.test.ts
 * @description Unit tests for injectAppScript (subdomains.ts) — the seamless-SSO shim injection.
 *   Locks the prod failure mode: app HTML stored as a Uint8Array (MongoDB/Prisma Bytes) must be
 *   decoded as UTF-8, not stringified to "60,33,68,..." byte values.
 * @version-history
 *   v1.0.0 — 2026-06-20 — Initial (guards the H-2 SSO shim byte-handling bug).
 */
import { describe, it, expect } from 'vitest';
import { injectAppScript } from '../../src/routes/subdomains.js';

const SRC = 'https://aimeat.io/app-login.js';
const HTML = '<!DOCTYPE html><html><head><title>x</title></head><body><h1>hi</h1></body></html>';

describe('injectAppScript', () => {
  it('decodes a Uint8Array body (Prisma/Mongo) as UTF-8 — not "60,33,..." bytes', () => {
    const out = injectAppScript(new Uint8Array(Buffer.from(HTML, 'utf-8')), SRC).toString('utf-8');
    expect(out).not.toMatch(/^\d+,\d+,/);        // the bug: stringified byte values
    expect(out).toContain('<!DOCTYPE html>');
    expect(out).toContain(`<script src="${SRC}"></script>`);
    expect(out).toContain('<h1>hi</h1>');
  });

  it('handles a Node Buffer body (SQLite)', () => {
    const out = injectAppScript(Buffer.from(HTML, 'utf-8'), SRC).toString('utf-8');
    expect(out).toContain('<!DOCTYPE html>');
    expect(out).toContain(`<script src="${SRC}"></script></head>`); // injected before </head>
  });

  it('handles a string body', () => {
    const out = injectAppScript(HTML, SRC).toString('utf-8');
    expect(out).toContain(`<script src="${SRC}"></script>`);
  });

  it('falls back to <body> then prepend when there is no </head>', () => {
    const noHead = injectAppScript('<body><p>x</p></body>', SRC).toString('utf-8');
    expect(noHead).toContain(`<body><script src="${SRC}"></script>`);
    const bare = injectAppScript('<p>x</p>', SRC).toString('utf-8');
    expect(bare.startsWith(`<script src="${SRC}"></script>`)).toBe(true);
  });

  it('round-trips UTF-8 multibyte content intact', () => {
    const fi = '<!DOCTYPE html><head></head><body>Sää: 24 °C — Sanomat ää</body>';
    const out = injectAppScript(new Uint8Array(Buffer.from(fi, 'utf-8')), SRC).toString('utf-8');
    expect(out).toContain('Sää: 24 °C — Sanomat ää');
  });
});
