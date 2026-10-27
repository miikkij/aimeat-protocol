/**
 * @file test/unit/capability-reach.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who reaches one capability by its id (services/capability-reach.ts): the owner's side
 *   reaches every capability of the owner; everyone else only an 'owner' or 'public' one that was
 *   published. An unknown visibility word or status is closed (secaudit2026oct22).
 * @usage cd aimeat && pnpm exec vitest run test/unit/capability-reach.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-26 — Initial (secaudit2026oct22).
 */
import { describe, it, expect } from 'vitest';
import { capabilityHiddenFrom, capabilityVisibilityRefusal, isCapabilityOwnersSide } from '../../src/services/capability-reach.js';

const NODE = 'node-a';
const cap = (visibility: string, status: string, ownerGhii = `alice@${NODE}`) => ({ ownerGhii, visibility, status }) as never;

describe('capability reach by id', () => {
    it('a draft, a pending review and a rejected capability are closed to another account', () => {
        for (const status of ['draft', 'pending_review', 'rejected', 'something-new']) {
            expect(capabilityHiddenFrom(cap('public', status), `bob@${NODE}`)).toBe(true);
            expect(capabilityHiddenFrom(cap('public', status), null)).toBe(true);
        }
    });

    it('a published owner or public capability is open to everyone, a private or unknown word is not', () => {
        for (const status of ['active', 'deprecated', 'disabled']) {
            expect(capabilityHiddenFrom(cap('public', status), null)).toBe(false);
            expect(capabilityHiddenFrom(cap('owner', status), `bob@${NODE}`)).toBe(false);
            expect(capabilityHiddenFrom(cap('private', status), `bob@${NODE}`)).toBe(true);
            expect(capabilityHiddenFrom(cap('friends', status), `bob@${NODE}`)).toBe(true);
        }
    });

    it('the owner, the owner\'s agent and the owner\'s ecosystem app are the owner\'s side', () => {
        for (const who of [`alice@${NODE}`, `claude#alice@${NODE}`, `eco:drum#alice@${NODE}`]) {
            expect(capabilityHiddenFrom(cap('friends', 'draft'), who)).toBe(false);
        }
        // A capability an agent made is reached by its owner and the owner's other agents.
        expect(isCapabilityOwnersSide({ ownerGhii: `claude#alice@${NODE}` }, `alice@${NODE}`)).toBe(true);
        expect(isCapabilityOwnersSide({ ownerGhii: `claude#alice@${NODE}` }, `gpt#alice@${NODE}`)).toBe(true);
    });

    it('a namesake on another node, and two identities without an owner part, are not the owner\'s side', () => {
        expect(isCapabilityOwnersSide({ ownerGhii: `alice@${NODE}` }, 'alice@node-b')).toBe(false);
        expect(isCapabilityOwnersSide({ ownerGhii: 'alice' }, 'bob')).toBe(false);
        expect(isCapabilityOwnersSide({ ownerGhii: `alice@${NODE}` }, '')).toBe(false);
    });

    it('the visibility words the node knows pass, any other is refused with a sentence that lists them', () => {
        for (const word of ['private', 'owner', 'public']) expect(capabilityVisibilityRefusal(word)).toBeNull();
        for (const word of ['friends', 'group', '', null, 3]) {
            expect(capabilityVisibilityRefusal(word)).toMatch(/Use one of: private, owner, public\./);
        }
    });
});
