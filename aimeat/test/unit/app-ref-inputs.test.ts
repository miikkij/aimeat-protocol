/**
 * @file test/unit/app-ref-inputs.test.ts
 * @description The MCP tool fields that name an app (services/app/app-ref-inputs.ts) and the
 *   registrar wrapper that applies them (mcp/app-ref-input.ts).
 *
 *   What each row must do: turn a name without `.html` into the stored filename for the right owner,
 *   leave a value that names no app, an `eco:` name or another owner's prefix as it came, and never
 *   fail the call when the lookup does.
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-sovelluksen-nimi-ilman-html-p-tett-kaikkialla).
 */
import { describe, it, expect } from 'vitest';
import {
  APP_REF_INPUTS, normalizeAppRefInput, refBinding, refOwnerFilename, refOwnerFilenameKeys, type AppRefCtx,
} from '../../src/services/app/app-ref-inputs.js';
import { withAppRefInput } from '../../src/mcp/app-ref-input.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';

const apps: Record<string, string[]> = {
  alice: ['shop.html', 'club.html', 'twin', 'twin.html'],
  bob: ['shop.html'],
};

function storeOf(): AppRefCtx['storage'] {
  return {
    async appFilenamesAmong(owner: { ownerGaii: string } | { ownerName: string }, candidates: string[]) {
      const key = 'ownerGaii' in owner ? owner.ownerGaii.split('@')[0] : owner.ownerName;
      const have = new Set(apps[key] ?? []);
      return candidates.filter(c => have.has(c));
    },
    async getMemory() { return null; },
  } as unknown as AppRefCtx['storage'];
}

const ctx = (callerOwner = 'alice'): AppRefCtx => ({ storage: storeOf(), callerOwner, nodeId: 'node-x' });

async function run(tool: string, input: Record<string, unknown>, callerOwner = 'alice') {
  await normalizeAppRefInput(tool, input, ctx(callerOwner));
  return input;
}

describe('the shapes', () => {
  it('owner/filename resolves for the owner it names, and only then', async () => {
    expect(await refOwnerFilename(ctx(), 'alice/shop')).toBe('alice/shop.html');
    expect(await refOwnerFilename(ctx(), 'bob/shop')).toBe('bob/shop.html');
    expect(await refOwnerFilename(ctx(), 'carol/shop')).toBe('carol/shop');
    expect(await refOwnerFilename(ctx(), 'eco:shop')).toBe('eco:shop');
    expect(await refOwnerFilename(ctx(), 'shop')).toBe('shop');
  });
  it('app:owner/filename keeps its prefix', async () => {
    expect(await refBinding(ctx(), 'app:alice/club')).toBe('app:alice/club.html');
    expect(await refBinding(ctx(), 'claude#alice@node-x')).toBe('claude#alice@node-x');
  });
  it('object keys keep a #suffix and the values', async () => {
    expect(await refOwnerFilenameKeys(ctx(), { 'alice/shop#writer': 'p1', 'alice/none': 'p2' }))
      .toEqual({ 'alice/shop.html#writer': 'p1', 'alice/none': 'p2' });
  });
});

describe('the table', () => {
  it('a filename with an owner field reads that owner, else the caller', async () => {
    expect((await run('aimeat_app_get', { owner: 'bob', filename: 'shop' })).filename).toBe('shop.html');
    expect((await run('aimeat_app_delete', { filename: 'club' })).filename).toBe('club.html');
    expect((await run('aimeat_app_delete', { filename: 'club' }, 'bob')).filename).toBe('club');
  });
  it('an exact filename wins over a same-named .html app', async () => {
    expect((await run('aimeat_app_manage', { action: 'settings_get', filename: 'twin' })).filename).toBe('twin');
  });
  it('a new draft name gets .html, an existing one resolves', async () => {
    expect((await run('aimeat_app_draft_save', { filename: 'fresh' })).filename).toBe('fresh.html');
    expect((await run('aimeat_app_draft_save', { filename: 'shop' })).filename).toBe('shop.html');
    expect((await run('aimeat_app_draft_seed', { filename: 'fresh', from_filename: 'shop' })))
      .toMatchObject({ filename: 'fresh.html', from_filename: 'shop.html' });
    expect((await run('aimeat_app_fork', { owner: 'bob', filename: 'shop', new_filename: 'mine' })))
      .toMatchObject({ filename: 'shop.html', new_filename: 'mine.html' });
  });
  it('lists, nested objects and keyed maps', async () => {
    expect((await run('aimeat_package_compose', { apps: ['shop', 'club.html', 'none'] })).apps).toEqual(['shop.html', 'club.html', 'none']);
    const set = await run('aimeat_package_compose_set', { apps: ['shop'], defaults: { shop: { a: 1 } } });
    expect(set).toMatchObject({ apps: ['shop.html'], defaults: { 'shop.html': { a: 1 } } });
    expect((await run('aimeat_workspace_update', { apps: [{ owner: 'bob', filename: 'shop' }] })).apps)
      .toEqual([{ owner: 'bob', filename: 'shop.html' }]);
    const policy = await run('aimeat_ai_policy_set', { policy: { apps: { 'alice/shop': { mode: 'x' } } } });
    expect((policy.policy as { apps: object }).apps).toEqual({ 'alice/shop.html': { mode: 'x' } });
    const rules = await run('aimeat_ai_gen_rules_set', { gen_rules: { exceptions: [{ app: 'alice/club' }, { app: 'eco:club' }] } });
    expect((rules.gen_rules as { exceptions: unknown[] }).exceptions).toEqual([{ app: 'alice/club.html' }, { app: 'eco:club' }]);
    expect((await run('aimeat_ai_role_set', { bindings: { 'alice/club#w': 'm' } })).bindings).toEqual({ 'alice/club.html#w': 'm' });
    expect((await run('aimeat_designbook_propose', { part: { app: { filename: 'club' }, from_app: 'shop' } })).part)
      .toEqual({ app: { filename: 'club.html' }, from_app: 'shop.html' });
  });
  it('the access request resolves only an app, and the overview focus keeps its kind', async () => {
    expect((await run('aimeat_access_request', { kind: 'app', ref: 'bob/shop' })).ref).toBe('bob/shop.html');
    expect((await run('aimeat_access_request', { kind: 'workspace', ref: 'bob/shop' })).ref).toBe('bob/shop');
    expect((await run('aimeat_overview', { focus: 'tools:club' })).focus).toBe('tools:club.html');
    expect((await run('aimeat_overview', { focus: 'agent:club' })).focus).toBe('agent:club');
  });
  it('a grantee resolves on set and on revoke', async () => {
    expect((await run('aimeat_mcp_grant_set', { grantee: 'app:alice/club' })).grantee).toBe('app:alice/club.html');
    expect((await run('aimeat_mcp_grant_revoke', { grantee: 'app:alice/club' })).grantee).toBe('app:alice/club.html');
  });
  it('a tool with no row is left alone, and a failing lookup leaves the input as sent', async () => {
    expect(await run('aimeat_memory_read', { key: 'shop' })).toEqual({ key: 'shop' });
    const broken: AppRefCtx = { ...ctx(), storage: { async appFilenamesAmong() { throw new Error('db down'); }, async getMemory() { return null; } } as unknown as AppRefCtx['storage'] };
    const input = { filename: 'club' };
    await normalizeAppRefInput('aimeat_app_delete', input, broken);
    expect(input.filename).toBe('club');
  });
  it('every row names a tool the catalogue knows', async () => {
    const { getAimeatToolDefinition } = await import('../../src/tool-catalog/definitions.js');
    expect(Object.keys(APP_REF_INPUTS).filter(t => !getAimeatToolDefinition(t))).toEqual([]);
  });
});

describe('withAppRefInput', () => {
  const deps = { storage: storeOf() as unknown as Storage, config: { nodeId: 'node-x' } as AimeatConfig };

  it('rewrites a table tool\'s input before the handler reads it', async () => {
    let seen: unknown;
    const register = (_name: unknown, _cfg: unknown, handler: (i: unknown) => unknown) => handler;
    const registered = withAppRefInput(register as never, () => 'claude#alice@node-x', deps)(
      'aimeat_app_get', {}, (input: unknown) => { seen = input; return 'ok'; },
    ) as (i: unknown) => Promise<unknown>;
    await registered({ owner: 'alice', filename: 'shop' });
    expect(seen).toEqual({ owner: 'alice', filename: 'shop.html' });
  });
  it('leaves a tool without a row registered as it was', () => {
    const handler = () => 'ok';
    const register = (_n: unknown, _c: unknown, h: unknown) => h;
    expect(withAppRefInput(register as never, () => 'alice@node-x', deps)('aimeat_memory_read', {}, handler)).toBe(handler);
  });
});
