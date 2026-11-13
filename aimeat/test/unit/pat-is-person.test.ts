/**
 * @file test/unit/pat-is-person.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An owner-level personal access token is the person (Jouni, 2026-11-04: "ihmiseksi").
 *   isOwnerInPerson (utils/gaii.ts) already let it pass every requireScope as the person, while
 *   readerKindOf (services/classification/reader-kind.ts) called the same token an AI, so the
 *   PERSON_REQUIRED checks refused it a setting the person may loosen (codebase analysis 2026-11-03,
 *   security-architecture finding 1). The two answers now agree for every credential shape: an
 *   owner-level PAT (and the JWT exchanged from one) is the person; a PAT narrower than owner level
 *   (role agent), an agent token, an ecosystem app and an unattended run stay an AI; an app grant
 *   stays the person's screen for reading and is not the account holder in person.
 * @usage cd aimeat && pnpm exec vitest run test/unit/pat-is-person.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-04 -- Initial (codebase analysis 2026-11-03, PAT ruling).
 */
import { describe, it, expect } from 'vitest';
import { readerKindOf } from '../../src/services/classification/reader-kind.js';
import { isOwnerInPerson } from '../../src/utils/gaii.js';
import { signInPolicyChangeRefusal, TWO_STEP_REQUIRED_PATH, PASSWORD_SIGN_IN_PATH } from '../../src/services/sign-in-policy.js';
import { capabilityUseApprovalChangeRefusal } from '../../src/services/mcp-client/capability-use-setting.js';
import { resetNodeSettingRefusal } from '../../src/services/config/admin-view.js';

const ownerPat = { roles: ['owner'], scopes: [], via: 'pat' };
const operatorPat = { roles: ['owner', 'operator'], scopes: [], via: 'pat' };
const narrowPat = { roles: ['agent'], scopes: ['memory:read'], via: 'pat' };
const agent = { roles: ['agent'], scopes: ['operator:admin'] };
const operatorAgent = { roles: ['agent', 'operator'], scopes: ['operator:admin'] };
const person = { roles: ['owner', 'operator'] };

describe('readerKindOf answers as isOwnerInPerson does for a PAT', () => {
  it('an owner-level or operator-level PAT is the person', () => {
    for (const pat of [ownerPat, operatorPat]) {
      expect(isOwnerInPerson(pat)).toBe(true);
      expect(readerKindOf(pat)).toBe('human');
    }
  });

  it('a PAT narrower than owner level and an agent token stay an AI', () => {
    for (const ai of [narrowPat, agent, operatorAgent]) {
      expect(isOwnerInPerson(ai)).toBe(false);
      expect(readerKindOf(ai)).toBe('ai');
    }
  });

  it('an ecosystem app and an unattended run stay an AI; an app grant keeps its answer', () => {
    expect(readerKindOf({ roles: ['ecosystem'] })).toBe('ai');
    expect(readerKindOf({ roles: ['operator'] })).toBe('ai');
    expect(readerKindOf({ roles: ['app'] })).toBe('human');
    expect(isOwnerInPerson({ roles: ['owner', 'app'] })).toBe(false);
  });
});

describe('a person-only setting', () => {
  it('an operator-level PAT may loosen it, as the operator in person may', () => {
    expect(signInPolicyChangeRefusal(operatorPat, TWO_STEP_REQUIRED_PATH, 'everyone', 'off')).toBeNull();
    expect(signInPolicyChangeRefusal(operatorPat, PASSWORD_SIGN_IN_PATH, 'off', 'on')).toBeNull();
    expect(capabilityUseApprovalChangeRefusal(operatorPat, 'ask', 'off')).toBeNull();
    expect(resetNodeSettingRefusal(operatorPat, TWO_STEP_REQUIRED_PATH)).toBeNull();
    expect(signInPolicyChangeRefusal(person, TWO_STEP_REQUIRED_PATH, 'everyone', 'off')).toBeNull();
  });

  it('an agent, even one holding operator:admin, and a narrower PAT still may not', () => {
    for (const ai of [agent, operatorAgent, narrowPat]) {
      expect(signInPolicyChangeRefusal(ai, TWO_STEP_REQUIRED_PATH, 'everyone', 'off')?.code).toBe('PERSON_REQUIRED');
      expect(capabilityUseApprovalChangeRefusal(ai, 'ask', 'off')?.code).toBe('PERSON_REQUIRED');
      expect(resetNodeSettingRefusal(ai, TWO_STEP_REQUIRED_PATH)?.code).toBe('PERSON_REQUIRED');
    }
  });
});
