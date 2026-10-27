/**
 * @file test/unit/document-file-link-inert.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A file link in a workspace document opens the file in a new tab through an object URL
 *   on the node's own origin, where the reader's session lives. A file another member stored as HTML,
 *   SVG or XML opened there as an active document; it now opens as plain text, as the Files view
 *   opens it (secaudit2026oct26, aimeat-public-workspace-document-file-link-blob-apex-origin). The
 *   usage half: a PDF, an image, audio, video and plain text still open as themselves, and the
 *   fetch still carries the reader's session.
 * @usage cd aimeat && pnpm exec vitest run test/unit/document-file-link-inert.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('/js/api.js', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPatch: vi.fn() }));
vi.mock('/js/services/auth.js', () => ({ authHeaders: () => ({ Authorization: 'Bearer reader-token' }) }));

const images = await import('../../public/js/services/organisms.images.js') as Record<string, unknown>;

let made: Blob[] = [];
let sentHeaders: Record<string, string> | undefined;
const realCreate = URL.createObjectURL;
const realFetch = globalThis.fetch;

function serve(type: string): void {
  globalThis.fetch = vi.fn(async (_url: unknown, init?: { headers?: Record<string, string> }) => {
    sentHeaders = init?.headers;
    return new Response(new Blob(['<h1>x</h1>'], { type }), { status: 200, headers: { 'Content-Type': type } });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  made = [];
  sentHeaders = undefined;
  URL.createObjectURL = ((b: Blob) => { made.push(b); return 'blob:test/1'; }) as typeof URL.createObjectURL;
});
afterEach(() => {
  URL.createObjectURL = realCreate;
  globalThis.fetch = realFetch;
});

/** The object URL the document's link click opens. */
async function openLink(type: string): Promise<Blob> {
  serve(type);
  const open = images.fetchStorageTabUrl as ((url: string) => Promise<string>) | undefined;
  expect(typeof open, 'organisms.images.js has no fetchStorageTabUrl for the link click').toBe('function');
  await open!('/v1/pub/bob/files/x');
  expect(made.length).toBe(1);
  return made[0]!;
}

describe('a workspace document file link opens an inert blob', () => {
  for (const t of ['text/html', 'image/svg+xml', 'application/xhtml+xml', 'text/xml']) {
    it(`${t} opens as plain text`, async () => {
      expect((await openLink(t)).type).toBe('text/plain;charset=utf-8');
    });
  }

  for (const t of ['application/pdf', 'image/png', 'audio/mpeg', 'video/mp4', 'text/plain']) {
    it(`${t} opens as itself, fetched with the reader's session`, async () => {
      expect((await openLink(t)).type).toBe(t);
      expect(sentHeaders?.Authorization).toBe('Bearer reader-token');
    });
  }

  it('the document view opens a file link through the inert fetch, not the image fetch', () => {
    const src = readFileSync(fileURLToPath(new URL('../../public/views/profile/organisms/document.js', import.meta.url)), 'utf8');
    const click = src.slice(src.indexOf('const onDocClick'), src.indexOf('// created/saved/published timestamps'));
    expect(click.length).toBeGreaterThan(0);
    expect(click).toContain('fetchStorageTabUrl(href)');
    expect(click).not.toContain('fetchStorageObjectUrl(');
  });
});
