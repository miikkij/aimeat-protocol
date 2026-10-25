/**
 * @file test/unit/goose-chat-config.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node chat's default goose root (services/goose-chat-config.ts) on a system with
 *   user ids: a directory of that predictable name that another local account created first, or a
 *   symbolic link, is not used, and its config.yaml is not taken as the operator's; the node's own
 *   directory is used as before, and an operator's AIMEAT_GOOSE_PATH_ROOT is used as given
 *   (secaudit2026oct22). The user id and the directory's owner are stood in for, so the test runs on
 *   Windows too.
 * @usage cd aimeat && pnpm exec vitest run test/unit/goose-chat-config.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, goose-chat-config.ts:chatGooseRoot:shared-tmp-goose-root).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MY_UID = 4242;
/** Paths whose lstat answers as another account's directory. */
const foreign = new Set<string>();

vi.mock('node:fs', async (orig) => {
  const actual = await orig<typeof import('node:fs')>();
  return {
    ...actual,
    lstatSync: (p: string, ...rest: unknown[]) => {
      const real = (actual.lstatSync as (p: string, ...r: unknown[]) => import('node:fs').Stats)(p, ...rest);
      const uid = foreign.has(p) ? MY_UID + 1 : MY_UID;
      return Object.assign(Object.create(Object.getPrototypeOf(real)), real, { uid, mode: foreign.has(p) ? 0o40777 : 0o40700 });
    },
    chmodSync: () => undefined,
  };
});

const { chatGooseRoot, ensureChatGooseConfig, NODE_CONFIG_MARKER } = await import('../../src/services/goose-chat-config.js');

const realGetuid = process.getuid;
const made: string[] = [];
beforeAll(() => { (process as { getuid?: () => number }).getuid = () => MY_UID; });
afterAll(() => {
  (process as { getuid?: () => number }).getuid = realGetuid;
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

describe('the chat\'s default goose root', () => {
  it('is not a directory another account created first, and that account\'s config.yaml is not used', () => {
    const nodeId = `goosetest-foreign-${process.pid}-${Date.now()}`;
    const planted = join(tmpdir(), `aimeat-goose-${nodeId}`);
    mkdirSync(join(planted, 'config'), { recursive: true });
    writeFileSync(join(planted, 'config', 'config.yaml'), 'extensions:\n  planted:\n    enabled: true\n');
    made.push(planted);
    foreign.add(planted);
    const root = chatGooseRoot({ goosePathRoot: '', nodeId });
    made.push(root);
    expect(root).not.toBe(planted);
    const { root: used } = ensureChatGooseConfig({ goosePathRoot: '', nodeId });
    expect(used).toBe(root);
    expect(readFileSync(join(used, 'config', 'config.yaml'), 'utf8').startsWith(NODE_CONFIG_MARKER)).toBe(true);
  });

  it('is the node\'s own directory when this account owns it, as before', () => {
    const nodeId = `goosetest-own-${process.pid}-${Date.now()}`;
    const expected = join(tmpdir(), `aimeat-goose-${nodeId}`);
    made.push(expected);
    const { root } = ensureChatGooseConfig({ goosePathRoot: '', nodeId });
    expect(root).toBe(expected);
    expect(existsSync(join(root, 'config', 'config.yaml'))).toBe(true);
  });

  it('is the operator\'s AIMEAT_GOOSE_PATH_ROOT as given', () => {
    const mine = mkdtempSync(join(tmpdir(), 'goosetest-operator-'));
    made.push(mine);
    expect(chatGooseRoot({ goosePathRoot: mine, nodeId: 'n' })).toBe(mine);
  });
});
