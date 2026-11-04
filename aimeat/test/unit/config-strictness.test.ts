/**
 * @file test/unit/config-strictness.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description "An AI may only make this setting stricter" lives on the setting's row
 *   (`aiMayOnlyTighten`, services/config-field-def.ts) and every path that writes settings applies it
 *   (codebase analysis 2026-11-03, item B4; security-architecture finding 5). Until then the rule was a
 *   hand list of five paths: a sixth setting needed a new check written into each write path, and the
 *   path that was not given one did not apply it (d1f37bb4a: DELETE reset such a setting for an AI
 *   while PUT refused it). Here one more row is given the rule at run time and must be refused, on
 *   the Config API (PUT and aimeat_admin_config_set), in applyConfigChanges when the write names no
 *   caller, and on the reset (DELETE); a person changes and resets it as before, and an AI may still
 *   make it stricter. The answers of the five settings that had the rule are config-tighten-only.test.ts.
 * @usage cd aimeat && pnpm exec vitest run test/unit/config-strictness.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-04 -- Initial (codebase analysis 2026-11-03, item B4).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { CONFIG_FIELDS, MUTABLE_CONFIG_MAP } from '../../src/services/config-schema.js';
import { changeNodeSettings } from '../../src/services/config-admin-view.js';
import * as apply from '../../src/services/config-apply.js';

const NODE_ID = 'aimeat-local-001-dev';
const OP = 'strictop';
const person = { sub: OP, owner: OP, roles: ['owner', 'operator'] };
const agent = { sub: `claude#${OP}@${NODE_ID}`, owner: OP, roles: ['agent'], scopes: ['operator:admin'] };
/** A setting with no rule today: who may register to an app as its outside party, open to strict. */
const PATH = 'consent.party_self_registration';
const ORDER = ['on', 'apps-ask', 'off'];

describe('the rule is on the setting\'s row', () => {
  it('the five settings that have it say so on their rows, and their order names every value they take', () => {
    const marked = CONFIG_FIELDS.filter(f => f.aiMayOnlyTighten).map(f => f.dotPath).sort();
    expect(marked).toEqual(['auth.password_sign_in', 'auth.sign_in_lockout', 'auth.two_step_required', 'classification.mode', 'mcp.capability_use_approval']);
    for (const f of CONFIG_FIELDS.filter(f => f.aiMayOnlyTighten)) {
      expect([...f.aiMayOnlyTighten!.order].sort(), f.dotPath).toEqual([...(f.choices ?? [])].sort());
    }
  });
});

describe('a row that says so is held on every write path', () => {
  let dir: string;
  let storage: SqliteStorage;
  const field = MUTABLE_CONFIG_MAP[PATH]!;
  const fresh = (value: string): AimeatConfig => ({ ...loadConfig().config, nodeId: NODE_ID, sealedConfigKeys: [], partySelfRegistration: value } as AimeatConfig);
  const stored = async (): Promise<string | undefined> => (await storage.getAllConfigValues())[PATH];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'aimeat-strict-'));
    storage = new SqliteStorage(join(dir, 'node.db'));
    await storage.createOwner({ name: OP, displayName: OP, publicKey: 'pk', roles: ['owner', 'operator'], createdAt: new Date().toISOString() } as never);
    expect(field.choices).toEqual(expect.arrayContaining(ORDER));
    (field as { aiMayOnlyTighten?: unknown }).aiMayOnlyTighten = { order: ORDER };
  });
  afterAll(() => {
    delete (field as { aiMayOnlyTighten?: unknown }).aiMayOnlyTighten;
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('the Config API refuses an AI a looser value, names the setting, and applies nothing', async () => {
    await storage.deleteConfigValue(PATH);
    const config = fresh('off');
    const r = await changeNodeSettings({ config, storage }, agent, [{ path: 'auth.access_ttl_seconds', value: 1200 }, { path: PATH, value: 'on' }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(403);
    expect(r.code).toBe('PERSON_REQUIRED');
    expect(r.details).toEqual({ setting: PATH, from: 'off', to: 'on' });
    expect(r.message).toMatch(/admin Config page/);
    expect(r.message).toMatch(/Nothing in this request was applied\.$/);
    expect(config.partySelfRegistration).toBe('off');
    expect(await stored()).toBeUndefined();
  });

  it('a stricter value then a looser one in one request is a loosening', async () => {
    const r = await changeNodeSettings({ config: fresh('apps-ask'), storage }, agent, [{ path: PATH, value: 'off' }, { path: PATH, value: 'apps-ask' }]);
    expect(r.ok === false && r.code).toBe('PERSON_REQUIRED');
  });

  it('an AI may make it stricter, and a person may move it either way (usage)', async () => {
    const tighter = await changeNodeSettings({ config: fresh('on'), storage }, agent, [{ path: PATH, value: 'apps-ask' }]);
    expect(tighter.ok).toBe(true);
    const looser = await changeNodeSettings({ config: fresh('off'), storage }, person, [{ path: PATH, value: 'on' }]);
    expect(looser.ok).toBe(true);
    expect(await stored()).toBe('on');
  });

  it('applyConfigChanges refuses a looser value when the write names no caller, and writes nothing', async () => {
    await storage.deleteConfigValue(PATH);
    const config = fresh('off');
    const r = await apply.applyConfigChanges({ config, storage }, [{ path: PATH, value: 'on' }]);
    expect(r.applied).toEqual([]);
    expect(r.errors.map(e => e.path)).toEqual([PATH]);
    expect(config.partySelfRegistration).toBe('off');
    expect(await stored()).toBeUndefined();
    const byPerson = await apply.applyConfigChanges({ config, storage, caller: person }, [{ path: PATH, value: 'on' }]);
    expect(byPerson.applied.map(a => a.path)).toEqual([PATH]);
  });

  it('the reset (DELETE) refuses an AI and keeps the saved value; a person resets it (usage)', async () => {
    await storage.setConfigValue(PATH, 'off');
    const byAgent = await apply.resetConfigValue({ storage, caller: agent }, PATH);
    expect(byAgent).toMatchObject({ ok: false, status: 403, code: 'PERSON_REQUIRED', details: { setting: PATH } });
    expect(await stored()).toBe('off');
    const byPerson = await apply.resetConfigValue({ storage, caller: person }, PATH);
    expect(byPerson).toEqual({ ok: true });
    expect(await stored()).toBeUndefined();
  });
});
