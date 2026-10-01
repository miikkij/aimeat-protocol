/**
 * @file iam-define-app.test.ts
 * @description P5 slice 3: defineAppIam validates an app IAM design (level schema + command manifest),
 *   computes the level→command matrix (which levels may run which commands + which need confirmation),
 *   and emits the aimeat-iam admin payloads (setRoles/setLevels/setCommands) to apply it. Pins the
 *   matrix, the apply payloads, and the validation guards (lockout, malformed commands).
 * @usage cd aimeat && pnpm vitest run test/unit/iam-define-app.test.ts
 * @version-history
 *   v1.1.0 — 2026-10-01 — The matrix and the setRoles payload accumulate capabilities down the ladder,
 *     the way the generated gate does (audit 2026-10-01, defect B): a design whose editor lists only
 *     its own capabilities got a matrix that refused it the reader's command while the gate generated
 *     in the same answer allowed it. Also pins default_role, version, author and ext_name reaching the
 *     generated extension, their refusals, and the generated manifest declaring no required_apis.
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

/**
 * A ladder where each level lists ONLY its own capabilities: the editor declares publish + edit and
 * not the reader's read. The generated gate accumulates (generate-extension.ts accumulate()), so the
 * editor may run `list` there; the matrix and the setRoles payload must say the same thing.
 */
const LADDER: LevelDef[] = [
  { level: 0, key: 'admin', label: 'Administrator', capabilities: ['*'] },
  { level: 10, key: 'editor', label: 'Editor', capabilities: ['publish', 'edit'] },
  { level: 20, key: 'reader', label: 'Reader', capabilities: ['read'] },
];
const LADDER_COMMANDS: CommandDef[] = [
  { id: 'list', description: 'List entries', capability: 'read', tier: 'read' },
  { id: 'save', description: 'Save one entry', capability: 'edit', tier: 'write' },
  { id: 'announce', description: 'Publish the month', capability: 'publish', tier: 'write' },
  { id: 'purge', description: 'Delete every entry', capability: '*', tier: 'irreversible' },
];

/** The CAPS constant the generated check.js enforces, parsed out of the script text. */
function gateCaps(script: string): Record<string, string[]> {
  const m = /const CAPS = (\{.*?\});/s.exec(script);
  if (!m) throw new Error('check.js carries no CAPS constant');
  return JSON.parse(m[1]) as Record<string, string[]>;
}

describe('IAM defineAppIam — the matrix agrees with the generated gate', () => {
  it('a higher level holds every lower level\'s capabilities in the matrix', () => {
    const r = defineAppIam({ appId: 'ann/ledger.html', levels: LADDER, commands: LADDER_COMMANDS });
    if (!r.ok) throw new Error(r.error);
    expect(r.matrix.editor.canRun).toEqual(['list', 'save', 'announce']);
    expect(r.matrix.reader.canRun).toEqual(['list']);
    expect(r.matrix.admin).toEqual({ canRun: ['list', 'save', 'announce', 'purge'], needsConfirmation: ['purge'] });
  });

  it('every matrix verdict is the verdict of the gate generated in the same answer', () => {
    const r = defineAppIam({ appId: 'ann/ledger.html', levels: LADDER, commands: LADDER_COMMANDS });
    if (!r.ok || !r.extension) throw new Error('expected a generated extension');
    const caps = gateCaps(r.extension.scripts['check.js']);
    for (const l of LADDER) {
      const held = caps[l.key];
      const gateAllows = LADDER_COMMANDS.filter(c => held.includes('*') || held.includes(c.capability)).map(c => c.id);
      expect(r.matrix[l.key].canRun).toEqual(gateAllows);
    }
  });

  it('the setRoles payload carries the same accumulated roles, so an aimeat-iam install enforces the matrix', () => {
    const r = defineAppIam({ appId: 'ann/ledger.html', levels: LADDER, commands: LADDER_COMMANDS });
    if (!r.ok) throw new Error(r.error);
    const roles = r.apply.find(a => a.op === 'setRoles')?.roles as Record<string, string[]>;
    expect(roles.admin).toEqual(['*']);
    expect([...roles.editor].sort()).toEqual(['edit', 'publish', 'read']);
    expect(roles.reader).toEqual(['read']);
    // The returned schema is the design as declared: accumulation is a reading of it, not an edit.
    expect(r.schema.levels.find(l => l.key === 'editor')?.capabilities).toEqual(['publish', 'edit']);
  });
});

describe('IAM defineAppIam — the generator inputs the tool exposes', () => {
  it('default_role, version, author and ext_name reach the generated extension', () => {
    const r = defineAppIam({
      appId: 'ann/ledger.html', levels: LADDER, commands: LADDER_COMMANDS,
      defaultRole: 'reader', version: '1.4.1', author: 'ann: ledger team', extName: 'ann-ledger-gate',
    });
    if (!r.ok || !r.extension) throw new Error('expected a generated extension');
    expect(r.extension.name).toBe('ann-ledger-gate');
    expect(r.extension.manifest).toContain('name: ann-ledger-gate');
    expect(r.extension.manifest).toContain('version: 1.4.1');
    // Quoted, so a colon in the author cannot break the YAML the install route parses.
    expect(r.extension.manifest).toContain('author: "ann: ledger team"');
    expect(r.extension.manifest).toContain('holds \\"reader\\"');
    expect(r.extension.scripts['check.js']).toContain('const DEFAULT_ROLE = "reader";');
    expect(r.extension.scripts['roles.js']).toContain('const DEFAULT_ROLE = "reader";');
  });

  it('without them the gate keeps its defaults', () => {
    const r = defineAppIam({ appId: 'ann/ledger.html', levels: LADDER, commands: LADDER_COMMANDS });
    if (!r.ok || !r.extension) throw new Error('expected a generated extension');
    expect(r.extension.name).toBe('ann-ledger-iam');
    expect(r.extension.manifest).toContain('version: 1.0.0');
    expect(r.extension.manifest).toContain('author: generated');
    expect(r.extension.scripts['check.js']).toContain('const DEFAULT_ROLE = null;');
  });

  it('the generated manifest declares no required_apis, because the gate reads no memory', () => {
    const r = defineAppIam({ appId: 'ann/ledger.html', levels: LADDER, commands: LADDER_COMMANDS });
    if (!r.ok || !r.extension) throw new Error('expected a generated extension');
    expect(r.extension.manifest).not.toContain('required_apis');
    for (const s of Object.values(r.extension.scripts)) expect(s).not.toContain('ctx.memory');
  });

  it.each([
    [{ defaultRole: 'guest' }, /default_role "guest" is not one of the levels/],
    [{ defaultRole: 'admin' }, /default_role "admin" holds "\*"/],
    [{ version: '1.0' }, /version/],
    [{ version: '1.0.0\nrequired_apis: [wallet]' }, /version/],
    [{ extName: 'Ledger.IAM' }, /ext_name/],
    [{ author: '' }, /author/],
  ])('refuses %j', (extra, error) => {
    const r = defineAppIam({ appId: 'ann/ledger.html', levels: LADDER, commands: LADDER_COMMANDS, ...extra });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(error);
  });
});
