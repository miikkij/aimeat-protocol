/**
 * @file test/unit/connector-programs.test.ts
 * @description The programs a computer may start for its agents, and the owner's decision on them
 *   (wish-koneen-ohjelmaluettelo-nodeen-sallitut-ja-hyv-ksynt-odottava).
 *
 *   1. What the owner reads: a program the machine runs, one that waits, one the owner allowed or
 *      stopped and the machine has not acted on yet, and a "no" that the machine overruled later.
 *   2. What the connector does with the node's answer: an allowed hash it holds itself is taken into
 *      use and recorded `approved`; a hash it did not report is ignored; a newer "no" stops a command
 *      it runs and records `stopped`, which the once-only adoption does not take back and a connect
 *      at the machine does; an older "no" changes nothing.
 * @version-history
 *   v1.0.0 -- 2026-10-31 -- Initial.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { programStatusOf, programViewsOf, type StoredAgentPrograms } from '../../src/services/connector-programs-view.js';
import { reportPrograms, programsBodyOf } from '../../src/cli/connect/program-report.js';
import { commandHash, isTrustedCommand, trustEntryOf, trustWrittenCommands, adoptExistingCommands } from '../../src/cli/connect/command-trust.js';
import type { RegisteredAgent } from '../../src/cli/connect/agent-registry.js';

const HASH = 'a'.repeat(64);
const stored = (over: Partial<StoredAgentPrograms> = {}): StoredAgentPrograms => ({
  hash: HASH, status: 'waiting', runner: 'node run.js', wake: null, source: null, since: null, reported_at: '2026-10-31T10:00:00.000Z', ...over,
});

describe('1. what the owner reads', () => {
  it('a program the machine runs is allowed and applied', () => {
    expect(programStatusOf(stored({ status: 'allowed', since: '2026-10-30T00:00:00.000Z' }), undefined)).toEqual({ status: 'allowed', applied: true });
  });
  it('a program that waits, with no decision, waits', () => {
    expect(programStatusOf(stored(), { decision: null, decided_at: null, request_id: 'r1' })).toEqual({ status: 'waiting', applied: true });
  });
  it('a waiting program the owner allowed is allowed, not yet applied', () => {
    expect(programStatusOf(stored(), { decision: 'allowed', decided_at: '2026-10-31T11:00:00.000Z', request_id: null })).toEqual({ status: 'allowed', applied: false });
  });
  it('a running program the owner stopped later is declined, not yet applied', () => {
    expect(programStatusOf(stored({ status: 'allowed', since: '2026-10-30T00:00:00.000Z' }), { decision: 'declined', decided_at: '2026-10-31T11:00:00.000Z', request_id: null }))
      .toEqual({ status: 'declined', applied: false });
  });
  it('a "no" older than the machine\'s own trust was overruled at the machine', () => {
    expect(programStatusOf(stored({ status: 'allowed', since: '2026-10-31T12:00:00.000Z' }), { decision: 'declined', decided_at: '2026-10-31T11:00:00.000Z', request_id: null }))
      .toEqual({ status: 'allowed', applied: true });
  });
  it('one row per program, only for agents on this computer, the request id only while it waits', () => {
    const rows = programViewsOf(
      { a: stored({ wake: 'node wake.js' }), gone: stored({ hash: 'b'.repeat(64) }) },
      { [HASH]: { decision: null, decided_at: null, request_id: 'r1' } },
      ['a'],
    );
    expect(rows.map(r => [r.agent, r.use, r.command, r.status, r.request_id])).toEqual([
      ['a', 'runner', 'node run.js', 'waiting', 'r1'],
      ['a', 'wake', 'node wake.js', 'waiting', 'r1'],
    ]);
  });
});

describe('2. what the connector does with the answer', () => {
  let sandbox: string;
  let home: string;
  let env: NodeJS.ProcessEnv;
  const RUNNER = { command: 'node', args: ['./run.js'] };

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'aimeat-programs-'));
    home = join(sandbox, '.aimeat');
    mkdirSync(home, { recursive: true });
    env = { ...process.env, AIMEAT_COMMAND_TRUST_FILE: join(sandbox, 'trust', 'trusted-commands.json') };
  });
  afterEach(() => rmSync(sandbox, { recursive: true, force: true }));

  /** An agent whose client answers each PUT with `answer(body)` and records the bodies. */
  function agent(config: RegisteredAgent['config'], held: RegisteredAgent['heldCommands'], answer: (body: any) => any) {
    const sent: any[] = [];
    const client = { put: async (_path: string, body: unknown) => { sent.push(body); return { ok: true, data: answer(body) }; } };
    const entry = { gaii: 'a#me@n', agent: 'a', owner: 'me', client: client as unknown as RegisteredAgent['client'], config, heldCommands: held } as RegisteredAgent;
    return { entry, sent };
  }

  it('an allowed hash it holds is taken into use and recorded approved', async () => {
    const hash = commandHash(home, RUNNER, undefined, sandbox);
    const { entry, sent } = agent({ node_url: 'http://x' }, { hash, home: resolve(home), runner: RUNNER }, b => ({ hash: b.hash, decision: b.status === 'waiting' ? 'allowed' : null, decided_at: '2026-10-31T11:00:00.000Z' }));
    await reportPrograms(entry, home, env, sandbox);
    expect(entry.config.runner).toEqual(RUNNER);
    expect(entry.heldCommands).toBeNull();
    expect(isTrustedCommand(hash, env)).toBe(true);
    expect(trustEntryOf(hash, env)?.how).toBe('approved');
    expect(sent.map(b => b.status)).toEqual(['waiting', 'allowed']);
  });

  it('an answer for another hash changes nothing', async () => {
    const hash = commandHash(home, RUNNER, undefined, sandbox);
    const { entry } = agent({ node_url: 'http://x' }, { hash, home: resolve(home), runner: RUNNER }, () => ({ hash: 'f'.repeat(64), decision: 'allowed', decided_at: '2026-10-31T11:00:00.000Z' }));
    await reportPrograms(entry, home, env, sandbox);
    expect(entry.config.runner).toBeUndefined();
    expect(isTrustedCommand(hash, env)).toBe(false);
  });

  it('a newer "no" stops a command it runs; the adoption does not take it back, a connect at the machine does', async () => {
    const config = { node_url: 'http://x', runner: RUNNER };
    trustWrittenCommands(config, home, env, sandbox);
    const hash = commandHash(home, RUNNER, undefined, sandbox);
    const { entry, sent } = agent(config, null, b => ({ hash: b.hash, decision: 'declined', decided_at: new Date(Date.now() + 60_000).toISOString() }));
    await reportPrograms(entry, home, env, sandbox);
    expect(entry.config.runner).toBeUndefined();
    expect(entry.heldCommands?.hash).toBe(hash);
    expect(isTrustedCommand(hash, env)).toBe(false);
    expect(trustEntryOf(hash, env)?.how).toBe('stopped');
    expect(sent.map(b => b.status)).toEqual(['allowed', 'waiting']);

    // The config file is older than the first start: the adoption would take it, and must not.
    mkdirSync(join(home, 'agents', 'a'), { recursive: true });
    const file = join(home, 'agents', 'a', 'config.yaml');
    writeFileSync(file, 'node_url: http://x\nrunner:\n  command: node\n  args: ["./run.js"]\n');
    const old = new Date('2020-01-01T00:00:00.000Z');
    utimesSync(file, old, old);
    adoptExistingCommands(home, env, sandbox, null);
    expect(isTrustedCommand(hash, env)).toBe(false);

    trustWrittenCommands(config, home, env, sandbox);
    expect(isTrustedCommand(hash, env)).toBe(true);
    expect(trustEntryOf(hash, env)?.how).toBe('connected');
  });

  it('a "no" older than the machine\'s own trust changes nothing', async () => {
    const config = { node_url: 'http://x', runner: RUNNER };
    trustWrittenCommands(config, home, env, sandbox);
    const { entry, sent } = agent(config, null, b => ({ hash: b.hash, decision: 'declined', decided_at: '2020-01-01T00:00:00.000Z' }));
    await reportPrograms(entry, home, env, sandbox);
    expect(entry.config.runner).toEqual(RUNNER);
    expect(sent).toHaveLength(1);
  });

  it('an agent with no runner and no wake command reports none', () => {
    const { entry } = agent({ node_url: 'http://x' }, null, () => ({}));
    expect(programsBodyOf(entry, home, env, sandbox)).toEqual({ hash: null });
  });
});
