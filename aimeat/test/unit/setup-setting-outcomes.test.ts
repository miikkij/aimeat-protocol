/**
 * @file test/unit/setup-setting-outcomes.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What POST /v1/setup/init reports for each node setting (services/setup-env.ts
 *   setupSettingOutcomes, setupMessage). QA audit F1-03: the answer said "Node setup complete" while
 *   the node id, node type, port and genesis URL were dropped or waited for a restart. The
 *   not-written case is also driven end to end in e2e-setup-and-verification.ts test 10; the written
 *   case needs a package root with no .env, which that suite must not create, so it is here.
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F1-03).
 */
import { describe, it, expect } from 'vitest';
import { setupSettingOutcomes, setupMessage } from '../../src/services/setup-env.js';

const running = { nodeId: 'aimeat-local-001-dev', port: 40050, nodeType: 'full' as const, genesisUrl: null };

describe('setup setting outcomes', () => {
  it('a setting equal to the running value, or not sent, is unchanged, and the message says complete', () => {
    const out = setupSettingOutcomes({ nodeId: 'aimeat-local-001-dev', nodeType: 'full' }, running, { written: true });
    expect(out.map(o => o.status)).toEqual(['unchanged', 'unchanged', 'unchanged', 'unchanged']);
    expect(setupMessage(out)).toMatch(/Node setup complete/);
  });

  it('a changed setting written to a new .env waits for a restart, and the message names it', () => {
    const out = setupSettingOutcomes({ nodeId: 'my-node', port: 40100 }, running, { written: true });
    const id = out.find(o => o.setting === 'node_id')!;
    expect(id).toMatchObject({ status: 'written', requested: 'my-node', running: 'aimeat-local-001-dev', restart_required: true });
    expect(id.reason).toContain('aimeat-local-001-dev');
    expect(out.find(o => o.setting === 'port')!.status).toBe('written');
    const msg = setupMessage(out);
    expect(msg).not.toMatch(/setup complete/i);
    expect(msg).toMatch(/restart the node: node id, port/);
  });

  it('a changed setting that was not written says so, with the reason, and the message does not say complete', () => {
    const reason = 'A .env configuration file already exists, and setup does not overwrite it.';
    const out = setupSettingOutcomes({ genesisUrl: 'https://genesis.example', nodeType: 'personal' }, running, { written: false, reason });
    expect(out.find(o => o.setting === 'genesis_url')).toMatchObject({ status: 'not_written', running: null, restart_required: false, reason });
    expect(out.find(o => o.setting === 'node_type')).toMatchObject({ status: 'not_written', requested: 'personal', running: 'full' });
    const msg = setupMessage(out);
    expect(msg).not.toMatch(/setup complete/i);
    expect(msg).toContain('NOT saved');
    expect(msg).toContain(reason);
  });
});
