/**
 * @file iam-app-commands.test.ts
 * @description P5 slice 1 characterization: the app command manifest + mutation tiers + decision run on
 *   the SAME level→capability primitive as the platform (a LevelSchema with groupType 'app', app-defined
 *   capabilities, '*' = all — matching the aimeat-iam extension's role semantics). Pins: a level runs a
 *   command iff its capabilities include the command's capability (or '*'); irreversible commands flag
 *   for confirmation; deriveAppCommandDecision resolves unknown/under-capability/allowed; the manifest
 *   validator rejects malformed manifests. This is the contract the extension + MCP tool will implement.
 * @usage cd aimeat && pnpm vitest run test/unit/iam-app-commands.test.ts
 * @version-history
 *   v1.0.0 — 2026-07-02 — IAM P5 slice 1: app command primitives.
 */
import { describe, it, expect } from 'vitest';
import type { LevelSchema } from '../../src/services/iam/model.js';
import {
  appMayRunCommand, commandNeedsConfirmation, deriveAppCommandDecision, validateCommandManifest,
  type CommandDef, type CommandManifest,
} from '../../src/services/iam/app-commands.js';

// An app level schema — same shape as the platform, capabilities are app-defined ('*' = all). Mirrors
// the aimeat-iam extension's default roles { admin:['*'], editor:['read','create','edit'], viewer:['read'] }.
const APP_SCHEMA: LevelSchema = {
  groupType: 'app', name: 'app-default', levels: [
    { level: 0, key: 'admin', label: 'Admin', capabilities: ['*'] },
    { level: 10, key: 'editor', label: 'Editor', capabilities: ['read', 'create', 'edit'] },
    { level: 20, key: 'viewer', label: 'Viewer', capabilities: ['read'] },
  ],
};

const CMDS: CommandDef[] = [
  { id: 'list', description: 'List items', capability: 'read', tier: 'read' },
  { id: 'create', description: 'Create an item', capability: 'create', tier: 'write' },
  { id: 'purge', description: 'Delete everything', capability: '*', tier: 'irreversible' },
];
const MANIFEST: CommandManifest = { appId: 'notes', commands: CMDS };

const cmd = (id: string) => CMDS.find(c => c.id === id)!;

describe('IAM app commands (P5) — capability decision on the shared level model', () => {
  it('a level runs a command iff its capabilities include the command capability', () => {
    expect(appMayRunCommand(20, APP_SCHEMA, cmd('list'))).toBe(true);    // viewer: read
    expect(appMayRunCommand(20, APP_SCHEMA, cmd('create'))).toBe(false); // viewer: no create
    expect(appMayRunCommand(10, APP_SCHEMA, cmd('create'))).toBe(true);  // editor: create
    expect(appMayRunCommand(10, APP_SCHEMA, cmd('purge'))).toBe(false);  // editor: not '*'
  });

  it("a level holding '*' (admin) runs anything, including irreversible", () => {
    for (const c of CMDS) expect(appMayRunCommand(0, APP_SCHEMA, c)).toBe(true);
  });

  it('an undefined level (not in the schema) holds no capabilities → runs nothing', () => {
    expect(appMayRunCommand(99, APP_SCHEMA, cmd('list'))).toBe(false);
  });

  it('irreversible commands flag for confirmation; read/write do not', () => {
    expect(commandNeedsConfirmation(cmd('purge'))).toBe(true);
    expect(commandNeedsConfirmation(cmd('list'))).toBe(false);
    expect(commandNeedsConfirmation(cmd('create'))).toBe(false);
  });
});

describe('IAM app commands (P5) — deriveAppCommandDecision', () => {
  it('unknown command id → denied unknown-command', () => {
    expect(deriveAppCommandDecision(0, APP_SCHEMA, MANIFEST, 'nope')).toEqual({ allowed: false, reason: 'unknown-command' });
  });

  it('known but under-capability → denied insufficient-capability (carries the command)', () => {
    const d = deriveAppCommandDecision(20, APP_SCHEMA, MANIFEST, 'purge');
    expect(d.allowed).toBe(false);
    expect(d).toMatchObject({ reason: 'insufficient-capability', command: { id: 'purge' } });
  });

  it('authorized → allowed with tier + needsConfirmation from the tier', () => {
    expect(deriveAppCommandDecision(0, APP_SCHEMA, MANIFEST, 'purge')).toEqual({
      allowed: true, command: cmd('purge'), needsConfirmation: true, tier: 'irreversible',
    });
    expect(deriveAppCommandDecision(20, APP_SCHEMA, MANIFEST, 'list')).toEqual({
      allowed: true, command: cmd('list'), needsConfirmation: false, tier: 'read',
    });
  });
});

describe('IAM app commands (P5) — validateCommandManifest', () => {
  it('accepts a well-formed manifest', () => {
    expect(validateCommandManifest(MANIFEST)).toEqual({ ok: true });
  });

  it('rejects missing appId, empty commands, bad tier, missing fields, and duplicate ids', () => {
    expect(validateCommandManifest({ commands: CMDS }).ok).toBe(false);
    expect(validateCommandManifest({ appId: 'x', commands: [] }).ok).toBe(false);
    expect(validateCommandManifest({ appId: 'x', commands: [{ id: 'a', description: 'd', capability: 'read', tier: 'nuke' }] }).ok).toBe(false);
    expect(validateCommandManifest({ appId: 'x', commands: [{ id: 'a', description: 'd', capability: '', tier: 'read' }] }).ok).toBe(false);
    expect(validateCommandManifest({ appId: 'x', commands: [cmd('list'), cmd('list')] }).ok).toBe(false);
  });
});
