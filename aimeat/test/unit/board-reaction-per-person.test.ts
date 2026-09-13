/**
 * @file board-reaction-per-person.test.ts
 * @description A board reaction counts once per PERSON (appdev pitfall
 *   boards/reactions-dedupe-by-gaii-not-by-person, decided 2026-09-13). An owner and their own agent
 *   used to be two votes, because the mark was keyed on the full identity. Drives reactToBoardPost and
 *   unreactToBoardPost over a storage stub that keeps reactions the way both providers do.
 * @usage cd aimeat && pnpm exec vitest run test/unit/board-reaction-per-person.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial. The two same-person cases failed on the unchanged service.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { reactToBoardPost, unreactToBoardPost } from '../../src/services/board-write.js';

const OWNER = 'alice@n1';
const AGENT = 'bot#alice@n1';
const NAMESAKE = 'alice@n2';
const OTHER = 'bob@n1';

let reactions: Record<string, string[]>;
const storage: any = {
  getBoard: async () => ({ id: 'b1', ownerGaii: OWNER, visibility: 'public', members: [] }),
  getPost: async () => ({ id: 'p1', boardId: 'b1', reactions }),
  addReaction: async (_b: string, _p: string, emoji: string, gaii: string) => {
    const list = reactions[emoji] ?? (reactions[emoji] = []);
    if (!list.includes(gaii)) list.push(gaii);
    return true;
  },
  removeReaction: async (_b: string, _p: string, emoji: string, gaii: string) => {
    const list = reactions[emoji] ?? [];
    const i = list.indexOf(gaii);
    if (i < 0) return false;
    list.splice(i, 1);
    return true;
  },
};
const deps: any = { storage, config: {} };
const react = (gaii: string) => reactToBoardPost(deps, { gaii, roles: [] }, { boardId: 'b1', postId: 'p1', reaction: '❤' });
const unreact = (gaii: string) => unreactToBoardPost(deps, { gaii, roles: [] }, { boardId: 'b1', postId: 'p1', reaction: '❤' });

describe('a board reaction is one vote per person', () => {
  beforeEach(() => { reactions = {}; });

  it('an owner and their own agent together count once', async () => {
    expect((await react(OWNER)).ok).toBe(true);
    expect((await react(AGENT)).ok).toBe(true);
    expect(reactions['❤']).toEqual([OWNER]);
  });

  it('a different person, and a namesake on another node, count separately', async () => {
    await react(OWNER);
    await react(OTHER);
    await react(NAMESAKE);
    expect(reactions['❤']).toEqual([OWNER, OTHER, NAMESAKE]);
  });

  it('the owner can take back the mark their agent gave', async () => {
    await react(AGENT);
    expect((await unreact(OWNER)).ok).toBe(true);
    expect(reactions['❤']).toEqual([]);
  });

  it('another person cannot take back somebody else\'s mark', async () => {
    await react(OWNER);
    const r = await unreact(OTHER);
    expect(r.ok).toBe(false);
    expect(reactions['❤']).toEqual([OWNER]);
  });
});
