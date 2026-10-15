/**
 * @file test/unit/consent-account-event.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The consent_granted and consent_revoked account events land on the PERSON's feed,
 *   which is read by the owner's GHII, whichever principal granted the consent. REST resolves an agent
 *   session to the agent's GAII and the MCP tool to the owner's GHII, and the event used to follow
 *   that identity, so a consent an agent granted over REST never reached the owner's feed. The consent
 *   record itself stays filed under the identity the caller resolved to.
 * @usage cd aimeat && pnpm exec vitest run test/unit/consent-account-event.test.ts
 * @version-history
 *   2026-10-15 — Initial (feature-list audit #44).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AimeatConfig } from '../../src/config.js';
import { grantConsent, revokeConsent } from '../../src/services/consent-write.js';

const NODE = 'consent-event-node';
const GHII = `alice@${NODE}`;
const AGENT = `helper#alice@${NODE}`;

describe('consent account events go to the owner GHII (feature-list audit #44)', () => {
    let storage: SqliteStorage;
    const config = { nodeId: NODE, baseUrl: 'http://localhost' } as AimeatConfig;

    beforeEach(() => { storage = new SqliteStorage(':memory:'); });

    it('an agent caller (the REST resolution) files the consent under the agent and the events under the owner', async () => {
        const caller = { ownerGaii: AGENT, scopes: ['consent:manage'], roles: ['agent'] };
        const granted = await grantConsent({ storage, config }, caller, {
            recipient: '*', dataPattern: 'notes.*', purpose: 'test', scope: 'local',
        });
        expect(granted.ok).toBe(true);
        if (!granted.ok) return;
        expect(granted.value.ownerGaii).toBe(AGENT);

        const revoked = await revokeConsent({ storage, config }, caller, granted.value.id);
        expect(revoked.ok).toBe(true);
        await new Promise(r => setTimeout(r, 20));

        const feed = await storage.listAccountEvents({ ownerGhii: GHII, limit: 50 });
        expect(feed.map(e => e.kind).sort()).toEqual(['consent_granted', 'consent_revoked']);
        expect(feed.every(e => e.actorGaii === AGENT)).toBe(true);
        expect(await storage.listAccountEvents({ ownerGhii: AGENT, limit: 50 })).toEqual([]);
    });

    it('an owner caller (the MCP resolution) files both under the owner GHII', async () => {
        const caller = { ownerGaii: GHII, scopes: [], roles: ['owner'] };
        const granted = await grantConsent({ storage, config }, caller, {
            recipient: '*', dataPattern: 'notes.*', purpose: 'test', scope: 'local',
        });
        expect(granted.ok && granted.value.ownerGaii).toBe(GHII);
        await new Promise(r => setTimeout(r, 20));
        const feed = await storage.listAccountEvents({ ownerGhii: GHII, limit: 50 });
        expect(feed.map(e => e.kind)).toEqual(['consent_granted']);
    });
});
