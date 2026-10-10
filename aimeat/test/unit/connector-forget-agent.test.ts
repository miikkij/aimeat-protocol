/**
 * @file test/unit/connector-forget-agent.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a connector removes from its home when the node says an agent moved to another
 *   connector (cli/connect/forget-agent.ts), and what it leaves.
 *
 *   The rules held here. The moved agent's key, stored bearer and config are removed. Another
 *   agent's files in the same home stay, including an agent of the same name under another owner.
 *   The agent's directory goes only when the config was all it held. Forgetting an agent that has
 *   nothing here removes nothing and does not throw.
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

// The connector home is read once, when cli/connect/config.ts loads, so it is set before the import.
const home = mkdtempSync(join(tmpdir(), 'aimeat-forget-'));
const savedHome = process.env.AIMEAT_HOME;
process.env.AIMEAT_HOME = home;

const { forgetLocalAgent } = await import('../../src/cli/connect/forget-agent.js');
const { perAgentConfigPath, getConfigDir } = await import('../../src/cli/connect/config.js');

const keyFile = (agent: string, owner: string) => join(getConfigDir(), 'keys', `${agent}@${owner}.key`);
const tokenFile = (agent: string, owner: string) => join(getConfigDir(), 'tokens', `${agent}@${owner}.token`);

function lay(agent: string, owner: string, opts: { token?: boolean; extra?: boolean } = {}): void {
  mkdirSync(dirname(keyFile(agent, owner)), { recursive: true });
  writeFileSync(keyFile(agent, owner), '{"kid":"k"}', 'utf-8');
  if (opts.token) {
    mkdirSync(dirname(tokenFile(agent, owner)), { recursive: true });
    writeFileSync(tokenFile(agent, owner), 'bearer', 'utf-8');
  }
  const config = perAgentConfigPath(agent, owner);
  mkdirSync(dirname(config), { recursive: true });
  writeFileSync(config, 'node_url: http://localhost:1\n', 'utf-8');
  if (opts.extra) writeFileSync(join(dirname(config), 'notes.txt'), 'a runtime keeps this', 'utf-8');
}

beforeAll(() => {
  expect(getConfigDir().startsWith(home)).toBe(true);
});

afterAll(() => {
  if (savedHome === undefined) delete process.env.AIMEAT_HOME;
  else process.env.AIMEAT_HOME = savedHome;
  rmSync(home, { recursive: true, force: true });
});

describe('forgetting an agent the node moved to another connector', () => {
  it('removes its key, its stored bearer and its config, and the directory the config was alone in', async () => {
    lay('watcher', 'alice', { token: true });
    const gone = await forgetLocalAgent('watcher', 'alice');
    expect(gone).toEqual({ key: true, token: true, config: true });
    expect(existsSync(keyFile('watcher', 'alice'))).toBe(false);
    expect(existsSync(tokenFile('watcher', 'alice'))).toBe(false);
    expect(existsSync(perAgentConfigPath('watcher', 'alice'))).toBe(false);
    expect(existsSync(dirname(perAgentConfigPath('watcher', 'alice')))).toBe(false);
  });

  it('leaves every other agent of the home, and the same name under another owner', async () => {
    lay('watcher', 'alice');
    lay('writer', 'alice');
    lay('watcher', 'bob');
    await forgetLocalAgent('watcher', 'alice');
    for (const [agent, owner] of [['writer', 'alice'], ['watcher', 'bob']]) {
      expect(existsSync(keyFile(agent, owner))).toBe(true);
      expect(existsSync(perAgentConfigPath(agent, owner))).toBe(true);
    }
  });

  it('keeps the agent directory when it holds anything besides the config', async () => {
    lay('keeper', 'alice', { extra: true });
    const gone = await forgetLocalAgent('keeper', 'alice');
    expect(gone.config).toBe(true);
    expect(existsSync(perAgentConfigPath('keeper', 'alice'))).toBe(false);
    expect(existsSync(join(dirname(perAgentConfigPath('keeper', 'alice')), 'notes.txt'))).toBe(true);
  });

  it('removes nothing, and does not throw, for an agent that has nothing here', async () => {
    expect(await forgetLocalAgent('nobody', 'alice')).toEqual({ key: false, token: false, config: false });
  });
});
