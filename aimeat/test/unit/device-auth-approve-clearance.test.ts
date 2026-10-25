/**
 * @file test/unit/device-auth-approve-clearance.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The clearance an agent gets when another agent of the same owner approves it through
 *   same-owner auto-approval (approveDeviceAuth with the approver's scopes): never looser than the
 *   approver's own, for a new agent and for one it re-approves; an approver with no clearance passes
 *   none on (the crew-forge case), and an approval by the owner in person keeps the node default
 *   (secaudit2026oct22, agent-approver-sibling-skips-clearance). Real SQLite storage, real approve step.
 * @usage cd aimeat && pnpm exec vitest run test/unit/device-auth-approve-clearance.test.ts
 * @version-history
 *   2026-10-25 — Initial (secaudit2026oct22, agent-approver-sibling-skips-clearance).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { DeviceAuthorizationRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys } from '../../src/auth/jwt.js';
import { approveDeviceAuth } from '../../src/routes/agents/device-auth-approve.js';

const N = 'unit-node';
const OWNER = 'alice';
const APPROVER = `forge#${OWNER}@${N}`;
const base = { ...loadConfig().config, nodeId: N, classificationMode: 'all' } as AimeatConfig;

beforeAll(async () => {
  const keys = await generateKeyPair();
  await initNodeKeys(keys.publicKey, keys.privateKey);
});

function request(agentName: string): DeviceAuthorizationRecord {
  const now = new Date();
  return {
    deviceCode: randomBytes(16).toString('hex'), userCode: randomBytes(4).toString('hex'), ownerName: OWNER,
    agentName, status: 'pending', createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 3_600_000).toISOString(), pollInterval: 5, mode: 'interactive',
  } as DeviceAuthorizationRecord;
}

describe('the clearance an auto-approved agent gets', () => {
  let storage: SqliteStorage;
  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    await storage.createDeviceAuth(request('placeholder'));
  });
  afterEach(() => storage.close());

  async function approver(clearance?: string): Promise<void> {
    await storage.createAgent({
      name: 'forge', owner: OWNER, gaii: APPROVER, capabilities: [], publicKey: 'pk', trustScore: 50, morselBalance: 0,
      createdAt: '2026-10-25T00:00:00.000Z', lastSeen: '2026-10-25T00:00:00.000Z', defaultScopes: ['*'],
      ...(clearance ? { clearance } : {}),
    });
  }
  async function approve(agentName: string, by: string, approverScopes?: string[], config: AimeatConfig = base) {
    const req = request(agentName);
    await storage.createDeviceAuth(req);
    const out = await approveDeviceAuth(config, storage, req, by, ['memory:read'], undefined, true, approverScopes);
    expect(out.ok).toBe(true);
    return storage.getAgent(`${agentName}#${OWNER}@${N}`);
  }

  it('a new agent made by an agent with a clearance gets that clearance, not the open node default', async () => {
    await approver('sisainen');
    const made = await approve('sibling', APPROVER, ['*']);
    expect(made?.clearance).toBe('sisainen');
  });

  it('the stricter of the node default and the approver\'s clearance wins', async () => {
    await approver('luottamuksellinen');
    const made = await approve('sibling', APPROVER, ['*'], { ...base, agentClearanceDefault: 'sisainen' } as AimeatConfig);
    expect(made?.clearance).toBe('sisainen');
  });

  it('an agent re-approved by an approver with a clearance is lowered to it, never raised', async () => {
    await approver('sisainen');
    await storage.createAgent({
      name: 'old', owner: OWNER, gaii: `old#${OWNER}@${N}`, capabilities: [], publicKey: 'pk', trustScore: 50, morselBalance: 0,
      createdAt: '2026-10-25T00:00:00.000Z', lastSeen: '2026-10-25T00:00:00.000Z', defaultScopes: ['memory:read'],
      registeredBy: APPROVER,
    });
    expect((await approve('old', APPROVER, ['*']))?.clearance).toBe('sisainen');
    await storage.updateAgent(`old#${OWNER}@${N}`, { clearance: 'julkinen' });
    expect((await approve('old', APPROVER, ['*']))?.clearance).toBe('julkinen');
  });

  it('designed use: an approver with no clearance passes none on (crew-forge), and the owner in person keeps the node default', async () => {
    await approver();
    expect((await approve('crewmate', APPROVER, ['*']))?.clearance ?? null).toBeNull();
    expect((await approve('byowner', OWNER))?.clearance ?? null).toBeNull();
    const withDefault = { ...base, agentClearanceDefault: 'sisainen' } as AimeatConfig;
    expect((await approve('byowner2', OWNER, undefined, withDefault))?.clearance).toBe('sisainen');
  });
});
