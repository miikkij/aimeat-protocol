/**
 * @file test/unit/check-posture-defaults.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Invariants 8 and 10 as a check (scripts/check-posture-defaults.ts), shown to refuse
 *   each breach it reads, and the start-up self-check shown to report the knobs it now covers.
 *
 *   Fail-first: the .env.example line this commit corrected ("(default: operator)" for
 *   AIMEAT_EXT_INSTALL_ROLE, where the code default is owner) is one of the fixtures below and is
 *   refused, and before src/config-posture.ts named them the real tree had unwarned findings for
 *   the extension install role, the admin setup setting and the AI provider allowlist
 *   (QA audit S10-05, S1-08, F7d-05).
 * @version-history
 *   2026-10-16 — Invariant 8 as ruled by the developer: memory:delete may be a default (no inv8
 *     finding, no start-up warning for the shipped list); memory:purge and agent:delete are refused.
 *   2026-10-16 — Initial (QA audit S10-05, S10-09, S1-08, F7d-05).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWED, envExampleFacts, postureFindings, postureKnobs, resolvedPublicDefaults } from '../../scripts/check-posture-defaults.js';
import { POWERFUL_AGENT_SCOPES, securityPostureWarnings } from '../../src/config-posture.js';
import { SHIPPED_DEFAULT_AGENT_SCOPES } from '../../src/config.js';
import type { AimeatConfig } from '../../src/config-types.js';

const AIMEAT = fileURLToPath(new URL('../..', import.meta.url));
const knobs = postureKnobs(POWERFUL_AGENT_SCOPES);
let publicConfig: AimeatConfig;
beforeAll(async () => { publicConfig = await resolvedPublicDefaults(); });

const keys = (envExample: string, warnings = securityPostureWarnings(publicConfig), shippedScopes = SHIPPED_DEFAULT_AGENT_SCOPES) =>
    postureFindings({ knobs, envExample, publicConfig, warnings, shippedScopes, powerful: POWERFUL_AGENT_SCOPES }).map(f => f.key);

describe('the posture-defaults check on the real tree', () => {
    it('finds nothing outside its ALLOWED list', () => {
        const real = keys(readFileSync(join(AIMEAT, '.env.example'), 'utf8'));
        expect(real.filter(k => ALLOWED[k] === undefined)).toEqual([]);
    });
});

describe('invariant 10: .env.example, the code default and the self-check', () => {
    it('refuses an uncommented unsafe value in the example', () => {
        expect(keys('AIMEAT_ANONYMOUS=true\n')).toContain('uncommented-unsafe:AIMEAT_ANONYMOUS');
        expect(keys('AIMEAT_ANONYMOUS=false\n')).not.toContain('uncommented-unsafe:AIMEAT_ANONYMOUS');
    });
    it('refuses a stated default the code does not have (the line this commit corrected)', () => {
        const old = '# AIMEAT_EXT_INSTALL_ROLE=operator     # Role required to install extensions: operator | owner (default: operator)\n';
        expect(keys(old)).toContain('default-mismatch:AIMEAT_EXT_INSTALL_ROLE');
        const now = '# AIMEAT_EXT_INSTALL_ROLE=operator     # Role required to install extensions: operator | owner (default: owner; a public node should set operator)\n';
        expect(keys(now)).not.toContain('default-mismatch:AIMEAT_EXT_INSTALL_ROLE');
    });
    it('refuses an unsafe public default the self-check says nothing about', () => {
        const silent = keys('', []);
        expect(silent).toEqual(expect.arrayContaining([
            'unwarned:AIMEAT_EXT_INSTALL_ROLE', 'unwarned:AIMEAT_AI_PROVIDER_ALLOWLIST', 'unwarned:AIMEAT_CORS_ALLOWED_ORIGINS',
        ]));
        expect(keys('')).not.toContain('unwarned:AIMEAT_EXT_INSTALL_ROLE');
    });
    it('reads a quoted value and a value with a trailing comment', () => {
        const facts = envExampleFacts('AIMEAT_STATS_ACCESS=public          # public | authenticated\nAIMEAT_X="a b"\n', ['AIMEAT_STATS_ACCESS', 'AIMEAT_X']);
        expect(facts.get('AIMEAT_STATS_ACCESS')?.uncommented).toBe('public');
        expect(facts.get('AIMEAT_X')?.uncommented).toBe('a b');
    });
});

describe('invariant 8: the default agent scopes hold no powerful scope', () => {
    it('refuses a powerful scope in the shipped default', () => {
        expect(keys('', undefined, 'memory:read,task:write')).toContain('inv8:task:write');
        expect(keys('', undefined, 'memory:read,catalogue:read')).not.toContain('inv8:task:write');
    });
    it('lets memory:delete be a default, because what it removes goes to the bin (ruled 2026-10-16)', () => {
        expect(keys('', undefined, 'memory:read,memory:write,memory:delete')).not.toContain('inv8:memory:delete');
        expect(keys('', undefined, SHIPPED_DEFAULT_AGENT_SCOPES).filter(k => k.startsWith('inv8:'))).toEqual([]);
    });
    it('refuses the words for what cannot come back: memory:purge and agent:delete', () => {
        expect(keys('', undefined, 'memory:read,memory:purge')).toContain('inv8:memory:purge');
        expect(keys('', undefined, 'memory:read,agent:delete')).toContain('inv8:agent:delete');
    });
    it('says nothing at start-up about the shipped default, and names a purge word an operator adds', () => {
        const at = (scopes: string[]) => securityPostureWarnings({ ...publicConfig, defaultAgentScopes: scopes }).join('\n');
        expect(at(SHIPPED_DEFAULT_AGENT_SCOPES.split(','))).not.toContain('AIMEAT_DEFAULT_AGENT_SCOPES');
        expect(at([...SHIPPED_DEFAULT_AGENT_SCOPES.split(','), 'memory:purge'])).toContain('AIMEAT_DEFAULT_AGENT_SCOPES holds memory:purge');
    });
});

describe('the start-up self-check reports the knobs it now covers', () => {
    const at = (over: Partial<AimeatConfig>) => securityPostureWarnings({ ...publicConfig, ...over }).join('\n');
    it('names test mode and dev mode on a node others can reach, on any profile (QA audit S1-08, P1-01)', () => {
        const local = { securityProfile: 'local' as const, baseUrl: 'http://192.168.1.10:40050' };
        expect(at({ ...local, testMode: true })).toContain('AIMEAT_TEST_MODE=true is ACTIVE');
        expect(at({ ...local, devMode: true })).toContain('AIMEAT_DEV_MODE=true is ACTIVE');
    });
    it('stays quiet about them on a loopback node, where the E2E nodes run', () => {
        const loop = { securityProfile: 'local' as const, baseUrl: 'http://localhost:40050', testMode: true, devMode: true };
        expect(at(loop)).toBe('');
    });
    it('names admin setup left open after the first operator on a public node (QA audit F7d-05)', () => {
        expect(at({ adminSetupOpenAfterFirstOperator: true })).toContain('AIMEAT_ADMIN_SETUP_OPEN_AFTER_FIRST_OPERATOR=true');
        expect(at({ adminSetupOpenAfterFirstOperator: false })).not.toContain('AIMEAT_ADMIN_SETUP_OPEN_AFTER_FIRST_OPERATOR');
    });
});
