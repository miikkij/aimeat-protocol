/**
 * @file test/unit/connector-home-default.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where the connector keeps its tokens and keys, and how they stay out of the project's
 *   git (cli/connect/home-dir.ts, keychain.ts, agent-key.ts, config.ts). Secrets audit 2026-10-09,
 *   node configuration S4: the home is `<cwd>/.aimeat`, inside the project `aimeat connect` ran in,
 *   where the project's .gitignore may not cover it, so a token or a key could be committed; and a
 *   token file got 0600 only when it was created, the folders the default mode.
 *
 *   The rules held here: the home stays `<cwd>/.aimeat` (one daemon per project, the 2026-06-17
 *   ruling) and AIMEAT_HOME wins; every write into the home leaves `<home>/.gitignore` holding `*`,
 *   so git sees nothing inside whatever the project's own .gitignore says; and a token or key file is
 *   0600 in a 0700 folder after every write. Windows keeps only the read-only attribute from a mode,
 *   so the mode bits are asserted on Unix only.
 * @version-history
 *   v2.0.0 — 2026-10-09 — The home stays in the project; the folder ignores itself instead of moving.
 *   v1.0.0 — 2026-10-09 — Initial.
 */
import { describe, it, expect, afterEach, afterAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync, statSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'aimeat-connector-home-'));
const saved = process.env.AIMEAT_HOME;
afterAll(() => rmSync(root, { recursive: true, force: true }));
afterEach(() => {
  vi.restoreAllMocks();
  if (saved === undefined) delete process.env.AIMEAT_HOME; else process.env.AIMEAT_HOME = saved;
});

/** The connector modules read the home once at load, so each case loads them fresh. */
async function fresh(opts: { cwd?: string; home?: string }) {
  if (opts.home) process.env.AIMEAT_HOME = opts.home; else delete process.env.AIMEAT_HOME;
  if (opts.cwd) vi.spyOn(process, 'cwd').mockReturnValue(opts.cwd);
  vi.resetModules();
  return {
    config: await import('../../src/cli/connect/config.js'),
    keychain: await import('../../src/cli/connect/keychain.js'),
    agentKey: await import('../../src/cli/connect/agent-key.js'),
  };
}

describe('the connector home', () => {
  it('is <cwd>/.aimeat by default: one daemon per project', async () => {
    const cwd = mkdtempSync(join(root, 'project-'));
    const { config } = await fresh({ cwd });
    expect(config.getConfigDir()).toBe(join(cwd, '.aimeat'));
  });

  it('AIMEAT_HOME still wins', async () => {
    const explicit = join(root, 'explicit');
    const { config } = await fresh({ home: explicit });
    expect(config.getConfigDir()).toBe(explicit);
  });

  it('a fresh home gets a .gitignore holding * on the first token written into it', async () => {
    const home = join(root, 'fresh-home');
    const { keychain } = await fresh({ home });
    await keychain.storeToken('helper', 'alice', 'token-value');
    expect(readFileSync(join(home, '.gitignore'), 'utf-8').split(/\r?\n/)).toContain('*');
  });

  it('a home that already exists without one gets it on the next write', async () => {
    const home = join(root, 'old-home');
    mkdirSync(join(home, 'tokens'), { recursive: true });
    writeFileSync(join(home, 'tokens', 'helper@alice.token'), 'old');
    const { config } = await fresh({ home });
    config.saveConfig({ node_url: 'http://localhost:1', agent: 'helper', owner: 'alice' });
    expect(existsSync(join(home, '.gitignore'))).toBe(true);
  });

  it('in a git repository, nothing from .aimeat shows in git status after a token, a key and a config are written', async () => {
    const repo = mkdtempSync(join(root, 'repo-'));
    try { execFileSync('git', ['init', '-q'], { cwd: repo }); } catch { return; /* no git on this machine */ }
    const { keychain, agentKey, config } = await fresh({ cwd: repo });
    await keychain.storeToken('helper', 'alice', 'token-value');
    await agentKey.storeAgentKey('helper', 'alice', {
      privateKey: 'k', publicKey: 'p', kid: 'kid', gaii: 'helper#alice@node', nodeId: 'node',
    } as never);
    config.saveConfig({ node_url: 'http://localhost:1', agent: 'helper', owner: 'alice' });
    expect(existsSync(join(repo, '.aimeat', 'tokens', 'helper@alice.token'))).toBe(true);
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: repo, encoding: 'utf-8' });
    expect(status).not.toContain('.aimeat');
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
    const { keychain } = await fresh({ home });
    await keychain.storeToken('helper', 'alice', 'new-token');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, 'tokens')).mode & 0o777).toBe(0o700);
    expect(statSync(home).mode & 0o777).toBe(0o700);
  });
});
