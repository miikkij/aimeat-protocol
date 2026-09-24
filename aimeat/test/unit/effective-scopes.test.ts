/**
 * @file test/unit/effective-scopes.test.ts
 * @description What an agent may do when its token and its record disagree.
 *
 *   WHY THIS FILE EXISTS, AND IT IS A CORRECTION OF MY OWN. `withCurrentScopes` (2026-09-06) makes a
 *   removed permission bite immediately by intersecting a token's scopes with the agent record's.
 *   The first version wrote that intersection as `token.filter(s => scopeIsCovered(record, s))`,
 *   which is wrong in one direction and catastrophically so: a token carrying the wildcard `*` is
 *   covered by no concrete list, so an agent whose owner had granted it eight NAMED scopes was
 *   refused all eight. e2e-profile-tabs went from 129/129 to 8 failures and the guard tier did not
 *   notice, because that suite is not in it.
 *
 *   `*` means "everything the record allows". The intersection of everything with a list is the list.
 *   These cases are the ones the shape has to get right, in both directions, and they are cheap
 *   enough that there is no excuse for having reasoned about them instead.
 * @usage cd aimeat && pnpm exec vitest run test/unit/effective-scopes.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-07 — Written with the fix for the regression above.
 *   v1.1.0 — 2026-09-24 — heldScopes: the owner in person holds every word, everybody else what
 *     their token says (secaudit 2026-09 f740ecf9bc39).
 */
import { describe, it, expect } from 'vitest';
import { intersectScopes, heldScopes } from '../../src/auth/effective-scopes.js';
import { SECRETS_MANAGE_SCOPE, MCP_MANAGE_SCOPE, scopeIsCovered } from '../../src/utils/scope-coverage.js';

describe('intersectScopes: a token narrowed to what the record currently allows', () => {
  it('a wildcard token against a named record becomes the record — NOT nothing', () => {
    // The regression. Every one of these was refused.
    expect(intersectScopes(['*'], ['memory:read', 'consent:manage']))
      .toEqual(['memory:read', 'consent:manage']);
  });

  it('a named token against a wildcard record keeps its own names', () => {
    expect(intersectScopes(['memory:read', 'memory:write'], ['*']))
      .toEqual(['memory:read', 'memory:write']);
  });

  it('a scope the record no longer grants is removed, which is the whole point', () => {
    expect(intersectScopes(['memory:read', 'memory:write'], ['memory:read']))
      .toEqual(['memory:read']);
  });

  it('a scope the record grants and the token never had is NOT added', () => {
    // Never a widening. Adding one still needs a fresh credential.
    expect(intersectScopes(['memory:read'], ['memory:read', 'memory:write']))
      .toEqual(['memory:read']);
  });

  it('a domain wildcard in the token collapses to the record entries under it', () => {
    expect(intersectScopes(['memory:*'], ['memory:read', 'work:accept']))
      .toEqual(['memory:read']);
  });

  it('a domain wildcard in the record covers the token scopes under it', () => {
    expect(intersectScopes(['memory:read', 'work:accept'], ['memory:*']))
      .toEqual(['memory:read']);
  });

  it('two identical lists come back unchanged and in order', () => {
    expect(intersectScopes(['a:read', 'b:write'], ['a:read', 'b:write']))
      .toEqual(['a:read', 'b:write']);
  });

  it('an empty record grants nothing, and an empty token asks for nothing', () => {
    expect(intersectScopes(['memory:read'], [])).toEqual([]);
    expect(intersectScopes([], ['memory:read'])).toEqual([]);
  });

  it('a scope only an exact grant confers is not reachable through the token\'s wildcard', () => {
    // The same rule requireScope applies, in the one place that states it. A record naming it and a
    // token that only says `*` means the token never carried it, so it is not conferred here either.
    expect(intersectScopes(['*'], [SECRETS_MANAGE_SCOPE])).toEqual([]);
    // …and an exact grant on both sides keeps it.
    expect(intersectScopes([SECRETS_MANAGE_SCOPE], [SECRETS_MANAGE_SCOPE])).toEqual([SECRETS_MANAGE_SCOPE]);
  });

  it('no duplicates, however the two lists overlap', () => {
    expect(intersectScopes(['*', 'memory:read'], ['memory:read', 'memory:write']))
      .toEqual(['memory:read', 'memory:write']);
  });
});

describe('heldScopes: what a door hands a service that asks the scope question itself', () => {
  it('the owner in person holds every word, the ones no wildcard carries included', () => {
    // Their token carries no scopes at all: requireScope admits them on the role. A service handed
    // only the token's list would refuse the one person every door admits.
    const held = heldScopes({ roles: ['owner'], scopes: [] });
    for (const word of ['mcp:use', 'memory:write', MCP_MANAGE_SCOPE, SECRETS_MANAGE_SCOPE]) {
      expect(scopeIsCovered(held, word), word).toBe(true);
    }
  });

  it('everybody else holds exactly what their token says, whatever else their roles say', () => {
    expect(heldScopes({ roles: ['agent'], scopes: ['work:request'] })).toEqual(['work:request']);
    expect(heldScopes({ roles: ['owner', 'agent'], scopes: ['work:request'] })).toEqual(['work:request']);
    expect(heldScopes({ roles: ['ecosystem'], scopes: [] })).toEqual([]);
    expect(heldScopes({ roles: ['app'], scopes: ['mcp:read'] })).toEqual(['mcp:read']);
    // A visitor from another node is never the account holder in person.
    expect(heldScopes({ roles: ['owner'], scopes: ['memory:read'], federated: true })).toEqual(['memory:read']);
    expect(scopeIsCovered(heldScopes({ roles: ['agent'], scopes: ['work:request'] }), 'mcp:use')).toBe(false);
  });
});
