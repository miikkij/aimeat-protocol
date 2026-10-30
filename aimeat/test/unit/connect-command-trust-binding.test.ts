/**
 * @file test/unit/connect-command-trust-binding.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Round 8c of secaudit2026oct26 for the connector's record of trusted commands
 *   (cli/connect/command-trust.ts), beside connect-command-trust.test.ts, whose cases stay as they are.
 *
 *   mtime-cutoff-not-bound-to-update: a record of trusted commands that cannot be read adopts
 *   nothing. The commands of the home are held, and `aimeat connect` in the folder (the existing
 *   approval of a held command) takes each one into use. A machine already trusted keeps working.
 *
 *   home-bound-not-resolution-directory: a relative program path (`./run.sh`) is resolved to an
 *   absolute path in the directory the command runs in, and the trust binds that path. A command
 *   trusted before this change is resolved once in the directory it runs from and recorded with that
 *   absolute path. Absolute and bare program names, and a runner with its own cwd, keep one record
 *   for every directory, as before.
 * @usage cd aimeat && pnpm exec vitest run test/unit/connect-command-trust-binding.test.ts
 * @version-history
 *   v1.0.1 -- 2026-10-30 -- The existing install's config is dated before ADOPTION_CUTOFF, as
 *     5febd7873 did for the three other suites: a5af5a4d2 stamped the cut-off, and a config dated an
 *     hour back became newer than it, so CI's unit job went red. Assertions unchanged.
 *   v1.0.0 -- 2026-10-29 -- Initial (secaudit2026oct26 round 8c, mtime-cutoff-not-bound-to-update and
 *     home-bound-not-resolution-directory).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stringify } from 'yaml';
import { loadAllAgents, saveConnectedAgentConfig } from '../../src/cli/connect/config.js';
import { heldBackCommands, heldNotices, trustWrittenCommands, adoptExistingCommands } from '../../src/cli/connect/command-trust.js';
import { isRunner } from '../../src/cli/connect/task-runner.js';
import { ADOPTION_CUTOFF } from '../../src/cli/connect/adoption-cutoff.js';

let sandbox: string;
let home: string;
let trustFile: string;
const saved: Record<string, string | undefined> = {};
const setEnv = (k: string, v: string) => { saved[k] = process.env[k]; process.env[k] = v; };

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeToken = (sub: string) => `${b64({ alg: 'none' })}.${b64({ sub })}.x`;
const RUNNER = { command: 'node', args: ['./marker.js'] };

/**
 * A time an existing install's config was written: an hour before the first release that keeps a
 * record (ADOPTION_CUTOFF), since adoption takes only a file older than that, or an hour ago while
 * the value is null.
 */
const beforeTheRelease = (): Date => new Date((ADOPTION_CUTOFF ? Date.parse(ADOPTION_CUTOFF) : Date.now()) - 3_600_000);

/** A home that already has an agent with a runner, its config written before the release. */
function homeWithRunner(): void {
  mkdirSync(join(home, 'agents', 'assistant'), { recursive: true });
  const cfg = join(home, 'agents', 'assistant', 'config.yaml');
  writeFileSync(cfg, stringify({ node_url: 'https://aimeat.io', runner: RUNNER }));
  mkdirSync(join(home, 'tokens'), { recursive: true });
  writeFileSync(join(home, 'tokens', 'assistant@me.token'), fakeToken('assistant#me@aimeat-test'));
  const then = beforeTheRelease();
  utimesSync(cfg, then, then);
}

const readRecord = () => JSON.parse(readFileSync(trustFile, 'utf-8')) as { firstRunAt?: string; hashes: Record<string, { how: string }> };

/** The record's hash as the connector computed it before round 8c: the home and the command text. */
function textOnlyHash(h: string, runner: unknown, wake: string | undefined): string {
  const canonical = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      return `{${Object.keys(o).sort().filter(k => o[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
    }
    return JSON.stringify(v ?? null);
  };
  return createHash('sha256').update(canonical({ home: resolve(h), runner: runner ?? null, wake: wake ?? null })).digest('hex');
}

/** A directory holding a program file of the given name. */
function dirWith(name: string, file: string): string {
  const d = join(sandbox, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, file), '#!/bin/sh\necho hi\n');
  return d;
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'aimeat-cmdbind-'));
  home = join(sandbox, 'project', '.aimeat');
  trustFile = join(sandbox, 'trust', 'trusted-commands.json');
  mkdirSync(join(sandbox, 'trust'), { recursive: true });
  setEnv('AIMEAT_HOME', home);
  setEnv('AIMEAT_COMMAND_TRUST_FILE', trustFile);
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(sandbox, { recursive: true, force: true });
});

describe('mtime-cutoff-not-bound-to-update: a record of trusted commands that cannot be read', () => {
  it('adopts nothing: the home\'s runner is held, and no new first-start time is written', async () => {
    homeWithRunner();
    writeFileSync(trustFile, '{ this is not json');
    const [a] = await loadAllAgents();
    expect(isRunner(a!)).toBe(false);
    expect(a!.heldCommands).toBeTruthy();
    // The next start does not open a new adoption window either.
    const [b] = await loadAllAgents();
    expect(isRunner(b!)).toBe(false);
    expect(readFileSync(trustFile, 'utf-8')).toBe('{ this is not json');
  });

  it('a record that parses but has no first-start time adopts nothing too', async () => {
    homeWithRunner();
    writeFileSync(trustFile, JSON.stringify({ hashes: {} }));
    const [a] = await loadAllAgents();
    expect(isRunner(a!)).toBe(false);
    expect(readRecord().firstRunAt).toBeUndefined();
  });

  it('the held command is named in one line, and `aimeat connect` in the folder takes it into use', async () => {
    homeWithRunner();
    writeFileSync(trustFile, '{ this is not json');
    const [a] = await loadAllAgents();
    const lines = heldNotices([a!]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('node ./marker.js');
    expect(lines[0]).toContain('aimeat connect');
    // What `aimeat connect` writes (auth.ts): the person who connects approves the command.
    saveConnectedAgentConfig('assistant', 'me', { node_url: 'https://aimeat.io', runner: RUNNER });
    const [b] = await loadAllAgents();
    expect(b!.heldCommands).toBeFalsy();
    expect(isRunner(b!)).toBe(true);
    // Still no first-start time: a later folder is not adopted by the repaired record.
    expect(readRecord().firstRunAt).toBeUndefined();
  });

  it('a machine already trusted keeps working: its runner runs with no question', async () => {
    homeWithRunner();
    writeFileSync(trustFile, JSON.stringify({ firstRunAt: new Date().toISOString(), hashes: {} }));
    const [a] = await loadAllAgents();
    expect(a!.heldCommands).toBeFalsy();
    expect(isRunner(a!)).toBe(true);
  });
});

describe('home-bound-not-resolution-directory: a relative program path binds the absolute path', () => {
  const REL = { command: './probe.sh' };

  it('a runner trusted in one directory does not run a same-named program of another directory', () => {
    const dirA = dirWith('a', 'probe.sh');
    const dirB = dirWith('b', 'probe.sh');
    writeFileSync(trustFile, JSON.stringify({ firstRunAt: '2020-01-01T00:00:00.000Z', hashes: {} }));
    trustWrittenCommands({ runner: REL }, home, process.env, dirA);
    expect(heldBackCommands({ runner: REL }, home, process.env, dirA).held).toBeNull();
    const there = heldBackCommands({ runner: REL }, home, process.env, dirB);
    expect(there.held).not.toBeNull();
    expect(there.config.runner).toBeUndefined();
    // The line names the program it would start here, and says how to connect it.
    const [line] = heldNotices([{ agent: 'assistant', owner: 'me', heldCommands: there.held }]);
    expect(line).toContain(join(dirB, 'probe.sh'));
    expect(line).toContain('aimeat connect');
    expect(line).not.toContain('\n');
  });

  it('a wake command trusted in one directory is held in another', () => {
    const dirA = dirWith('a', 'wake.sh');
    const dirB = dirWith('b', 'wake.sh');
    writeFileSync(trustFile, JSON.stringify({ firstRunAt: '2020-01-01T00:00:00.000Z', hashes: {} }));
    const wake = { command: './wake.sh --now' };
    trustWrittenCommands({ wake }, home, process.env, dirA);
    expect(heldBackCommands({ wake }, home, process.env, dirA).held).toBeNull();
    expect(heldBackCommands({ wake }, home, process.env, dirB).held).not.toBeNull();
  });

  it('keeps the use: an absolute program, a bare name and a runner with its own cwd run from every directory', () => {
    const dirA = dirWith('a', 'probe.sh');
    const dirB = dirWith('b', 'probe.sh');
    writeFileSync(trustFile, JSON.stringify({ firstRunAt: '2020-01-01T00:00:00.000Z', hashes: {} }));
    const abs = { command: join(dirA, 'probe.sh') };
    const withCwd = { command: './probe.sh', cwd: dirA };
    for (const runner of [abs, RUNNER, withCwd]) {
      trustWrittenCommands({ runner }, home, process.env, dirA);
      expect(heldBackCommands({ runner }, home, process.env, dirB).held).toBeNull();
    }
    // Absolute and bare commands keep the record they had before this change.
    expect(Object.keys(readRecord().hashes)).toEqual(expect.arrayContaining([
      textOnlyHash(home, abs, undefined), textOnlyHash(home, RUNNER, undefined),
    ]));
  });

  it('a command trusted before this change keeps running, and is bound once to where it runs', () => {
    const dirA = dirWith('a', 'probe.sh');
    const dirB = dirWith('b', 'probe.sh');
    const old = textOnlyHash(home, REL, undefined);
    writeFileSync(trustFile, JSON.stringify({ firstRunAt: '2020-01-01T00:00:00.000Z', hashes: { [old]: { at: '2026-10-26T00:00:00.000Z', how: 'connected' } } }));
    expect(heldBackCommands({ runner: REL }, home, process.env, dirA).held).toBeNull();
    const record = readRecord();
    expect(record.hashes[old]).toBeUndefined();
    expect(Object.values(record.hashes).map(h => h.how)).toEqual(['connected']);
    // Bound to dirA now: the next start there runs it, a start in another directory holds it.
    expect(heldBackCommands({ runner: REL }, home, process.env, dirA).held).toBeNull();
    expect(heldBackCommands({ runner: REL }, home, process.env, dirB).held).not.toBeNull();
  });

  it('an old record is not bound in a directory that does not hold the program', () => {
    const dirA = dirWith('a', 'probe.sh');
    const empty = join(sandbox, 'empty');
    mkdirSync(empty, { recursive: true });
    const old = textOnlyHash(home, REL, undefined);
    writeFileSync(trustFile, JSON.stringify({ firstRunAt: '2020-01-01T00:00:00.000Z', hashes: { [old]: { at: '2026-10-26T00:00:00.000Z', how: 'adopted' } } }));
    // Nothing by that name here, so nothing from this directory can run, and the old record stays.
    expect(heldBackCommands({ runner: REL }, home, process.env, empty).held).toBeNull();
    expect(readRecord().hashes[old]).toBeDefined();
    expect(heldBackCommands({ runner: REL }, home, process.env, dirA).held).toBeNull();
    expect(readRecord().hashes[old]).toBeUndefined();
  });

  it('adoption on a first start binds a relative runner to the directory of that start', () => {
    const dirA = dirWith('a', 'probe.sh');
    const dirB = dirWith('b', 'probe.sh');
    mkdirSync(join(home, 'agents', 'assistant'), { recursive: true });
    const cfg = join(home, 'agents', 'assistant', 'config.yaml');
    writeFileSync(cfg, stringify({ node_url: 'https://aimeat.io', runner: REL }));
    const then = beforeTheRelease();
    utimesSync(cfg, then, then);
    writeFileSync(trustFile, JSON.stringify({ firstRunAt: new Date().toISOString(), hashes: {} }));
    adoptExistingCommands(home, process.env, dirA);
    expect(existsSync(trustFile)).toBe(true);
    expect(heldBackCommands({ runner: REL }, home, process.env, dirA).held).toBeNull();
    expect(heldBackCommands({ runner: REL }, home, process.env, dirB).held).not.toBeNull();
  });
});
