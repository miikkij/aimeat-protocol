/**
 * @file test/unit/place-agent-scopes.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A store place's default for an agent (src/services/place-agent-scopes.ts) and the split of
 *   exchange:invoke out of exchange:write (src/utils/scope-coverage.ts). crew76 gave agents words on the
 *   task start floor, so every scheduled task stayed queued for the owner (guestkoey3wfwk, 2.11); Jouni
 *   chose on 2026-11-02 at 10.25 to leave those out and to split the word.
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { placeAgentScopes } from '../../src/services/place-agent-scopes.js';
import { TASK_START_FLOOR, decideTaskStart, floorScopesOf } from '../../src/services/agent/task-rules.js';
import { intersectScopes } from '../../src/auth/effective-scopes.js';
import { scopeIsCovered } from '../../src/utils/scope-coverage.js';
import type { AimeatConfig } from '../../src/config.js';

const sold = { siteLinks: { purchasePlan: 'Solo' }, maxAgentScopes: ['*'] } as unknown as AimeatConfig;

describe('a store place\'s default', () => {
    const words = placeAgentScopes(sold) ?? [];

    it('holds no word on the task start floor, so an agent with it starts its tasks by itself', () => {
        expect(words.length).toBeGreaterThan(20);
        for (const f of TASK_START_FLOOR) expect(words, f.scope).not.toContain(f.scope);
        expect(floorScopesOf({ defaultScopes: words })).toEqual([]);
        const start = decideTaskStart({ mode: 'task-runner', defaultScopes: words });
        expect(start.startsNow).toBe(true);
    });

    it('carries the word an app tool asks', () => {
        expect(words).toContain('exchange:invoke');
    });

    it('is nothing off a store place', () => {
        expect(placeAgentScopes({ siteLinks: { purchasePlan: '' }, maxAgentScopes: ['*'] } as unknown as AimeatConfig)).toBeNull();
    });

    it('keeps inside the operator\'s ceiling', () => {
        const capped = placeAgentScopes({ siteLinks: { purchasePlan: 'Solo' }, maxAgentScopes: ['memory:read', 'exchange:invoke'] } as unknown as AimeatConfig);
        expect(capped).toEqual(['exchange:invoke', 'memory:read']);
    });
});

describe('exchange:invoke, split out of exchange:write', () => {
    it('is covered by exchange:write, by the wildcard and by the domain wildcard', () => {
        for (const held of [['exchange:write'], ['*'], ['exchange:*'], ['exchange:invoke']]) {
            expect(scopeIsCovered(held, 'exchange:invoke'), held[0]).toBe(true);
        }
    });

    it('does not cover exchange:write: it opens no contract', () => {
        expect(scopeIsCovered(['exchange:invoke'], 'exchange:write')).toBe(false);
    });

    it('is not on the floor; exchange:write is, so an old holder is held exactly as before', () => {
        expect(floorScopesOf({ defaultScopes: ['exchange:invoke'] })).toEqual([]);
        expect(floorScopesOf({ defaultScopes: ['exchange:write'] })).toEqual(['exchange:write']);
    });

    it('at the door a token holding exchange:write and a record narrowed to exchange:invoke leaves exchange:invoke', () => {
        expect(intersectScopes(['exchange:write'], ['exchange:invoke'])).toEqual(['exchange:invoke']);
        expect(intersectScopes(['exchange:write'], ['exchange:write'])).toEqual(['exchange:write']);
        expect(intersectScopes(['exchange:invoke'], ['exchange:write'])).toEqual(['exchange:invoke']);
    });
});
