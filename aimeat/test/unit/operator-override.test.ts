/**
 * @file test/unit/operator-override.test.ts
 * @description services/operator-override.ts (secaudit 2026-10, C2): the operator check REST routes
 *   ask for another person's thing gives the answer askOperator gives the MCP tools, and writes the
 *   operator trail exactly when it admits.
 * @usage pnpm test -- operator-override
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, C2).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Storage } from '../../src/storage/interface.js';

const recorded: unknown[] = [];
vi.mock('../../src/services/operator-access-audit.js', () => ({
  recordOperatorAction: async (_s: unknown, _c: unknown, act: unknown) => { recorded.push(act); },
}));

const { isOperatorCaller, operatorOverride, rolesWithOperator } = await import('../../src/services/operator-override.js');

const NODE = 'aimeat-local-001-dev';
const config = { nodeId: NODE, accountEventWindow: 100 } as never;
const storage = {
  getOwner: async (name: string) => ({
    opr: { name: 'opr', roles: ['owner', 'operator'] },
    plain: { name: 'plain', roles: ['owner'] },
  } as Record<string, { name: string; roles: string[] }>)[name] ?? null,
} as unknown as Storage;

const inPerson = { sub: `opr@${NODE}`, owner: 'opr', roles: ['owner', 'operator'], scopes: [] };
const opAgent = { sub: `claude#opr@${NODE}`, owner: 'opr', roles: ['agent'], scopes: ['social:write', 'operator:admin'] };
const opAgentNoWord = { sub: `claude#opr@${NODE}`, owner: 'opr', roles: ['agent'], scopes: ['*'] };
const plainOwner = { sub: `plain@${NODE}`, owner: 'plain', roles: ['owner'], scopes: [] };
const visitor = { sub: 'opr@other-node', owner: 'opr', roles: ['federated'], scopes: [], federated: true };

beforeEach(() => { recorded.length = 0; });

describe('isOperatorCaller', () => {
  it('admits the operator in person and the operator\'s agent holding operator:admin', async () => {
    expect(await isOperatorCaller(storage, inPerson)).toBe(true);
    expect(await isOperatorCaller(storage, opAgent)).toBe(true);
  });

  it('refuses the operator\'s agent on a wildcard, another owner, a visitor and an anonymous session', async () => {
    expect(await isOperatorCaller(storage, opAgentNoWord)).toBe(false);
    expect(await isOperatorCaller(storage, plainOwner)).toBe(false);
    expect(await isOperatorCaller(storage, visitor)).toBe(false);
    expect(await isOperatorCaller(storage, { ...inPerson, anonymous: true })).toBe(false);
    expect(await isOperatorCaller(storage, undefined)).toBe(false);
  });
});

describe('rolesWithOperator', () => {
  it('lists operator exactly when isOperatorCaller says yes', async () => {
    expect(await rolesWithOperator(storage, opAgent)).toEqual(['agent', 'operator']);
    expect(await rolesWithOperator(storage, opAgentNoWord)).toEqual(['agent']);
    expect(await rolesWithOperator(storage, { ...plainOwner, roles: ['owner', 'operator'], owner: 'plain' })).toEqual(['owner', 'operator']);
  });
});

describe('operatorOverride', () => {
  it('admits the operator\'s agent and writes the trail in the other person\'s account', async () => {
    expect(await operatorOverride(storage, config, opAgent, { ownerOf: `plain@${NODE}`, area: 'board', action: 'rules', subject: 'b1' })).toBe(true);
    expect(recorded).toEqual([{
      operatorGhii: `opr@${NODE}`, actorGaii: `claude#opr@${NODE}`, ownerOf: `plain@${NODE}`,
      area: 'board', action: 'rules', subject: 'b1',
    }]);
  });

  it('names a bare account name as its GHII', async () => {
    expect(await operatorOverride(storage, config, inPerson, { ownerOf: 'plain', area: 'account', action: 'export' })).toBe(true);
    expect(recorded).toEqual([{ operatorGhii: `opr@${NODE}`, actorGaii: `opr@${NODE}`, ownerOf: `plain@${NODE}`, area: 'account', action: 'export' }]);
  });

  it('refuses without writing anything', async () => {
    for (const who of [opAgentNoWord, plainOwner, visitor]) {
      expect(await operatorOverride(storage, config, who, { ownerOf: `plain@${NODE}`, area: 'board', action: 'delete' })).toBe(false);
    }
    expect(recorded).toEqual([]);
  });
});
