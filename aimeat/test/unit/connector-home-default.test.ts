/**
 * @file test/unit/connector-home-default.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where the connector keeps its tokens and keys, and with what permissions
 *   (cli/connect/home-dir.ts, keychain.ts, agent-key.ts). Secrets audit 2026-10-09, node
 *   configuration S4: the default home was `<cwd>/.aimeat`, inside whatever project `aimeat connect`
 *   ran in, where that project's .gitignore does not cover it; and a token file got 0600 only when
 *   it was created, the folders the default mode.
 *
 *   The rules held here: AIMEAT_HOME wins; otherwise a `<cwd>/.aimeat` that already holds connector
 *   state is still used (one release, with a warning); otherwise the user's home directory. Every
 *   write of a token or a key leaves the file 0600 and its folder 0700. Windows keeps only the
 *   read-only attribute from a mode, so the mode bits are asserted on Unix only; there the user
 *   profile's own access list is what keeps the home private.
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial.
 */
import { describe, it, expect, afterEach, afterAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'aimeat-connector-home-'));
const saved = { AIMEAT_HOME: process.env.AIMEAT_HOME, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
afterAll(() => rmSync(root, { recursive: true, force: true }));
afterEach(() => {
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

/** config.ts reads the home once at load, so each case loads it fresh in its own cwd and home. */
async function homeFor(opts: { env?: string; cwdState?: boolean }): Promise<{ dir: string; cwd: string; user: string }> {
  const cwd = mkdtempSync(join(root, 'project-'));
  const user = mkdtempSync(join(root, 'user-'));
  if (opts.cwdState) mkdirSync(join(cwd, '.aimeat', 'tokens'), { recursive: true });
  if (opts.env) process.env.AIMEAT_HOME = opts.env; else delete process.env.AIMEAT_HOME;
  process.env.HOME = user;
  process.env.USERPROFILE = user;
  vi.spyOn(process, 'cwd').mockReturnValue(cwd);
  vi.resetModules();
  const mod = await import('../../src/cli/connect/config.js');
  return { dir: mod.getConfigDir(), cwd, user };
}

describe('the connector home', () => {
  it('is the user\'s home directory by default, not the folder the command ran in', async () => {
    const { dir, user } = await homeFor({});
    expect(dir).toBe(join(user, '.aimeat'));
  });

  it('AIMEAT_HOME still wins', async () => {
    const explicit = join(root, 'explicit');
    expect((await homeFor({ env: explicit })).dir).toBe(explicit);
  });

  it('a <cwd>/.aimeat that already holds tokens is still read, for one release', async () => {
    const { dir, cwd } = await homeFor({ cwdState: true });
    expect(dir).toBe(join(cwd, '.aimeat'));
  });
});

describe.skipIf(process.platform === 'win32')('token and key files', () => {
  it('a token file that existed at 0644 is 0600 after it is stored again, and its folder is 0700', async () => {
    const home = join(root, 'perm-home');
    mkdirSync(join(home, 'tokens'), { recursive: true });
    chmodSync(join(home, 'tokens'), 0o755);
    const file = join(home, 'tokens', 'helper@alice.token');
    writeFileSync(file, 'old');
    chmodSync(file, 0o644);
    process.env.AIMEAT_HOME = home;
    vi.resetModules();
    const { storeToken } = await import('../../src/cli/connect/keychain.js');
    await storeToken('helper', 'alice', 'new-token');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, 'tokens')).mode & 0o777).toBe(0o700);
  });
});
