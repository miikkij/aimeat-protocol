/**
 * @file compliance-access.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one access decision both compliance doors ask, tested at the decision itself.
 *
 *   THE ZERO-SCOPE AGENT IS THE CASE THIS FILE EXISTS FOR. The first version demanded the scope
 *   word only from callers whose scope list was non-empty, meaning to exempt the operator in
 *   person — and thereby exempted an agent with no granted words at all, which the HTTP door
 *   (requireOperatorPrincipal) refuses. Against that source the first test here fails: the refusal
 *   comes back null and the whole node's report opens to the emptiest possible credential.
 *   Audit AI-triage 2026-08-23, invariant 13.
 * @usage cd aimeat && pnpm exec vitest run test/unit/compliance-access.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial: the four caller shapes, either side of the operator line.
 */
import { describe, it, expect } from 'vitest';
import { complianceRefusal } from '../../src/services/compliance-access.js';
import type { Storage } from '../../src/storage/interface.js';

const SCOPE = 'compliance:read';

/** Only the read complianceRefusal makes: who the account is and whether it runs the node. */
function storageWith(operators: string[]): Storage {
  return {
    getOwner: async (name: string) => ({
      name,
      roles: operators.includes(name) ? ['owner', 'operator'] : ['owner'],
    }),
  } as unknown as Storage;
}

describe('complianceRefusal', () => {
  const storage = storageWith(['opsanna']);

  it('refuses an operator\'s agent that carries NO scopes — an empty grant list is not an exemption', async () => {
    const refusal = await complianceRefusal(storage, { gaii: 'claude#opsanna@aimeat-test-001-unit', scopes: [] }, SCOPE);
    expect(refusal).toMatch(/permission/);
  });

  it('refuses an operator\'s agent whose scopes lack the word, wildcard or not', async () => {
    const refusal = await complianceRefusal(storage, { gaii: 'claude#opsanna@aimeat-test-001-unit', scopes: ['*'] }, SCOPE);
    expect(refusal).toMatch(/permission/);
  });

  it('admits an operator\'s agent that carries the exact word', async () => {
    const refusal = await complianceRefusal(storage, { gaii: 'claude#opsanna@aimeat-test-001-unit', scopes: [SCOPE] }, SCOPE);
    expect(refusal).toBeNull();
  });

  it('admits the operator in person (bare GHII, no scope list)', async () => {
    const refusal = await complianceRefusal(storage, { gaii: 'opsanna@aimeat-test-001-unit' }, SCOPE);
    expect(refusal).toBeNull();
  });

  it('refuses an ecosystem app — it never resolves to an operator account', async () => {
    const refusal = await complianceRefusal(storage, { gaii: 'eco:drum#opsanna@aimeat-test-001-unit', scopes: ['memory:read'] }, SCOPE);
    expect(refusal).not.toBeNull();
  });

  it('refuses anyone whose account does not run the node, before scopes are even looked at', async () => {
    const refusal = await complianceRefusal(storage, { gaii: 'claude#alice@aimeat-test-001-unit', scopes: [SCOPE] }, SCOPE);
    expect(refusal).toMatch(/does not run it/);
  });
});
