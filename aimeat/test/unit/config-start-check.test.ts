/**
 * @file test/unit/config-start-check.test.ts
 * @description A setting the node does not accept refuses the start, whichever way it arrives
 *   (environment, command line, config file), and an empty number or fixed-set setting means unset.
 *   Table-driven over every fixed-set row of the schema, so a new row is covered without a new case.
 * @usage pnpm exec vitest run test/unit/config-start-check.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit D8-02, P6-03, D6-02).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { ConfigStartError, START_ONLY_CHOICES, startSettingProblems } from '../../src/config-start-check.js';
import { CONFIG_FIELDS } from '../../src/services/config-schema.js';
import { createStorage } from '../../src/storage/storage-factory.js';

let saved: NodeJS.ProcessEnv;
beforeEach(() => { saved = { ...process.env }; });
afterEach(() => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
});

/** loadConfig with one variable set; returns the thrown error or the config. */
function loadWith(variable: string, value: string): { error?: unknown; config?: ReturnType<typeof loadConfig>['config'] } {
    process.env[variable] = value;
    try { return { config: loadConfig().config }; } catch (error) { return { error }; }
}

describe('loadConfig refuses a setting the node does not accept', () => {
    const fixedSetRows = CONFIG_FIELDS.filter(f => f.choices && f.choices.length > 0);

    it('covers the settings the audit named', () => {
        const vars = new Set([...fixedSetRows.map(f => f.envVar), ...Object.keys(START_ONLY_CHOICES)]);
        for (const v of ['AIMEAT_METRICS_ACCESS', 'AIMEAT_STATS_ACCESS', 'AIMEAT_CAPABILITY_PUBLISHING', 'AIMEAT_CAPABILITY_WEBHOOKS',
            'AIMEAT_PACKAGE_CREATE_ROLE', 'AIMEAT_FEDERATION_AUTH_POLICY', 'AIMEAT_REGISTRATION_MODE']) {
            expect(vars.has(v), v).toBe(true);
        }
    });

    it.each(fixedSetRows.map(f => [f.envVar, f.choices![0]]))('%s: a word outside its list stops the start', (variable, valid) => {
        const bad = loadWith(variable, `${valid}-typo`);
        expect(bad.error).toBeInstanceOf(ConfigStartError);
        expect((bad.error as ConfigStartError).problems.map(p => p.variable)).toEqual([variable]);
        expect(String((bad.error as Error).message)).toContain(variable);
    });

    it.each(Object.entries(START_ONLY_CHOICES))('%s: a word outside its list stops the start', (variable, choices) => {
        expect(loadWith(variable, `${choices[0]}x`).error).toBeInstanceOf(ConfigStartError);
        expect(loadWith(variable, choices[0]).error).toBeUndefined();
    });

    it('a listed word in another case runs as that word, never as the open branch', () => {
        const { config, error } = loadWith('AIMEAT_METRICS_ACCESS', ' Operator ');
        expect(error).toBeUndefined();
        expect(config!.metricsAccess).toBe('operator');
        expect(process.env.AIMEAT_METRICS_ACCESS).toBe('operator');
        const pub = loadWith('AIMEAT_CAPABILITY_PUBLISHING', 'Disabled');
        expect(pub.config!.capabilityPublishing).toBe('disabled');
    });

    it('the examples from the audit stop the start', () => {
        expect(loadWith('AIMEAT_REGISTRATION_MODE', 'invite-only').error).toBeInstanceOf(ConfigStartError);
        delete process.env.AIMEAT_REGISTRATION_MODE;
        expect(loadWith('AIMEAT_PASSWORD_LOCKOUT_ATTEMPTS', 'five').error).toBeInstanceOf(ConfigStartError);
    });

    it('an unknown storage value stops the start, and the known ones and their aliases do not', () => {
        const bad = loadWith('AIMEAT_STORAGE', 'postgres_kysely');
        expect(bad.error).toBeInstanceOf(ConfigStartError);
        expect((bad.error as Error).message).toContain('postgres-kysely');
        for (const ok of ['postgres-kysely', 'postgres', 'postgresql', 'sqlite', 'memory']) {
            expect(loadWith('AIMEAT_STORAGE', ok).error, ok).toBeUndefined();
        }
        expect(loadWith('AIMEAT_STORAGE', 'mongodb').error).toBeInstanceOf(ConfigStartError);
    });

    it('a command-line --db value is checked the same way', () => {
        let thrown: unknown;
        try { loadConfig({ cliOverrides: { 'storage.type': 'sqllite' } }); } catch (e) { thrown = e; }
        expect(thrown).toBeInstanceOf(ConfigStartError);
    });

    it('every node type the loader runs is accepted', () => {
        for (const t of ['full', 'relay', 'mirror', 'personal']) expect(loadWith('AIMEAT_NODE_TYPE', t).error, t).toBeUndefined();
    });

    it('reports every problem at once', () => {
        const problems = startSettingProblems({ AIMEAT_METRICS_ACCESS: 'x', AIMEAT_STORAGE: 'y', AIMEAT_PORT: 'z' });
        expect(problems.map(p => p.variable).sort()).toEqual(['AIMEAT_METRICS_ACCESS', 'AIMEAT_PORT', 'AIMEAT_STORAGE']);
    });

    it('checkSettings: false loads a broken environment, for validate, init and config', () => {
        process.env.AIMEAT_METRICS_ACCESS = 'Operator';
        expect(() => loadConfig({ checkSettings: false })).not.toThrow();
    });
});

describe('an empty number or fixed-set setting means unset', () => {
    it('an empty lockout count is the default 5, not NaN', () => {
        const { config, error } = loadWith('AIMEAT_PASSWORD_LOCKOUT_ATTEMPTS', '');
        expect(error).toBeUndefined();
        expect(config!.passwordLockoutAttempts).toBe(5);
    });

    it('an empty metrics access is the default operator, not the open branch', () => {
        const { config, error } = loadWith('AIMEAT_METRICS_ACCESS', '');
        expect(error).toBeUndefined();
        expect(config!.metricsAccess).toBe('operator');
    });

    it('an empty registration mode is the default', () => {
        const { config } = loadWith('AIMEAT_REGISTRATION_MODE', ' ');
        expect(config!.registrationMode).toBe('open');
    });
});

describe('createStorage refuses an unknown provider', () => {
    it('throws instead of opening an in-memory database', async () => {
        await expect(createStorage({ provider: 'postgres-kysley' as never })).rejects.toThrow(/Unknown storage provider/);
    });
});
