/**
 * @file connect-enrol-held-notice.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An enrolment the owner approved on the node is a connect: a runner or wake command
 *   that the settings already named, and that was held because nobody had connected the folder, is
 *   taken into use (designed use, decision 2026-10-27). These tests keep that use and check that the
 *   daemon says so in one line that names the command and the owner's approval
 *   (secaudit2026oct26, node-offer-trusts-held-commands). A first start that adopts a home's
 *   commands names each one in the log (secaudit2026oct26, mtime-cutoff-not-bound-to-update).
 * @usage cd aimeat && pnpm exec vitest run test/unit/connect-enrol-held-notice.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Initial (secaudit2026oct26, node-offer-trusts-held-commands).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify as yamlStringify } from 'yaml';

const NODE_A = 'aimeat-test-001-a';
const URL_A = 'http://node-a.example:4001';
const KEY_A = 'a'.repeat(43);
const RUNNER = { command: 'node', args: ['./marker.js'] };

let sandbox = '';
let home = '';
let trustFile = '';
const saved: Record<string, string | undefined> = {};
const setEnv = (k: string, v: string) => { saved[k] = process.env[k]; process.env[k] = v; };

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'aimeat-enrol-held-'));
  home = join(sandbox, 'home');
  trustFile = join(sandbox, 'trust', 'trusted-commands.json');
  mkdirSync(join(sandbox, 'trust'), { recursive: true });
  // The update ran here earlier, and nothing is trusted yet.
  writeFileSync(trustFile, JSON.stringify({ firstRunAt: '2020-01-01T00:00:00.000Z', hashes: {} }));
  setEnv('AIMEAT_HOME', home);
  setEnv('AIMEAT_COMMAND_TRUST_FILE', trustFile);
  mkdirSync(join(home, 'agents', 'alice', 'concierge'), { recursive: true });
  writeFileSync(join(home, 'agents', 'alice', 'concierge', 'config.yaml'), yamlStringify({ node_url: URL_A, runner: RUNNER }));
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  vi.restoreAllMocks();
  rmSync(sandbox, { recursive: true, force: true });
});

async function enrol() {
  vi.resetModules();
  const { handleEnrolOffer } = await import('../../src/cli/connect/enrolment.js');
  const attached: Array<{ config: { runner?: unknown } }> = [];
  const agents = [{ name: 'concierge', gaii: `concierge#alice@${NODE_A}`, scopes: [] }];
  const out = await handleEnrolOffer(
    { grant_id: 'g1', owner: 'alice', node_id: NODE_A, node_url: URL_A, node_public_key: KEY_A, agents },
    {
      receiver: { gaii: `receiver-bot#alice@${NODE_A}`, owner: 'alice', config: { node_url: URL_A } },
      readNodeCard: async () => ({ ok: true as const, nodeId: NODE_A, publicKey: KEY_A }),
      forward: async () => ({ status: 200, body: { ok: true, data: { enrolled: agents.map(a => ({ name: a.name, gaii: a.gaii, access_token: 't', expires_in: 3600 })) } } }),
      attach: async (a: { config: { runner?: unknown } }) => { attached.push(a); },
      version: 'test',
    } as never,
  );
  return { out, attached };
}

describe('an enrolment the owner approved takes a held command into use, and says so', () => {
  it('keeps the use: the runner is attached and recorded as trusted', async () => {
    const { out, attached } = await enrol();
    expect(out.ok).toBe(true);
    expect(attached).toHaveLength(1);
    expect(attached[0].config.runner).toEqual(RUNNER);
    const record = JSON.parse(readFileSync(trustFile, 'utf-8')) as { hashes: Record<string, { how: string }> };
    expect(Object.values(record.hashes).map(h => h.how)).toContain('connected');
  });

  it('prints one line naming the command and the owner\'s approval on the node', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')); });
    await enrol();
    const notice = lines.find(l => l.includes('node ./marker.js'));
    expect(notice).toBeDefined();
    expect(notice).toContain(`concierge#alice@${NODE_A}`);
    expect(notice).toContain('the owner approved on the node');
  });

  it('a first start that adopts a home\'s commands names each one in the log', async () => {
    rmSync(trustFile);
    vi.resetModules();
    const { logger } = await import('../../src/utils/logger.js');
    const { adoptExistingCommands, heldBackCommands } = await import('../../src/cli/connect/command-trust.js');
    const cfg = join(home, 'agents', 'alice', 'concierge', 'config.yaml');
    const past = new Date(Date.now() - 3_600_000);
    const { utimesSync } = await import('node:fs');
    utimesSync(cfg, past, past);
    const infos: unknown[][] = [];
    vi.spyOn(logger, 'info').mockImplementation(((...a: unknown[]) => { infos.push(a); return logger; }) as never);
    adoptExistingCommands(home);
    // The use is kept: the install's runner is adopted and runs.
    expect(heldBackCommands({ runner: RUNNER }, home).held).toBeNull();
    const entry = infos.find(a => String(a[0]).includes('adopted'));
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry)).toContain('node ./marker.js');
  });

  it('prints nothing when the command was already trusted', async () => {
    const { out } = await enrol();
    expect(out.ok).toBe(true);
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')); });
    await enrol();
    expect(lines.some(l => l.includes('the owner approved on the node'))).toBe(false);
  });
});
