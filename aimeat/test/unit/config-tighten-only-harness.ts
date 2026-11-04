/**
 * @file test/unit/config-tighten-only-harness.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Collects the answers the config write paths give for the settings an AI may only
 *   make stricter: PUT /v1/admin/config and aimeat_admin_config_set (changeNodeSettings), the
 *   classification switch (setClassificationSwitch, PUT /v1/classification/switch and
 *   aimeat_classification switch_set), and the reset of a saved value (DELETE
 *   /v1/admin/config/:path, resetNodeSettingRefusal). Every credential shape against every pair of
 *   values, single changes and mixed batches. config-tighten-only.test.ts compares the answers with
 *   the ones the code gave before the rule moved onto the setting's definition
 *   (fixtures/config-tighten-only-answers.json, written by this harness from the code at
 *   cc-jouni-arch-afix 0fc46b7c9), so a changed message, code, status, detail or precedence fails.
 * @structure collectTightenOnlyAnswers()
 * @usage const answers = await collectTightenOnlyAnswers();
 * @version-history
 *   v1.0.0 -- 2026-11-04 -- Initial (codebase analysis 2026-11-03, item B4).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { changeNodeSettings, resetNodeSettingRefusal } from '../../src/services/config-admin-view.js';
import { setClassificationSwitch, type SwitchCaller } from '../../src/services/classification-run/switch.js';

const NODE_ID = 'aimeat-local-001-dev';
const OP = 'tightop';

/** The credential shapes the checks tell apart (classification/reader-kind.ts). */
const CALLERS: Record<string, SwitchCaller> = {
  person: { sub: OP, owner: OP, roles: ['owner', 'operator'] },
  ownerPat: { sub: OP, owner: OP, roles: ['owner', 'operator'], via: 'pat' },
  narrowPat: { sub: `pat#${OP}@${NODE_ID}`, owner: OP, roles: ['agent'], scopes: ['operator:admin'], via: 'pat' },
  agent: { sub: `claude#${OP}@${NODE_ID}`, owner: OP, roles: ['agent'], scopes: ['operator:admin'] },
  unattended: { sub: OP, owner: OP, roles: ['operator'] },
  anonymous: { sub: 'anon', owner: 'anon', roles: ['owner'], anonymous: true },
};

/** Each setting an AI may only make stricter, its running config key and its values, open to strict. */
const SETTINGS: { path: string; key: keyof AimeatConfig; values: string[] }[] = [
  { path: 'classification.mode', key: 'classificationMode', values: ['off', 'owner', 'all'] },
  { path: 'auth.two_step_required', key: 'twoStepRequired', values: ['off', 'operators', 'everyone'] },
  { path: 'auth.password_sign_in', key: 'passwordSignIn', values: ['on', 'operators', 'off'] },
  { path: 'auth.sign_in_lockout', key: 'signInLockout', values: ['off', 'on'] },
  { path: 'mcp.capability_use_approval', key: 'mcpCapabilityUseApproval', values: ['off', 'operators', 'ask'] },
];

/** Mixed requests: which refusal answers when one request carries more than one. */
const BATCHES: { name: string; start: Partial<AimeatConfig>; changes: { path: string; value: unknown }[] }[] = [
  { name: 'classification loosen, then two-step loosen', start: { classificationMode: 'all', twoStepRequired: 'everyone' },
    changes: [{ path: 'classification.mode', value: 'owner' }, { path: 'auth.two_step_required', value: 'off' }] },
  { name: 'two-step loosen, then classification loosen', start: { classificationMode: 'all', twoStepRequired: 'everyone' },
    changes: [{ path: 'auth.two_step_required', value: 'off' }, { path: 'classification.mode', value: 'owner' }] },
  { name: 'password loosen, then two-step loosen', start: { passwordSignIn: 'off', twoStepRequired: 'everyone' },
    changes: [{ path: 'auth.password_sign_in', value: 'on' }, { path: 'auth.two_step_required', value: 'off' }] },
  { name: 'two-step loosen, then password loosen', start: { passwordSignIn: 'off', twoStepRequired: 'everyone' },
    changes: [{ path: 'auth.two_step_required', value: 'off' }, { path: 'auth.password_sign_in', value: 'on' }] },
  { name: 'lockout off, then password loosen', start: { passwordSignIn: 'off', signInLockout: 'on' },
    changes: [{ path: 'auth.sign_in_lockout', value: 'off' }, { path: 'auth.password_sign_in', value: 'operators' }] },
  { name: 'capability loosen, then classification loosen', start: { classificationMode: 'all', mcpCapabilityUseApproval: 'ask' },
    changes: [{ path: 'mcp.capability_use_approval', value: 'off' }, { path: 'classification.mode', value: 'off' }] },
  { name: 'capability loosen, then two-step loosen', start: { twoStepRequired: 'everyone', mcpCapabilityUseApproval: 'ask' },
    changes: [{ path: 'mcp.capability_use_approval', value: 'operators' }, { path: 'auth.two_step_required', value: 'operators' }] },
  { name: 'capability loosen, then two-step required while TOTP is off', start: { twoStepRequired: 'off', totpEnabled: false, mcpCapabilityUseApproval: 'ask' },
    changes: [{ path: 'mcp.capability_use_approval', value: 'off' }, { path: 'auth.two_step_required', value: 'operators' }] },
  { name: 'capability loosen, then password off with no operator who has another way in', start: { passwordSignIn: 'on', mcpCapabilityUseApproval: 'ask' },
    changes: [{ path: 'mcp.capability_use_approval', value: 'off' }, { path: 'auth.password_sign_in', value: 'off' }] },
  { name: 'two-step loosen, then TOTP off while required', start: { twoStepRequired: 'everyone', totpEnabled: true },
    changes: [{ path: 'auth.two_step_required', value: 'operators' }, { path: 'totp.enabled', value: false }] },
  { name: 'stricter, then looser, on one setting', start: { mcpCapabilityUseApproval: 'operators' },
    changes: [{ path: 'mcp.capability_use_approval', value: 'ask' }, { path: 'mcp.capability_use_approval', value: 'off' }] },
  { name: 'classification stricter, then looser', start: { classificationMode: 'owner' },
    changes: [{ path: 'classification.mode', value: 'all' }, { path: 'classification.mode', value: 'owner' }] },
  { name: 'TOTP on and two-step required in one request', start: { twoStepRequired: 'off', totpEnabled: false },
    changes: [{ path: 'totp.enabled', value: true }, { path: 'auth.two_step_required', value: 'everyone' }] },
  { name: 'a stricter value and an ordinary setting', start: { signInLockout: 'off' },
    changes: [{ path: 'auth.sign_in_lockout', value: 'on' }, { path: 'auth.access_ttl_seconds', value: 1200 }] },
  { name: 'a value the setting does not take', start: { twoStepRequired: 'everyone' },
    changes: [{ path: 'auth.two_step_required', value: 'sometimes' }] },
];

/** Paths a reset is asked for: the five, and two ordinary ones beside them. */
const RESET_PATHS = [...SETTINGS.map(s => s.path), 'totp.enabled', 'auth.access_ttl_seconds', 'not.a.setting'];

type Answer = Record<string, unknown>;

/** What a person or an AI sees of a changeNodeSettings answer. */
function shapeOf(r: Awaited<ReturnType<typeof changeNodeSettings>>): Answer {
  if (!r.ok) return { ok: false, status: r.status, code: r.code, message: r.message, ...(r.details ? { details: r.details } : {}) };
  return { ok: true, applied: r.applied, ...(r.errors ? { errors: r.errors } : {}), note: r.note };
}

export async function collectTightenOnlyAnswers(): Promise<Record<string, Answer>> {
  // A file, not ':memory:': an in-memory store answers that it cannot keep settings (READONLY_CONFIG).
  const dir = mkdtempSync(join(tmpdir(), 'aimeat-tighten-'));
  const storage = new SqliteStorage(join(dir, 'node.db'));
  await storage.createOwner({ name: OP, displayName: OP, publicKey: 'pk', roles: ['owner', 'operator'], createdAt: new Date().toISOString() } as never);
  const base = { ...loadConfig().config, nodeId: NODE_ID, totpEnabled: true, classificationMode: 'off', twoStepRequired: 'off',
    passwordSignIn: 'on', signInLockout: 'off', mcpCapabilityUseApproval: 'operators' } as AimeatConfig;
  const fresh = (start: Partial<AimeatConfig>): AimeatConfig => ({ ...base, sealedConfigKeys: [], ...start });
  const out: Record<string, Answer> = {};
  try {
    for (const s of SETTINGS) {
      for (const from of s.values) {
        for (const to of [...s.values, 'bogus']) {
          for (const [who, caller] of Object.entries(CALLERS)) {
            const config = fresh({ [s.key]: from } as Partial<AimeatConfig>);
            out[`put ${s.path} ${from}->${to} ${who}`] = shapeOf(await changeNodeSettings({ config, storage }, caller, [{ path: s.path, value: to }]));
          }
        }
      }
    }
    for (const b of BATCHES) {
      for (const [who, caller] of Object.entries(CALLERS)) {
        out[`batch ${b.name} ${who}`] = shapeOf(await changeNodeSettings({ config: fresh(b.start), storage }, caller, b.changes));
      }
    }
    for (const from of ['off', 'owner', 'all']) {
      for (const to of ['off', 'owner', 'all', 'bogus']) {
        for (const [who, caller] of Object.entries(CALLERS)) {
          const config = fresh({ classificationMode: from } as Partial<AimeatConfig>);
          try {
            out[`switch ${from}->${to} ${who}`] = { ok: true, ...(await setClassificationSwitch({ storage, config }, caller, to)) };
          } catch (e) {
            const err = e as { code?: string; status?: number; message?: string };
            out[`switch ${from}->${to} ${who}`] = { ok: false, code: err.code, status: err.status, message: err.message };
          }
        }
      }
    }
    for (const path of RESET_PATHS) {
      for (const [who, caller] of Object.entries(CALLERS)) {
        out[`reset ${path} ${who}`] = { refusal: resetNodeSettingRefusal(caller, path) };
      }
    }
  } finally {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  }
  return out;
}
