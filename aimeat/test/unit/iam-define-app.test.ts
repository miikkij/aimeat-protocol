/**
 * @file iam-define-app.test.ts
 * @description P5 slice 3: defineAppIam validates an app IAM design (level schema + command manifest),
 *   computes the level→command matrix (which levels may run which commands + which need confirmation),
 *   and emits the aimeat-iam admin payloads (setRoles/setLevels/setCommands) to apply it. Pins the
 *   matrix, the apply payloads, and the validation guards (lockout, malformed commands).
 * @usage cd aimeat && pnpm vitest run test/unit/iam-define-app.test.ts
 * @version-history
 *   v1.0.0 — 2026-07-02 — IAM P5 slice 3: define-app-iam.
 */
import { describe, it, expect } from 'vitest';
import { defineAppIam } from '../../src/services/iam/define-app-iam.js';
import type { LevelDef } from '../../src/services/iam/model.js';
import type { CommandDef } from '../../src/services/iam/app-commands.js';

const LEVELS: LevelDef[] = [
  { level: 0, key: 'admin', label: 'Admin', capabilities: ['*'] },
  { level: 10, key: 'editor', label: 'Editor', capabilities: ['read', 'create'] },
  { level: 20, key: 'viewer', label: 'Viewer', capabilities: ['read'] },
];
const COMMANDS: CommandDef[] = [
  { id: 'list', description: 'List', capability: 'read', tier: 'read' },
  { id: 'create', description: 'Create', capability: 'create', tier: 'write' },
  { id: 'purge', description: 'Purge', capability: '*', tier: 'irreversible' },
];

describe('IAM defineAppIam (P5) — validate + matrix + apply payloads', () => {
  it('computes the level→command matrix (canRun + needsConfirmation)', () => {
    const r = defineAppIam({ appId: 'notes', levels: LEVELS, commands: COMMANDS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.matrix.admin).toEqual({ canRun: ['list', 'create', 'purge'], needsConfirmation: ['purge'] });
    expect(r.matrix.editor).toEqual({ canRun: ['list', 'create'], needsConfirmation: [] });
    expect(r.matrix.viewer).toEqual({ canRun: ['list'], needsConfirmation: [] });
  });

  it('emits setRoles + setLevels + setCommands admin payloads', () => {
    const r = defineAppIam({ appId: 'notes', levels: LEVELS, commands: COMMANDS });
    if (!r.ok) throw new Error('expected ok');
    expect(r.apply).toEqual([
      { op: 'setRoles', roles: { admin: ['*'], editor: ['read', 'create'], viewer: ['read'] } },
      { op: 'setLevels', levels: { admin: 0, editor: 10, viewer: 20 } },
      { op: 'setCommands', commands: COMMANDS },
    ]);
    expect(r.schema.groupType).toBe('app');
  });

  it('rejects a schema with no level 0 holding "*" (lockout guard)', () => {
    const r = defineAppIam({ appId: 'x', levels: [{ level: 10, key: 'e', label: 'E', capabilities: ['read'] }], commands: COMMANDS });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/level 0/);
  });

  it('rejects a malformed command manifest', () => {
    const r = defineAppIam({ appId: 'x', levels: LEVELS, commands: [{ id: 'a', description: 'd', capability: 'read', tier: 'nuke' } as unknown as CommandDef] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/commands:/);
  });
});
