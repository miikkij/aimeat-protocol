/**
 * @file test/unit/e2e-databases.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The name rules that decide which E2E databases a run drops and which a prune drops
 *   (scripts/lib/e2e-databases.ts). A wrong rule here drops a database somebody is running on, so
 *   each case that must be KEPT is as important as each that must go.
 * @usage cd aimeat && pnpm exec vitest run test/unit/e2e-databases.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-11 — Initial.
 */
import { describe, it, expect } from 'vitest';
import {
  baseForWorktree, belongsTo, runDatabasesOf, orphanDatabases, adminUrlOf, E2E_DB_PREFIX,
} from '../../scripts/lib/e2e-databases.js';

const A = baseForWorktree('cc-jouni-voice');          // aimeat_kysely_e2e_cc_jouni_voice
const A_W1 = baseForWorktree('cc-jouni-voice-w1');    // a different worktree that reads like a lane of A
const B = baseForWorktree('cc-jouni-orgdelete');

describe('e2e database names', () => {
  it('a worktree base is the prefix and the slug', () => {
    expect(A).toBe(`${E2E_DB_PREFIX}_cc_jouni_voice`);
  });

  it('a run drops its lanes and own-node databases and keeps its base', () => {
    const names = [A, `${A}_w1`, `${A}_w2`, `${A}_o_owner_ab12cd`, `${A}_w1_o_owner_ab12cd`, `${A}_bootlock`, B, `${B}_w1`];
    expect(runDatabasesOf(A, names).sort()).toEqual([`${A}_w1`, `${A}_w2`, `${A}_o_owner_ab12cd`, `${A}_w1_o_owner_ab12cd`, `${A}_bootlock`].sort());
  });

  it('a run never drops another live worktree whose base starts with its own', () => {
    const live = new Set([A, A_W1]);
    const names = [A, `${A}_w2`, A_W1, `${A_W1}_w1`];
    expect(runDatabasesOf(A, names, live)).toEqual([`${A}_w2`]);
  });

  it('another worktree that only shares a start of the name is not the run\'s', () => {
    const voice2 = baseForWorktree('cc-jouni-voice-2');
    expect(runDatabasesOf(A, [voice2, `${voice2}_w1`])).toEqual([]);
  });

  it('a prune drops what belongs to no live worktree and keeps everything a live one owns', () => {
    const live = new Set([E2E_DB_PREFIX, A]);
    const gone = baseForWorktree('cc-jouni-gone');
    const names = [E2E_DB_PREFIX, `${E2E_DB_PREFIX}_w1`, A, `${A}_w3`, `${A}_o_x_ab12cd`, gone, `${gone}_w1`, `${gone}_o_x_ab12cd`];
    expect(orphanDatabases(names, live).sort()).toEqual([gone, `${gone}_w1`, `${gone}_o_x_ab12cd`].sort());
  });

  it('a prune keeps an own-node database whose name shortened a live base, and never touches another prefix', () => {
    const long = baseForWorktree('cc-jouni-a-very-long-worktree-name-for-testing');
    const shortened = `${long.slice(0, 39)}_o_owner_tag_ab12cd`;
    expect(belongsTo(shortened, long)).toBe(true);
    expect(orphanDatabases([shortened, 'aimeat_dev', 'appdb'], new Set([long]))).toEqual([]);
  });

  it('the admin connection is the same server on database postgres', () => {
    expect(adminUrlOf('postgresql://u:p@localhost:5432/aimeat_kysely_e2e_x?schema=public'))
      .toBe('postgresql://u:p@localhost:5432/postgres');
  });
});
