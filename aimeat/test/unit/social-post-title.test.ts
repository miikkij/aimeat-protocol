/**
 * @file social-post-title.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AIMEAT.social.post(boardId, text) (src/static/sdk-libs/social/index.js) sends a body
 *   POST /v1/boards/:boardId/posts accepts. BoardPostSchema (src/models/schemas.ts) requires a title of
 *   1 to 256 characters; a call with only text gets the title the portal's createPost gives
 *   (public/js/services/boards.js): the trimmed text cut to 80 characters, or 'Post'.
 * @usage cd aimeat && pnpm exec vitest run test/unit/social-post-title.test.ts
 * @version-history
 *   v1.0.0 - 2026-11-15 - Initial: a text-only post carries a title.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const sent: Array<{ path: string; body: any }> = [];
const surfaces: Record<string, any> = {};
vi.mock('../../src/static/sdk-libs/_core/config.js', () => ({ NODE_URL: 'http://node.test' }));
vi.mock('../../src/static/sdk-libs/_core/namespace.js', () => ({ attach: (key: string, value: unknown) => { surfaces[key] = value; return surfaces; } }));
vi.mock('../../src/static/sdk-libs/_core/session.js', () => ({
  makeSession: () => ({
    getSession: () => ({ jwt: 'token' }),
    authFetch: async (path: string, opts: { body?: string }) => { sent.push({ path, body: opts?.body ? JSON.parse(opts.body) : undefined }); return { ok: true, data: { id: 'p1' } }; },
  }),
}));

beforeEach(() => { sent.length = 0; });

async function social() {
  await import('../../src/static/sdk-libs/social/index.js');
  return surfaces.social;
}

describe('AIMEAT.social.post', () => {
  it('gives a text-only post a title from the text, as the portal does', async () => {
    const s = await social();
    await s.post('general', '  Hello board  ');
    await s.post('general', 'x'.repeat(100));
    await s.post('general', { body: 'Body only' });
    expect(sent.map(r => r.path)).toEqual(Array(3).fill('/v1/boards/general/posts'));
    expect(sent.map(r => r.body)).toEqual([
      { title: 'Hello board', body: '  Hello board  ' },
      { title: 'x'.repeat(80), body: 'x'.repeat(100) },
      { title: 'Body only', body: 'Body only' },
    ]);
  });

  it('keeps a title the app gives, and the other fields', async () => {
    const s = await social();
    await s.post('general', { title: 'Hi', body: 'Hello!', category: 'notice', ttl_hours: 24 });
    expect(sent[0].body).toEqual({ title: 'Hi', body: 'Hello!', category: 'notice', ttl_hours: 24 });
  });
});
