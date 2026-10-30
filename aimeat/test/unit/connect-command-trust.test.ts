/**
 * @file test/unit/connect-command-trust.test.ts
 * @description Which runner and wake commands in a connector home the connector runs
 *   (secaudit2026oct22, home-dir.ts:resolveConnectorHome:cwd-home-executable-settings; developer
 *   decision 2026-10-25: "jos käyttäjä yhdistää tuon niin se on silloin myös hyväksynyt sen").
 *
 *   1. A command the connector's own connect flow wrote is trusted by that act: connecting in a folder
 *      is the approval of what the folder's settings name.
 *   2. Every command an install already had at the first start after this update is adopted once, so
 *      an existing fleet and an unattended daemon keep running, with no question.
 *   3. A command in a folder nobody connected through the connector, which came with the folder after
 *      the update (a cloned project), does not run; one plain line names it and says that
 *      `aimeat connect` in that folder connects it.
 *
 *   Each case has its own record file outside the folder (AIMEAT_COMMAND_TRUST_FILE). "The update
 *   was earlier" is a record whose firstRunAt lies before the folder's files were written.
 * @version-history
 *   v2.1.0 -- 2026-10-30 -- Case 2 dates the install's config before any release that keeps a record
 *     (the date moved, the assertions did not), and 2b: a fresh install after that release adopts
 *     nothing it did not write (secaudit2026oct26 round 8c, connector-04; Jouni, 2026-10-30, option A).
 *   v2.0.1 -- 2026-10-27 -- Case 2 dates the install's config an hour back, as an existing install's is:
 *     written in the first-start millisecond it was not adopted, and the nightly 4.0.0 run went red.
 *   v2.0.0 -- 2026-10-25 -- No question and no `aimeat connect trust`: connecting is the approval,
 *     existing commands are adopted once, a folder nobody connected is named in one line (developer
 *     decision 2026-10-25).
 *   v1.0.0 -- 2026-10-25 -- Initial (secaudit2026oct22, lead 4763).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { loadAllAgents, loadPerAgentConfig, saveConnectedAgentConfig } from '../../src/cli/connect/config.js';
import { heldNotices, adoptExistingCommands, heldBackCommands } from '../../src/cli/connect/command-trust.js';
import { isRunner } from '../../src/cli/connect/task-runner.js';
import { buildRegistry } from '../../src/cli/connect/agent-registry.js';

let sandbox: string;
let home: string;
let trustFile: string;
const saved: Record<string, string | undefined> = {};
const setEnv = (k: string, v: string) => { saved[k] = process.env[k]; process.env[k] = v; };

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeToken = (sub: string) => `${b64({ alg: 'none' })}.${b64({ sub })}.x`;
const RUNNER = { command: 'node', args: ['./marker.js'] };
/** A time before any release that keeps a trust record: npm's 4.1.2, the last without one, is 2026-10-20. */
const BEFORE_RECORD_KEEPING_RELEASE = '2026-10-01T00:00:00.000Z';

/** A folder whose `.aimeat` names a runner and a wake command under the bare-name legacy path. */
function folderWithCommands(dir: string): void {
  mkdirSync(join(dir, 'agents', 'assistant'), { recursive: true });
  writeFileSync(join(dir, 'agents', 'assistant', 'config.yaml'), stringify({ node_url: 'https://aimeat.io', runner: RUNNER, wake: { command: 'node ./wake.js', strategy: 'command_only' } }));
  mkdirSync(join(dir, 'tokens'), { recursive: true });
  writeFileSync(join(dir, 'tokens', 'assistant@me.token'), fakeToken('assistant#me@aimeat-test'));
}

/** The update ran on this machine before now: the record's first run is in the past. */
const updateRanEarlier = () => {
  mkdirSync(join(sandbox, 'trust'), { recursive: true });
  writeFileSync(trustFile, JSON.stringify({ firstRunAt: '2020-01-01T00:00:00.000Z', hashes: {} }));
};

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'aimeat-cmdtrust-'));
  home = join(sandbox, 'project', '.aimeat');
  trustFile = join(sandbox, 'trust', 'trusted-commands.json');
  setEnv('AIMEAT_HOME', home);
  setEnv('AIMEAT_COMMAND_TRUST_FILE', trustFile);
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(sandbox, { recursive: true, force: true });
});

describe('3. a folder nobody connected through the connector, which came after the update', () => {
  it('does not run its commands, and one plain line names them and says how to connect', async () => {
    updateRanEarlier();
    folderWithCommands(home);
    const [a] = await loadAllAgents();
    expect(isRunner(a!)).toBe(false);
    expect(a!.config.wake?.command).toBeUndefined();
    const lines = heldNotices([a!]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('\n');
    expect(lines[0]).toContain('node ./marker.js');
    expect(lines[0]).toContain('node ./wake.js');
    expect(lines[0]).toContain('aimeat connect');
  });
});

describe('1. a command the connector\'s own connect flow wrote', () => {
  it('runs: connecting in the folder is the approval, and the next start needs nothing', async () => {
    updateRanEarlier();
    folderWithCommands(home);
    // What `aimeat connect` does (auth.ts): keep the runner and wake the folder's config names.
    const existing = loadPerAgentConfig('assistant', 'me');
    saveConnectedAgentConfig('assistant', 'me', { node_url: 'https://aimeat.io', wake: existing?.wake, runner: existing?.runner });
    const [a] = await loadAllAgents();
    expect(a!.heldCommands).toBeFalsy();
    expect(isRunner(a!)).toBe(true);
    expect(a!.config.wake?.command).toBe('node ./wake.js');
    expect(heldNotices([a!])).toEqual([]);
  });
});

describe('2. an install that already had a runner at the first start after this update', () => {
  it('keeps running unattended: the daemon\'s registry holds the runner, nobody is asked, and the record keeps it', async () => {
    folderWithCommands(home);
    // An existing install's config was written before this start. Written in the same millisecond
    // as the first-start stamp, the file reads as newer by its sub-millisecond mtime and is not
    // adopted, which turned this test red whenever the two calls shared a millisecond.
    // The fixture date is before any release that keeps a record (ADOPTION_CUTOFF), as an install
    // from before that release is (secaudit2026oct26 round 8c, connector-04: the date moved, the
    // assertions did not).
    const beforeRelease = new Date(BEFORE_RECORD_KEEPING_RELEASE);
    utimesSync(join(home, 'agents', 'assistant', 'config.yaml'), beforeRelease, beforeRelease);
    // No record yet: this start is the first one after the update.
    const registry = buildRegistry(await loadAllAgents());
    const entry = registry.list()[0]!;
    expect(isRunner(entry)).toBe(true);
    expect(entry.config.wake?.command).toBe('node ./wake.js');
    expect(Object.keys((JSON.parse(readFileSync(trustFile, 'utf-8')) as { hashes: object }).hashes)).toHaveLength(1);
    // The next start reads the same answer from the record.
    expect(isRunner((await loadAllAgents())[0]!)).toBe(true);
  });

  it('a folder that arrives after that first start is not adopted', async () => {
    await loadAllAgents();   // the first start after the update, with nothing in this home yet
    await new Promise(r => setTimeout(r, 30));
    folderWithCommands(home);
    // Written after the first run: a file whose time is later than the record's firstRunAt.
    const later = (await loadAllAgents())[0]!;
    const record = JSON.parse(readFileSync(trustFile, 'utf-8')) as { firstRunAt: string };
    expect(Date.parse(record.firstRunAt)).toBeLessThanOrEqual(Date.now());
    expect(isRunner(later)).toBe(false);
  });
});

describe('2b. a fresh install after the first release that keeps a record (secaudit2026oct26 round 8c, connector-04)', () => {
  const CUTOFF = '2026-10-15T00:00:00.000Z';
  const cfg = () => join(home, 'agents', 'assistant', 'config.yaml');
  const held = () => heldBackCommands({ runner: RUNNER, wake: { command: 'node ./wake.js' } }, home, process.env, home).held;

  it('adopts nothing that arrived after the release, even before its first start: the command is held', () => {
    folderWithCommands(home);
    const afterRelease = new Date('2026-10-20T00:00:00.000Z');
    utimesSync(cfg(), afterRelease, afterRelease);
    // No record: this is the machine's first start, and the folder is older than it.
    adoptExistingCommands(home, process.env, home, CUTOFF);
    expect(held()).not.toBeNull();
    expect(heldNotices([{ agent: 'assistant', owner: 'me', heldCommands: held() }]).join('\n')).toContain('aimeat connect');
  });

  it('designed use: an install from before that release keeps running what it ran, with no question', () => {
    folderWithCommands(home);
    const beforeRelease = new Date('2026-10-10T00:00:00.000Z');
    utimesSync(cfg(), beforeRelease, beforeRelease);
    adoptExistingCommands(home, process.env, home, CUTOFF);
    expect(held()).toBeNull();
  });

  it('designed use: connecting in the folder takes the held command into use', async () => {
    folderWithCommands(home);
    const afterRelease = new Date('2026-10-20T00:00:00.000Z');
    utimesSync(cfg(), afterRelease, afterRelease);
    adoptExistingCommands(home, process.env, home, CUTOFF);
    expect(held()).not.toBeNull();
    // What `aimeat connect` does (auth.ts): keep the runner and wake the folder's config names.
    const existing = loadPerAgentConfig('assistant', 'me');
    saveConnectedAgentConfig('assistant', 'me', { node_url: 'https://aimeat.io', wake: existing?.wake, runner: existing?.runner });
    expect(isRunner((await loadAllAgents())[0]!)).toBe(true);
  });
});
