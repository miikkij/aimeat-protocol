/**
 * @file sdk-agentface-owner-only.test.ts
 * @description AIMEAT.agentface.publish and publishQuietly write the face only when the signed-in
 *   account is the app's owner, the one the node names in the served page (the aimeat-app-ref
 *   block). The node serves the face from the owner's record alone, so a write as anybody else
 *   landed in that person's own namespace as a public record nothing reads: it only showed that
 *   the account had opened the app, and with it whatever the app had put into its face.
 *
 *   FIRST FAIL: against aimeat-agentface v1.2.1 every signed-in account posts the record, so the
 *   three "writes nothing" cases see one request each.
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: () => void;
let face: any;
let posts: Array<{ url: string; body: any }>;

/** A signed-in session as aimeat-auth hands it out, with its fetch recorded. */
function signIn(owner: string | null, ghii?: string) {
  const session = owner === null ? null : {
    owner,
    ghii: ghii || (owner.indexOf('@') >= 0 ? owner : owner + '@stub-node'),
    fetch: async (url: string, init: any) => {
      posts.push({ url, body: JSON.parse(init.body) });
      return { ok: true, data: { version: 7 } };
    },
  };
  (window as any).AIMEAT.auth = { getSession: () => session };
}

/** The block the node puts into the head of every app it serves, or none (a file opened from disk). */
function servedBy(owner: string | null) {
  const old = document.getElementById('aimeat-app-ref');
  if (old && old.parentNode) old.parentNode.removeChild(old);
  if (owner === null) return;
  const node = document.createElement('script');
  node.id = 'aimeat-app-ref';
  node.textContent = JSON.stringify({ owner, app_id: 'shop.html', app: owner + '/shop.html', tools: [] });
  document.head.appendChild(node);
}

beforeAll(async () => {
  restore = installGlobals({});
  await import('../../src/static/sdk-libs/agentface/index.js');
  face = (window as any).AIMEAT.agentface;
});
afterAll(() => restore());
beforeEach(() => { posts = []; });

describe('agentface publish: the owner writes the face', () => {
  it('posts the public record when the signed-in account is the owner the page names', async () => {
    servedBy('alice'); signIn('alice');
    const out = await face.publish('# Shop\n', { app: 'shop.html' });
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe('/v1/memory');
    expect(posts[0].body).toEqual({ key: 'apps.shop.html.agentface', value: '# Shop\n', visibility: 'public' });
    expect(out).toMatchObject({ key: 'apps.shop.html.agentface', app: 'shop.html', version: 7, visibility: 'public', written: true });
  });

  it('keeps writing on a page that names no owner: a file opened from disk, the library test page', async () => {
    servedBy(null); signIn('bob');
    const out = await face.publish('# Shop\n', { app: 'shop.html' });
    expect(posts).toHaveLength(1);
    expect(out.written).toBe(true);
  });

  it('still refuses when nobody is signed in', async () => {
    servedBy('alice'); signIn(null);
    await expect(face.publish('# Shop\n', { app: 'shop.html' })).rejects.toThrow(/Not signed in/);
    expect(posts).toHaveLength(0);
  });
});

describe('agentface publish: anybody else writes nothing', () => {
  it('makes no request for another account, and answers that nothing was written', async () => {
    servedBy('alice'); signIn('bob');
    const out = await face.publish('# Shop\n', { app: 'shop.html' });
    expect(posts).toHaveLength(0);
    expect(out).toEqual({ key: 'apps.shop.html.agentface', app: 'shop.html', written: false, reason: 'not-owner' });
  });

  it('does not take a visitor from another node for the local account of the same name', async () => {
    servedBy('alice'); signIn('alice@other-node', 'alice@other-node');
    const out = await face.publish('# Shop\n', { app: 'shop.html' });
    expect(posts).toHaveLength(0);
    expect(out.written).toBe(false);
  });

  it('compares the whole name: a longer, a shorter and another spelling are other accounts', async () => {
    servedBy('alice');
    for (const name of ['alice2', 'alic', 'Alice']) {
      signIn(name);
      expect((await face.publish('# Shop\n', { app: 'shop.html' })).written).toBe(false);
    }
    expect(posts).toHaveLength(0);
  });

  it('takes the owner by the full identity when the page names the owner in full', async () => {
    servedBy('alice@stub-node');
    signIn('alice', 'alice@stub-node');
    expect((await face.publish('# Shop\n', { app: 'shop.html' })).written).toBe(true);
    signIn('alice', 'alice@other-node');
    expect((await face.publish('# Shop\n', { app: 'shop.html' })).written).toBe(false);
    expect(posts).toHaveLength(1);
  });
});

describe('agentface publishQuietly', () => {
  it('resolves false for another account, with no request and no line in the console', async () => {
    servedBy('alice'); signIn('bob');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await face.publishQuietly('# Quiet\n', { app: 'quiet-a.html' })).toBe(false);
    expect(posts).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('writes for the owner after a visitor was refused the same face in the same page', async () => {
    servedBy('alice'); signIn('bob');
    expect(await face.publishQuietly('# Quiet\n', { app: 'quiet-b.html' })).toBe(false);
    signIn('alice');
    expect(await face.publishQuietly('# Quiet\n', { app: 'quiet-b.html' })).toBe(true);
    expect(posts).toHaveLength(1);
    expect(posts[0].body.key).toBe('apps.quiet-b.html.agentface');
  });

  it('with a debounce, a visitor still gets false and no request', async () => {
    servedBy('alice'); signIn('bob');
    expect(await face.publishQuietly('# Quiet\n', { app: 'quiet-c.html', debounceMs: 5 })).toBe(false);
    expect(posts).toHaveLength(0);
  });
});
