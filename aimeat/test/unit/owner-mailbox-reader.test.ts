/**
 * @file test/unit/owner-mailbox-reader.test.ts
 * @description Who may read an owner's mailbox, as one table. mailboxReaderOf() is the decision behind
 *   the four REST read doors and the two `*_as_owner` MCP tools; the E2E suite
 *   (e2e-dm-read-as-owner) drives the doors, and this pins the cases a single-node E2E run cannot mint,
 *   the federated session first among them.
 * @usage pnpm test -- owner-mailbox-reader
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { mailboxReaderOf, delegateReaderFor } from '../../src/services/owner-mailbox-reads.js';

const NODE = 'aimeat-test-001';
const who = (roles: string[], scopes: string[] = [], extra: { federated?: boolean; sub?: string } = {}) =>
    mailboxReaderOf({ sub: extra.sub ?? 'x', owner: 'alice', roles, scopes, federated: extra.federated }, NODE);

describe('mailboxReaderOf', () => {
    it('admits the owner in person, and an operator session', () => {
        expect(who(['owner'])?.kind).toBe('owner');
        expect(who(['owner', 'operator'])?.kind).toBe('owner');
        expect(who(['owner'])?.ownerGhii).toBe(`alice@${NODE}`);
    });

    it('refuses a federated session, whose owner name belongs to another node', () => {
        expect(who(['owner'], [], { federated: true })).toBeNull();
        expect(who(['owner'], ['messages:read', 'messages:read-as-owner'], { federated: true })).toBeNull();
    });

    it('admits an app on messages:read, and refuses it without', () => {
        expect(who(['app'], ['messages:read'])?.kind).toBe('app');
        expect(who(['app'], ['memory:read'])).toBeNull();
        // The agent word does nothing for an app: an app grant is already the owner's, and its word is messages:read.
        expect(who(['app'], ['messages:read-as-owner'])).toBeNull();
    });

    it('refuses an agent holding only messages:read, which is the agent\'s own mail', () => {
        expect(who(['agent'], ['messages:read', 'messages:send'])).toBeNull();
    });

    it('refuses a * agent and a messages:* agent: the word is outside every wildcard', () => {
        expect(who(['agent'], ['*'])).toBeNull();
        expect(who(['agent'], ['messages:*'])).toBeNull();
    });

    it('admits an agent and an ecosystem app holding the exact word, as a delegate', () => {
        const agent = who(['agent'], ['messages:read-as-owner'], { sub: `readbot#alice@${NODE}` });
        expect(agent?.kind).toBe('delegate');
        expect(agent?.actor).toBe(`readbot#alice@${NODE}`);
        expect(who(['ecosystem'], ['messages:read-as-owner'])?.kind).toBe('delegate');
    });

    it('never lets an acting principal pass as the owner in person by also carrying the owner role', () => {
        expect(who(['agent', 'owner'], ['messages:read'])).toBeNull();
        expect(who(['app', 'owner'], ['memory:read'])).toBeNull();
    });
});

describe('delegateReaderFor', () => {
    it('reads the session GAII\'s own owner\'s mailbox', () => {
        const r = delegateReaderFor(`readbot#alice@${NODE}`, NODE);
        expect(r).toEqual({ kind: 'delegate', ownerGhii: `alice@${NODE}`, ownerName: 'alice', actor: `readbot#alice@${NODE}` });
    });
});
