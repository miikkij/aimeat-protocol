/**
 * @file test/unit/organism-approvals-section.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description public/views/profile/organisms/approvals-section.js: which reader gets the approve
 *   and reject buttons on an approval's row. The server refuses a decision the role does not allow
 *   (routes/organisms/gates.ts); the page must offer the buttons to exactly the readers it admits,
 *   so nobody presses one that only answers 403 and nobody who decides is left without one.
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { decides } from '../../public/views/profile/organisms/approvals-section.js';

const owner = { ghii: 'alice', isCreator: true, isAdmin: false };
const admin = { ghii: 'dave', isCreator: false, isAdmin: true };
const member = { ghii: 'bob', isCreator: false, isAdmin: false };
const held = (approverRole: string) => ({ action: 'external-release', actor: 'bob@node-test', approverRole });

describe('decides', () => {
    it('an approval for the owner is the owner\'s alone', () => {
        expect(decides(held('owner'), owner).may).toBe(true);
        expect(decides(held('owner'), admin).may).toBe(false);
        expect(decides(held('owner'), member).may).toBe(false);
    });

    it('an approval for an admin is an owner\'s and an admin\'s', () => {
        expect(decides(held('admin'), owner).may).toBe(true);
        expect(decides(held('admin'), admin).may).toBe(true);
        expect(decides(held('admin'), member).may).toBe(false);
    });

    it('an approval for a member is any member\'s', () => {
        for (const reader of [owner, admin, member]) expect(decides(held('member'), reader).may).toBe(true);
    });

    it('an approval with no approver role is read as the owner\'s, the server\'s default', () => {
        expect(decides({ action: 'spend' }, owner).may).toBe(true);
        expect(decides({ action: 'spend' }, admin).may).toBe(false);
    });

    it("a member's suggested workspace change is an owner's or an admin's, and never its author's", () => {
        const suggestion = (actor: string) => ({ action: 'workspace.space.add', actor, approverRole: 'member' });
        expect(decides(suggestion('bob@node-test'), owner).may).toBe(true);
        expect(decides(suggestion('bob@node-test'), admin).may).toBe(true);
        expect(decides(suggestion('carol@node-test'), member).may).toBe(false);
        // The author, whatever their role, and also when their agent filed it.
        expect(decides(suggestion('dave@node-test'), admin).may).toBe(false);
        expect(decides({ action: 'workspace.sections.change', actor: 'helper#alice@node-test' }, owner).may).toBe(false);
    });

    it('says who decides when the reader does not', () => {
        expect(typeof decides(held('owner'), member).why).toBe('string');
        expect(decides(held('member'), member).why).toBeUndefined();
    });
});
