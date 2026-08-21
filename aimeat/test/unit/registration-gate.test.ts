/**
 * @file registration-gate.test.ts
 * @description Who may get a NEW account on this node, in two parts that only make sense together:
 *   the registration-mode rule table (services/owner-provisioning.ts) and the Entra tenant gate
 *   (services/oidc-providers.ts). The organisation-node setting is both at once — mode `oauth` so
 *   nobody registers a password themselves, plus a tenant allowlist so only the approved
 *   organisations' people can sign in. A hole in either half opens the node to everyone, so both
 *   are asserted as refusals rather than as happy paths.
 * @version-history
 *   v1.0.0 — 2026-08-21 — Initial: the four-mode rule table incl. `oauth`, and the tenant gate's
 *     allowlist / single-GUID / ungated / malformed-entry behaviour.
 */

import { describe, it, expect } from 'vitest';
import { registrationRefusal, type RegistrationVia } from '../../src/services/owner-provisioning.js';
import { entraTenantGate, makeEntraMapper, makeEntraValidator } from '../../src/services/oidc-providers.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const TENANT_OTHER = '99999999-9999-9999-9999-999999999999';

const withMode = (mode: AimeatConfig['registrationMode']): AimeatConfig =>
  ({ ...loadConfig().config, registrationMode: mode });

const VIAS: RegistrationVia[] = ['direct', 'oauth', 'invitation'];

/** true = this mode lets an account arrive this way. */
const EXPECTED: Record<AimeatConfig['registrationMode'], Record<RegistrationVia, boolean>> = {
  open: { direct: true, oauth: true, invitation: true },
  oauth: { direct: false, oauth: true, invitation: true },
  invite: { direct: false, oauth: false, invitation: true },
  closed: { direct: false, oauth: false, invitation: false },
};

describe('Registration-mode rule table', () => {
  for (const mode of Object.keys(EXPECTED) as Array<AimeatConfig['registrationMode']>) {
    for (const via of VIAS) {
      const allowed = EXPECTED[mode][via];
      it(`${mode} ${allowed ? 'admits' : 'refuses'} an account arriving via ${via}`, () => {
        const refusal = registrationRefusal(withMode(mode), via);
        expect(refusal === null).toBe(allowed);
        if (!allowed) expect(refusal!.length).toBeGreaterThan(0);
      });
    }
  }

  it('oauth mode says what IS available, not only what is refused', () => {
    const refusal = registrationRefusal(withMode('oauth'), 'direct')!;
    expect(refusal).toMatch(/sign(ing)? in/i);
    expect(refusal).toMatch(/invitation/i);
  });
});

describe('Entra tenant gate', () => {
  it('an allowlist admits every organisation on it and refuses every other tenant', () => {
    const validate = makeEntraValidator('organizations', [TENANT_A, TENANT_B])!;
    expect(validate).toBeTypeOf('function');
    expect(validate({ tid: TENANT_A })).toBeNull();
    expect(validate({ tid: TENANT_B })).toBeNull();
    expect(validate({ tid: TENANT_OTHER })).toBe('ENTRA_WRONG_TENANT');
  });

  it('a token with no tid claim at all is refused, not admitted by default', () => {
    const validate = makeEntraValidator('organizations', [TENANT_A])!;
    expect(validate({})).toBe('ENTRA_WRONG_TENANT');
    expect(validate({ tid: '' })).toBe('ENTRA_WRONG_TENANT');
  });

  it('tenant GUIDs match case-insensitively (Entra emits them lowercase, an operator may not)', () => {
    const validate = makeEntraValidator('organizations', [TENANT_A.toUpperCase()])!;
    expect(validate({ tid: TENANT_A })).toBeNull();
    expect(validate({ tid: TENANT_A.toUpperCase() })).toBeNull();
  });

  it('the allowlist wins over a pinned tenant that is not on it', () => {
    const validate = makeEntraValidator(TENANT_A, [TENANT_B])!;
    expect(validate({ tid: TENANT_B })).toBeNull();
    expect(validate({ tid: TENANT_A })).toBe('ENTRA_WRONG_TENANT');
  });

  it('no allowlist: a pinned GUID still admits exactly that one tenant', () => {
    const validate = makeEntraValidator(TENANT_A)!;
    expect(validate({ tid: TENANT_A })).toBeNull();
    expect(validate({ tid: TENANT_B })).toBe('ENTRA_WRONG_TENANT');
  });

  it('no allowlist and a word authority: nothing is gated, which is the widest setting', () => {
    expect(entraTenantGate('common')).toBeNull();
    expect(entraTenantGate('organizations')).toBeNull();
    expect(makeEntraValidator('common')).toBeUndefined();
  });

  it('a malformed allowlist entry refuses that organisation instead of un-gating the node', () => {
    // Fail-closed: 'innokas.fi' can never equal a tid, so it admits nobody. The failure this
    // guards is dropping the bad entry and falling back to an ungated `organizations` authority,
    // which would let every Microsoft account in the world sign in.
    const validate = makeEntraValidator('organizations', ['innokas.fi'])!;
    expect(validate).toBeTypeOf('function');
    expect(validate({ tid: TENANT_A })).toBe('ENTRA_WRONG_TENANT');
  });
});

describe('Entra claim mapping under the gate', () => {
  const claims = { sub: 'ent-1', tid: TENANT_A, preferred_username: 'alice@corp.example', name: 'Alice' };

  it('a gated sign-in vouches for the email, so an invited account links on first sign-in', () => {
    expect(makeEntraMapper('organizations', [TENANT_A, TENANT_B])(claims)!.emailVerified).toBe(true);
    expect(makeEntraMapper(TENANT_A)(claims)!.emailVerified).toBe(true);
  });

  it('an ungated sign-in does not vouch for the email', () => {
    expect(makeEntraMapper('organizations')(claims)!.emailVerified).toBe(false);
    expect(makeEntraMapper('common')(claims)!.emailVerified).toBe(false);
  });

  it('the email falls back to preferred_username / upn, and a subject-less token maps to nothing', () => {
    const mapper = makeEntraMapper('organizations', [TENANT_A]);
    expect(mapper(claims)!.email).toBe('alice@corp.example');
    expect(mapper({ sub: 'ent-2', tid: TENANT_A, upn: 'bob@corp.example' })!.email).toBe('bob@corp.example');
    expect(mapper({ tid: TENANT_A, email: 'nosub@corp.example' })).toBeNull();
  });
});
