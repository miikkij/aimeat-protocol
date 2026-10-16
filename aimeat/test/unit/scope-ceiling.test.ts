/**
 * @file test/unit/scope-ceiling.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description exceedsCeiling, the one function behind the operator's scope ceiling
 *   (scopes.max_agent_scopes / AIMEAT_MAX_AGENT_SCOPES and the ecosystem twin AIMEAT_MAX_ECO_SCOPES),
 *   and the agent-profile path that applies it to a proposed scope list (normaliseAgentProfile,
 *   which aimeat_operator_agent_configure calls before it shows the owner a diff).
 *     - A ceiling holding `*` allows everything, `*` included.
 *     - Under any other ceiling, `*` itself is refused, a word is allowed when the ceiling holds it
 *       exactly or by its domain wildcard, and every other word is named in the answer.
 *     - normaliseAgentProfile refuses defaultScopes above the ceiling with INVALID_INPUT and the
 *       words it refused, and passes a list inside it unchanged.
 *
 *   WHY. No test at any level ran exceedsCeiling with a ceiling other than `*`, where it answers on
 *   its first line, so a change that made it return nothing would have passed every suite. The
 *   routes that call it are test/e2e-scope-ceiling.ts.
 * @usage cd aimeat && pnpm exec vitest run test/unit/scope-ceiling.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F03a-01).
 */
import { describe, it, expect } from 'vitest';
import { exceedsCeiling } from '../../src/utils/scope-coverage.js';
import { normaliseAgentProfile } from '../../src/services/agent-profile-write.js';
import type { AimeatConfig } from '../../src/config.js';

describe('exceedsCeiling', () => {
    it('a ceiling holding * allows every request, * included', () => {
        expect(exceedsCeiling(['*'], ['*'])).toEqual([]);
        expect(exceedsCeiling(['*'], ['storage:write', 'operator:admin', 'memory:read'])).toEqual([]);
        expect(exceedsCeiling(['memory:read', '*'], ['agent:write'])).toEqual([]);
    });

    it('under a capped ceiling, a request for * is refused', () => {
        expect(exceedsCeiling(['memory:*'], ['*'])).toEqual(['*']);
        expect(exceedsCeiling(['memory:*', 'catalogue:read'], ['memory:read', '*'])).toEqual(['*']);
    });

    it('a domain wildcard in the ceiling allows every word of that domain and no other', () => {
        expect(exceedsCeiling(['memory:*'], ['memory:read', 'memory:write', 'memory:delete'])).toEqual([]);
        expect(exceedsCeiling(['memory:*'], ['memory:read', 'storage:read'])).toEqual(['storage:read']);
        expect(exceedsCeiling(['memory:*'], ['memorybank:read'])).toEqual(['memorybank:read']);
    });

    it('an exact word in the ceiling allows that word and not its siblings', () => {
        expect(exceedsCeiling(['catalogue:read'], ['catalogue:read'])).toEqual([]);
        expect(exceedsCeiling(['catalogue:read'], ['catalogue:write'])).toEqual(['catalogue:write']);
    });

    it('a domain wildcard in the REQUEST is allowed only when the ceiling holds that wildcard', () => {
        expect(exceedsCeiling(['memory:*'], ['memory:*'])).toEqual([]);
        expect(exceedsCeiling(['memory:read', 'memory:write'], ['memory:*'])).toEqual(['memory:*']);
    });

    it('names every refused word, in request order', () => {
        expect(exceedsCeiling(['memory:read'], ['storage:write', 'memory:read', 'agent:write', '*']))
            .toEqual(['storage:write', 'agent:write', '*']);
    });

    it('an empty request exceeds nothing', () => {
        expect(exceedsCeiling(['memory:read'], [])).toEqual([]);
    });
});

describe('normaliseAgentProfile applies the ceiling to defaultScopes', () => {
    const capped = { maxAgentScopes: ['memory:*', 'catalogue:read'] } as unknown as AimeatConfig;
    const open = { maxAgentScopes: ['*'] } as unknown as AimeatConfig;

    it('refuses a list above the ceiling with INVALID_INPUT naming the words', () => {
        const r = normaliseAgentProfile(capped, { defaultScopes: ['memory:read', 'storage:write', '*'] });
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.code).toBe('INVALID_INPUT');
            expect(r.message).toContain('storage:write');
            expect(r.message).toContain('*');
            expect(r.message).not.toContain('memory:read');
        }
    });

    it('passes a list inside the ceiling unchanged', () => {
        const r = normaliseAgentProfile(capped, { defaultScopes: ['memory:read', 'catalogue:read'] });
        expect(r).toEqual({ ok: true, updates: { defaultScopes: ['memory:read', 'catalogue:read'] } });
    });

    it('under an open ceiling the same list passes', () => {
        const r = normaliseAgentProfile(open, { defaultScopes: ['storage:write', '*'] });
        expect(r.ok).toBe(true);
    });
});
