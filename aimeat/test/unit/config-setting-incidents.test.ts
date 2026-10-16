/**
 * @file test/unit/config-setting-incidents.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Security page incident for a setting the node did not accept at start: one open
 *   incident per setting, none added by a start with the same value, a new one for a new wrong value,
 *   and closed by itself at the first start with a value the node accepts (Jouni, decision
 *   2026-10-16). Runs on SQLite in memory, through the same incident service the Security page reads.
 * @usage cd aimeat && pnpm exec vitest run test/unit/config-setting-incidents.test.ts
 * @version-history
 *   2026-10-16 — Initial (Jouni, decision 2026-10-16).
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import type { StartSettingFallback } from '../../src/config-start-check.js';
import { CONFIG_SETTING_INCIDENT_TYPE, settleSettingIncidentsAtStart } from '../../src/services/config-setting-incidents.js';
import { listSecurityIncidents, resolveSecurityIncident } from '../../src/services/security-incident.js';

const config = { nodeId: 'aimeat-test-001-settings' } as AimeatConfig;
const metrics = (value: string): StartSettingFallback => ({
  variable: 'AIMEAT_METRICS_ACCESS', value, takes: 'takes one of public, authenticated, operator', used: 'operator', dotPath: 'metrics_access',
});
const port: StartSettingFallback = { variable: 'AIMEAT_PORT', value: 'eighty', takes: 'takes a whole number (1-65535)', used: '40050', dotPath: 'node.port' };

async function incidents(storage: Storage) {
  return (await listSecurityIncidents(storage, config)).items.filter(i => i.type === CONFIG_SETTING_INCIDENT_TYPE);
}

describe('a setting the node did not accept is an incident on the Security page', () => {
  it('opens one incident per setting, naming the value, its problem, the default and what to do', async () => {
    const storage = new SqliteStorage(':memory:') as unknown as Storage;
    await settleSettingIncidentsAtStart(storage, config, [metrics('everyone'), port]);
    const open = await incidents(storage);
    expect(open.map(i => i.setting?.variable).sort()).toEqual(['AIMEAT_METRICS_ACCESS', 'AIMEAT_PORT']);
    const m = open.find(i => i.setting?.variable === 'AIMEAT_METRICS_ACCESS')!;
    expect(m).toMatchObject({ status: 'open', code: 'SETTING_NOT_ACCEPTED', source: 'start', setting: { value: 'everyone' } });
    expect(m.detail).toContain('"everyone"');
    expect(m.detail).toContain('takes one of public, authenticated, operator');
    expect(m.detail).toContain('the default, operator');
    expect(m.detail).toContain('closes by itself');
  });

  it('a start with the same value opens nothing new', async () => {
    const storage = new SqliteStorage(':memory:') as unknown as Storage;
    await settleSettingIncidentsAtStart(storage, config, [metrics('everyone')]);
    await settleSettingIncidentsAtStart(storage, config, [metrics('everyone')]);
    expect(await incidents(storage)).toHaveLength(1);
  });

  it('a start with a value the node accepts closes the incident by itself', async () => {
    const storage = new SqliteStorage(':memory:') as unknown as Storage;
    await settleSettingIncidentsAtStart(storage, config, [metrics('everyone'), port]);
    await settleSettingIncidentsAtStart(storage, config, [port]);
    const all = await incidents(storage);
    expect(all.find(i => i.setting?.variable === 'AIMEAT_METRICS_ACCESS')).toMatchObject({ status: 'resolved' });
    expect(all.find(i => i.setting?.variable === 'AIMEAT_PORT')).toMatchObject({ status: 'open' });
  });

  it('a different wrong value closes the old incident and opens one naming the new value', async () => {
    const storage = new SqliteStorage(':memory:') as unknown as Storage;
    await settleSettingIncidentsAtStart(storage, config, [metrics('everyone')]);
    await settleSettingIncidentsAtStart(storage, config, [metrics('nobody')]);
    const all = await incidents(storage);
    expect(all.filter(i => i.status === 'open').map(i => i.setting?.value)).toEqual(['nobody']);
    expect(all.filter(i => i.status === 'resolved').map(i => i.setting?.value)).toEqual(['everyone']);
  });

  it('an incident the operator resolved while the value is still wrong opens again at the next start', async () => {
    const storage = new SqliteStorage(':memory:') as unknown as Storage;
    await settleSettingIncidentsAtStart(storage, config, [metrics('everyone')]);
    await resolveSecurityIncident(storage, config, (await incidents(storage))[0].id);
    await settleSettingIncidentsAtStart(storage, config, [metrics('everyone')]);
    expect((await incidents(storage)).filter(i => i.status === 'open')).toHaveLength(1);
  });

  it('leaves the other incidents alone', async () => {
    const storage = new SqliteStorage(':memory:') as unknown as Storage;
    const { recordSecurityIncident, securityOwner } = await import('../../src/services/security-incident.js');
    await recordSecurityIncident(storage, config, { type: 'headless_browser', code: 'BROWSER_LAUNCH_FAILED', actorGhii: securityOwner(config.nodeId), detail: 'x', source: 'start' });
    await settleSettingIncidentsAtStart(storage, config, []);
    const all = (await listSecurityIncidents(storage, config)).items;
    expect(all.map(i => [i.type, i.status])).toEqual([['headless_browser', 'open']]);
  });
});
