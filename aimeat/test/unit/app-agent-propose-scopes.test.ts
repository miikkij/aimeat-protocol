/**
 * @file test/unit/app-agent-propose-scopes.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The scopes a bundled agent is proposed with: what its definition declares, plus the
 *   crew runtime's own, capped by what the proposer may grant. `*` and the exact-grant scopes never
 *   come from an app.
 * @usage pnpm test -- app-agent-propose-scopes
 * @version-history
 *   v1.1.0 — 2026-10-02 — The runtime's words (memory:read, memory:write) are never left out.
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import { describe, expect, it } from 'vitest';
import { bundledAgentScopes } from '../../src/services/app-agent-propose.js';

const ownerSession = { sub: 'alice', owner: 'alice', roles: ['owner'], scopes: [] };
const agent = (scopes: string[]) => ({ sub: 'concierge#alice@n', owner: 'alice', roles: ['agent'], scopes });
const CADENCE = ['organism:read', 'memory:read', 'memory:write', 'agent:write'];

describe('a bundled agent\'s proposed scopes', () => {
    it('an owner session proposes everything the definition declares, plus the runtime\'s word', () => {
        expect(bundledAgentScopes(['organism:read', 'memory:read'], ownerSession))
            .toEqual({ scopes: ['organism:read', 'memory:read', 'memory:write'], dropped: [] });
        expect(bundledAgentScopes(CADENCE, ownerSession)).toEqual({ scopes: CADENCE, dropped: [] });
    });

    it('an agent proposes only what it holds itself; the rest is named, not refused', () => {
        expect(bundledAgentScopes(CADENCE, agent(['organism:read', 'memory:read', 'memory:write'])))
            .toEqual({ scopes: ['organism:read', 'memory:read', 'memory:write'], dropped: ['agent:write'] });
        expect(bundledAgentScopes(CADENCE, agent(['memory:*', 'organism:*'])))
            .toEqual({ scopes: ['organism:read', 'memory:read', 'memory:write'], dropped: ['agent:write'] });
    });

    it('`*` and an exact-grant scope never come from an app, even for the owner', () => {
        expect(bundledAgentScopes(['memory:read', '*', 'account:security', 'memory:write-reserved'], ownerSession))
            .toEqual({ scopes: ['memory:read', 'memory:write'], dropped: ['*', 'account:security', 'memory:write-reserved'] });
        expect(bundledAgentScopes(['account:security'], agent(['*'])).dropped).toContain('account:security');
    });

    it('nothing declared, or not a list: the runtime\'s words alone, whoever proposes', () => {
        // Never capped: every proposal carries them, or the approved agent cannot read its own
        // definition and never starts (measured on a hosted place, 2026-10-02).
        expect(bundledAgentScopes(undefined, ownerSession)).toEqual({ scopes: ['memory:read', 'memory:write'], dropped: [] });
        expect(bundledAgentScopes('memory:read', ownerSession)).toEqual({ scopes: ['memory:read', 'memory:write'], dropped: [] });
        expect(bundledAgentScopes([], agent([]))).toEqual({ scopes: ['memory:read', 'memory:write'], dropped: [] });
    });

    it('junk entries and repeats are dropped before the cap', () => {
        expect(bundledAgentScopes([' memory:read ', 'memory:read', 7, null, ''], ownerSession))
            .toEqual({ scopes: ['memory:read', 'memory:write'], dropped: [] });
    });
});
