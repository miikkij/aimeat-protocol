/**
 * @file test/unit/connect-command-trust.test.ts
 * @description A runner or wake command in a connector home that the person did not confirm is not
 *   handed to the task runner or the wake adapter; it runs only after the person confirms it once,
 *   shown in plain words (secaudit2026oct22, home-dir.ts:resolveConnectorHome:cwd-home-executable-settings;
 *   developer decision 2026-10-25).
 *
 *   The folder plays a cloned project: `.aimeat/agents/assistant/config.yaml` (the bare-name legacy
 *   path a planted file needs) names a runner and a wake command, and the person then connects as
 *   owner `me`, which copies them into the per-owner config as auth.ts does. The approval record is
 *   a temporary file outside the folder (AIMEAT_COMMAND_TRUST_FILE).
 * @version-history
 *   v1.0.0 -- 2026-10-25 -- Initial (secaudit2026oct22, lead 4763).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { stringify } from 'yaml';
import { loadAllAgents, loadPerAgentConfig, savePerAgentConfig } from '../../src/cli/connect/config.js';
import { confirmHeldCommands, heldNotices, describeHeld } from '../../src/cli/connect/command-trust.js';
import { isRunner } from '../../src/cli/connect/task-runner.js';

let sandbox: string;
let home: string;
let trustFile: string;
const saved: Record<string, string | undefined> = {};
const setEnv = (k: string, v: string) => { saved[k] = process.env[k]; process.env[k] = v; };

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeToken = (sub: string) => `${b64({ alg: 'none' })}.${b64({ sub })}.x`;
const RUNNER = { command: 'node', args: ['./marker.js'] };

/** A folder that arrived with a planted `.aimeat`, and the person's own connect into it. */
function plantedFolder(dir: string): void {
  mkdirSync(join(dir, 'agents', 'assistant'), { recursive: true });
  writeFileSync(join(dir, 'agents', 'assistant', 'config.yaml'), stringify({ node_url: 'https://aimeat.io', runner: RUNNER, wake: { command: 'node ./wake.js', strategy: 'command_only' } }));
  mkdirSync(join(dir, 'tokens'), { recursive: true });
  writeFileSync(join(dir, 'tokens', 'assistant@me.token'), fakeToken('assistant#me@aimeat-test'));
  // What auth.ts does on connect: read the existing per-agent config, keep its runner and wake.
  const existing = loadPerAgentConfig('assistant', 'me');
  savePerAgentConfig('assistant', 'me', { node_url: 'https://aimeat.io', wake: existing?.wake, runner: existing?.runner });
}

const answers = (text: string) => Readable.from([text]);
const sink = () => new Writable({ write(_c, _e, cb) { cb(); } });

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'aimeat-cmdtrust-'));
  home = join(sandbox, 'project', '.aimeat');
  trustFile = join(sandbox, 'trust', 'trusted-commands.json');
  setEnv('AIMEAT_HOME', home);
  setEnv('AIMEAT_COMMAND_TRUST_FILE', trustFile);
  plantedFolder(home);
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(sandbox, { recursive: true, force: true });
});

describe('a runner and a wake command that came with the folder', () => {
  it('are held back: the agent is not a runner and has no wake command, and the notice shows the commands', async () => {
    const [a] = await loadAllAgents();
    expect(a!.agent).toBe('assistant');
    expect(isRunner(a!)).toBe(false);
    expect(a!.config.wake?.command).toBeUndefined();
    expect(a!.heldCommands?.runner?.command).toBe('node');
    const notice = heldNotices([a!]).join('\n');
    expect(notice).toContain('node ./marker.js');
    expect(notice).toContain('node ./wake.js');
    expect(notice).toContain('aimeat connect trust');
  });

  it('stay held back when the person does not say yes', async () => {
    const loaded = await loadAllAgents();
    expect(await confirmHeldCommands(loaded, { input: answers('\n'), output: sink() })).toBe(0);
    expect(isRunner(loaded[0]!)).toBe(false);
    expect(existsSync(trustFile)).toBe(false);
    expect((await loadAllAgents())[0]!.heldCommands).toBeTruthy();
  });

  it('run after the person confirms once: the record is outside the folder, and the next start needs no question', async () => {
    const loaded = await loadAllAgents();
    expect(describeHeld(loaded[0]!.heldCommands!)).toContain('for each task: node ./marker.js');
    expect(await confirmHeldCommands(loaded, { input: answers('yes\n'), output: sink() })).toBe(1);
    expect(isRunner(loaded[0]!)).toBe(true);
    expect(existsSync(trustFile)).toBe(true);
    expect(trustFile.startsWith(home)).toBe(false);
    const again = (await loadAllAgents())[0]!;
    expect(again.heldCommands).toBeFalsy();
    expect(isRunner(again)).toBe(true);
    expect(again.config.wake?.command).toBe('node ./wake.js');
    // A re-connect copies the confirmed commands again (auth.ts): they stay confirmed.
    const existing = loadPerAgentConfig('assistant', 'me');
    savePerAgentConfig('assistant', 'me', { node_url: 'https://aimeat.io', wake: existing?.wake, runner: existing?.runner });
    expect((await loadAllAgents())[0]!.heldCommands).toBeFalsy();
  });

  it('the same command in another folder is asked again, because a relative command runs something else there', async () => {
    await confirmHeldCommands(await loadAllAgents(), { input: answers('yes\n'), output: sink() });
    const other = join(sandbox, 'other-project', '.aimeat');
    process.env.AIMEAT_HOME = other;
    plantedFolder(other);
    expect((await loadAllAgents())[0]!.heldCommands?.runner?.command).toBe('node');
  });
});
