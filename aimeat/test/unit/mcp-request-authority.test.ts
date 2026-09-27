/**
 * @file test/unit/mcp-request-authority.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP credential binding and concurrent request isolation (A01/A02).
 * @version-history
 *   v1.0.0 -- 2026-09-27 -- Principal, delegation, live list and asynchronous scope tests.
 */
import { describe, expect, it } from 'vitest';
import type { VerifiedToken } from '../../src/auth/jwt.js';
import { mcpRequestAuthority, sameMcpPrincipal, withRequestPermission } from '../../src/mcp/request-authority.js';

const principal: VerifiedToken = {
  sub: 'agent#alice@test', owner: 'alice', node: 'test', roles: ['agent'],
  scopes: ['memory:read'], exp: 1000,
};

describe('MCP request authority', () => {
  it('accepts refreshed credentials but refuses a different principal or delegation', () => {
    expect(sameMcpPrincipal(principal, { ...principal, exp: 2000, sessionId: 'fresh', scopes: [] })).toBe(true);
    for (const change of [
      { sub: 'sibling#alice@test' }, { owner: 'bob' }, { node: 'other' },
      { roles: ['app'] }, { app_grant: 'different-grant' }, { app: 'other/app' },
      { eco_app: 'other' }, { homeNode: 'other' }, { federated: true }, { anonymous: true },
    ]) expect(sameMcpPrincipal(principal, { ...principal, ...change })).toBe(false);
  });

  it('does not bind the operator role that the owner may revoke', () => {
    expect(sameMcpPrincipal({ ...principal, roles: ['agent', 'operator'] }, principal)).toBe(true);
  });

  it('compares exact token subjects even when two spellings could resolve to the same owner', () => {
    const owner = { ...principal, sub: 'alice', roles: ['owner'] };
    expect(sameMcpPrincipal(owner, { ...owner, exp: 2000 })).toBe(true);
    expect(sameMcpPrincipal(owner, { ...owner, sub: 'alice@test' })).toBe(false);
  });

  it('keeps each concurrent callback on its own token and scope snapshot after awaiting', async () => {
    const authority = mcpRequestAuthority();
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const narrow = authority.run('narrow', principal, async () => {
      await barrier;
      expect(authority.token()).toBe('narrow');
      expect([...authority.scopes]).toEqual(['memory:read']);
      expect(authority.scopes.includes('memory:write')).toBe(false);
    });
    await authority.run('broad', { ...principal, scopes: ['memory:read', 'memory:write'] }, async () => {
      release();
      await narrow;
      expect(authority.token()).toBe('broad');
      expect(authority.scopes.includes('memory:write')).toBe(true);
    });
    expect(authority.token()).toBeUndefined();
    expect([...authority.scopes]).toEqual([]);
  });

  it('computes discovery and execution eligibility from each request without sharing mutable enabled state', () => {
    const authority = mcpRequestAuthority();
    const register = withRequestPermission(() => ({ enabled: true }),
      () => authority.scopes.includes('memory:write'));
    const tool = register('write') as { enabled: boolean };
    expect(authority.run('read', principal, () => tool.enabled)).toBe(false);
    expect(authority.run('write', { ...principal, scopes: ['memory:write'] }, () => tool.enabled)).toBe(true);
    expect(tool.enabled).toBe(false);
    tool.enabled = false;
    expect(authority.run('write', { ...principal, scopes: ['memory:write'] }, () => tool.enabled)).toBe(false);
  });

  it('does not let legacy registrations alter the request scope list', () => {
    const authority = mcpRequestAuthority();
    authority.run('read', principal, () => {
      expect(() => { authority.scopes[0] = '*'; }).toThrow('read-only');
      expect(() => authority.scopes.push('*')).toThrow(TypeError);
    });
    expect(principal.scopes).toEqual(['memory:read']);
  });
});
