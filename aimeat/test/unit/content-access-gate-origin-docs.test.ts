/**
 * @file test/unit/content-access-gate-origin-docs.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the origin of an app opened to the internet serves a stranger on a signed-in-only
 *   node (secaudit2026oct26, content-access-gate.ts:opened-app-origin-passes-every-non-v1-path): the
 *   app's own documents, its legal pages and the open static files, and none of the node's discovery
 *   documents. The legal page paths are spelled in the gate; this test holds them equal to the
 *   service that serves them.
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect } from 'vitest';
import { isOpenedOriginDocument } from '../../src/middleware/content-access-gate.js';
import { LEGAL_KIND_INFO } from '../../src/services/app-legal.js';
import { APP_LEGAL_KINDS } from '../../src/storage/types/apps.js';

describe('the opened app origin', () => {
  it('serves every legal page path the app legal service serves', () => {
    for (const kind of APP_LEGAL_KINDS) expect(isOpenedOriginDocument('GET', LEGAL_KIND_INFO[kind].path), kind).toBe(true);
  });

  it.each([
    '/llms.txt', '/llms-full.txt', '/robots.txt', '/sitemap.xml', '/sitemap.md', '/.md', '/index.md', '/AGENTS.md',
    '/agents.md', '/manifest.webmanifest', '/icon.svg', '/apple-touch-icon.png', '/.well-known/mcp.json',
    '/.well-known/mcp/server-card.json', '/webmcp', '/webmcp/tools', '/favicon.ico', '/favicon.svg', '/sw.js',
  ])('serves %s', (path) => {
    expect(isOpenedOriginDocument('GET', path)).toBe(true);
    expect(isOpenedOriginDocument('HEAD', path)).toBe(true);
  });

  it.each([
    '/.well-known/agent-card.json', '/.well-known/agent-skills/index.json', '/.well-known/agent-skills/x/SKILL.md',
    '/.well-known/ucp', '/.well-known/acp.json', '/sitemap-apps.xml', '/v1/apps', '/v1/libs/aimeat-auth.js', '/anything',
  ])('does not pass %s outside the open /v1/ routes', (path) => {
    expect(isOpenedOriginDocument('GET', path)).toBe(false);
  });

  it('passes no write', () => {
    expect(isOpenedOriginDocument('POST', '/llms.txt')).toBe(false);
  });
});
