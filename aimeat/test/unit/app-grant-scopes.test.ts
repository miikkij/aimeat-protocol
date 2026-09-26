/**
 * @file test/unit/app-grant-scopes.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an app grant keeps when the node rewrites its words (services/app-grant-scopes.ts):
 *   a word the owner added by hand stays through a narrowing to the app's declaration and through an
 *   approval that did not list it, and goes when the owner leaves it unticked on a consent screen
 *   that listed it. The HTTP doors are asserted in test/e2e-mail-read-consent.ts and
 *   test/e2e-app-silent.ts Phase 5.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-grant-scopes.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { READ_THROUGH_SCOPE, heldOwnerAdded, narrowToDeclared, afterApproval } from '../../src/services/app-grant-scopes.js';

const USE = 'connections:use';
const grant = { scopes: ['memory:read', USE, READ_THROUGH_SCOPE], ownerAddedScopes: [READ_THROUGH_SCOPE] };

describe('a word the owner added by hand', () => {
  it('counts only while the grant holds it', () => {
    expect(heldOwnerAdded(grant)).toEqual([READ_THROUGH_SCOPE]);
    expect(heldOwnerAdded({ scopes: ['memory:read'], ownerAddedScopes: [READ_THROUGH_SCOPE] })).toEqual([]);
    expect(heldOwnerAdded(null)).toEqual([]);
    expect(heldOwnerAdded({ scopes: [USE] })).toEqual([]);
  });

  it('stays when the grant follows the app\'s declaration down, and nothing else the app dropped does', () => {
    expect(narrowToDeclared(grant.scopes, ['memory:read', USE], heldOwnerAdded(grant))).toEqual(grant.scopes);
    expect(narrowToDeclared(grant.scopes, [USE], heldOwnerAdded(grant))).toEqual([USE, READ_THROUGH_SCOPE]);
    expect(narrowToDeclared(grant.scopes, ['memory:read', USE], [])).toEqual(['memory:read', USE]);
  });

  it('stays through an approval that did not list it: a silent sign-in, or a consent screen about other words', () => {
    expect(afterApproval(['memory:read', USE], grant)).toEqual({ scopes: ['memory:read', USE, READ_THROUGH_SCOPE], ownerAddedScopes: [READ_THROUGH_SCOPE] });
    expect(afterApproval(['memory:read', USE, 'ai:use'], grant, ['memory:read', USE, 'ai:use']).scopes).toContain(READ_THROUGH_SCOPE);
  });

  it('goes when a consent screen listed it and the owner left it unticked, and stays when they ticked it', () => {
    expect(afterApproval(['memory:read', USE], grant, ['memory:read', USE, READ_THROUGH_SCOPE])).toEqual({ scopes: ['memory:read', USE], ownerAddedScopes: [] });
    expect(afterApproval([USE, READ_THROUGH_SCOPE], grant, [USE, READ_THROUGH_SCOPE])).toEqual({ scopes: [USE, READ_THROUGH_SCOPE], ownerAddedScopes: [READ_THROUGH_SCOPE] });
  });

  it('is never made up: an approval over a grant without one adds nothing', () => {
    expect(afterApproval(['memory:read'], { scopes: ['memory:read', USE] })).toEqual({ scopes: ['memory:read'], ownerAddedScopes: [] });
    expect(afterApproval(['memory:read'], null)).toEqual({ scopes: ['memory:read'], ownerAddedScopes: [] });
  });
});
