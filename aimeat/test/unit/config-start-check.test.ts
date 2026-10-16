/**
 * @file test/unit/config-start-check.test.ts
 * @description A setting the node does not accept, whichever way it arrives (environment, command
 *   line, config file), is set aside: the node runs the setting's default, logs one line naming the
 *   setting, the value's problem and the default, and returns it for the Security page. Only the
 *   settings in REFUSE_ON_INVALID still refuse the start. An empty number or fixed-set setting means
 *   unset, and a fixed-set word in another case runs as that word. `aimeat validate` names every such
 *   value as an error. Table-driven over every fixed-set row of the schema, so a new row is covered
 *   without a new case.
 * @usage pnpm exec vitest run test/unit/config-start-check.test.ts
 * @version-history
 *   v2.0.0 — 2026-10-16 — The node starts on the default of a setting it does not accept instead of
 *     refusing (Jouni, decision 2026-10-16): the cases that asserted the refusal now assert the default,
 *     the log line and the returned setting; the refusal stays asserted for the storage type, the node
 *     type and the registration mode; `aimeat validate` is asserted to name each value.
 *   v1.0.0 — 2026-10-16 — Initial (QA audit D8-02, P6-03, D6-02).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { ConfigStartError, REFUSE_ON_INVALID, START_ONLY_CHOICES, startSettingProblems } from '../../src/config-start-check.js';
import { CONFIG_FIELDS, readConfigField } from '../../src/services/config-schema.js';
import { createStorage } from '../../src/storage/storage-factory.js';
import { validateEnv } from '../../src/utils/env-validator.js';

let saved: NodeJS.ProcessEnv;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    saved = { ...process.env };
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
    warn.mockRestore();
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
});

type Loaded = ReturnType<typeof loadConfig>;
/** loadConfig with one variable set; returns the thrown error or what it loaded. */
function loadWith(variable: string, value: string): { error?: unknown; loaded?: Loaded } {
    process.env[variable] = value;
    try { return { loaded: loadConfig() }; } catch (error) { return { error }; }
}
/** loadConfig with the variable unset: the default the node uses for it. */
function loadWithout(variable: string): Loaded {
    delete process.env[variable];
    return loadConfig();
}
const warned = () => warn.mock.calls.map(c => String(c[0]));

describe('a setting the node does not accept runs its default', () => {
    const fixedSetRows = CONFIG_FIELDS.filter(f => f.choices && f.choices.length > 0);
    const setAsideRows = fixedSetRows.filter(f => REFUSE_ON_INVALID[f.envVar] === undefined);

    it('covers the settings the audit named', () => {
        const vars = new Set([...fixedSetRows.map(f => f.envVar), ...Object.keys(START_ONLY_CHOICES)]);
        for (const v of ['AIMEAT_METRICS_ACCESS', 'AIMEAT_STATS_ACCESS', 'AIMEAT_CAPABILITY_PUBLISHING', 'AIMEAT_CAPABILITY_WEBHOOKS',
            'AIMEAT_PACKAGE_CREATE_ROLE', 'AIMEAT_FEDERATION_AUTH_POLICY', 'AIMEAT_REGISTRATION_MODE']) {
            expect(vars.has(v), v).toBe(true);
        }
    });

    it.each(setAsideRows.map(f => [f.envVar, f]))('%s: a word outside its list starts on the default, says so and is returned', (variable, field) => {
        const fallback = readConfigField(loadWithout(variable).config, field);
        warn.mockClear();
        const { loaded, error } = loadWith(variable, `${field.choices![0]}-typo`);
        expect(error).toBeUndefined();
        expect(readConfigField(loaded!.config, field)).toEqual(fallback);
        expect(process.env[variable]).toBeUndefined();
        expect(loaded!.settingFallbacks.map(f => f.variable)).toEqual([variable]);
        expect(loaded!.settingFallbacks[0]).toMatchObject({ value: `${field.choices![0]}-typo`, dotPath: field.dotPath });
        const line = warned().find(l => l.includes(variable));
        expect(line, 'one log line names the setting').toBeDefined();
        expect(line).toContain(`"${field.choices![0]}-typo"`);
        expect(line).toContain(`takes one of ${field.choices!.join(', ')}`);
        expect(line).toContain(`the default, ${String(fallback ?? '') || 'no value'}`);
    });

    it.each(Object.entries(START_ONLY_CHOICES))('%s: a word outside its list starts on the default', (variable, choices) => {
        const bad = loadWith(variable, `${choices[0]}x`);
        expect(bad.error).toBeUndefined();
        expect(bad.loaded!.settingFallbacks.map(f => f.variable)).toEqual([variable]);
        const good = loadWith(variable, choices[0]);
        expect(good.error).toBeUndefined();
        expect(good.loaded!.settingFallbacks).toEqual([]);
    });

    it('a listed word in another case runs as that word, never as the open branch', () => {
        const { loaded, error } = loadWith('AIMEAT_METRICS_ACCESS', ' Operator ');
        expect(error).toBeUndefined();
        expect(loaded!.config.metricsAccess).toBe('operator');
        expect(loaded!.settingFallbacks).toEqual([]);
        expect(process.env.AIMEAT_METRICS_ACCESS).toBe('operator');
        const pub = loadWith('AIMEAT_CAPABILITY_PUBLISHING', 'Disabled');
        expect(pub.loaded!.config.capabilityPublishing).toBe('disabled');
    });

    it('a word that is not a number runs the default number, not NaN', () => {
        const { loaded, error } = loadWith('AIMEAT_PASSWORD_LOCKOUT_ATTEMPTS', 'five');
        expect(error).toBeUndefined();
        expect(loaded!.config.passwordLockoutAttempts).toBe(5);
        expect(warned().some(l => l.includes('AIMEAT_PASSWORD_LOCKOUT_ATTEMPTS="five"') && l.includes('takes a whole number') && l.includes('the default, 5'))).toBe(true);
    });

    it('the set-aside value is not reported as coming from the environment', () => {
        const { loaded } = loadWith('AIMEAT_METRICS_ACCESS', 'everyone');
        const row = CONFIG_FIELDS.find(f => f.envVar === 'AIMEAT_METRICS_ACCESS')!;
        expect(loaded!.envKeys).not.toContain(row.dotPath);
    });

    it('a value from a command-line flag is set aside the same way', () => {
        const loaded = loadConfig({ cliOverrides: { 'node.port': 'eighty' } });
        expect(loaded.settingFallbacks.map(f => f.variable)).toEqual(['AIMEAT_PORT']);
        expect(loaded.config.port).toBe(40050);
    });

    it('checkSettings: false loads a broken environment as it is, for validate, init and config', () => {
        process.env.AIMEAT_METRICS_ACCESS = 'everyone';
        const loaded = loadConfig({ checkSettings: false });
        expect(loaded.settingFallbacks).toEqual([]);
        expect(process.env.AIMEAT_METRICS_ACCESS).toBe('everyone');
    });

    it('reports every problem at once', () => {
        const problems = startSettingProblems({ AIMEAT_METRICS_ACCESS: 'x', AIMEAT_STORAGE: 'y', AIMEAT_PORT: 'z' });
        expect(problems.map(p => p.variable).sort()).toEqual(['AIMEAT_METRICS_ACCESS', 'AIMEAT_PORT', 'AIMEAT_STORAGE']);
    });
});

describe('the settings whose default is unsafe or meaningless still refuse the start', () => {
    it('the list is short, and each entry says why', () => {
        expect(Object.keys(REFUSE_ON_INVALID).sort()).toEqual(['AIMEAT_NODE_TYPE', 'AIMEAT_REGISTRATION_MODE', 'AIMEAT_STORAGE']);
        for (const reason of Object.values(REFUSE_ON_INVALID)) expect(reason.length).toBeGreaterThan(20);
    });

    it('an unknown storage value stops the start and says why the default is not used; the known ones and their aliases do not', () => {
        const bad = loadWith('AIMEAT_STORAGE', 'postgres_kysely');
        expect(bad.error).toBeInstanceOf(ConfigStartError);
        expect((bad.error as Error).message).toContain('postgres-kysely');
        expect((bad.error as Error).message).toContain('in-memory database');
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

    it('a registration mode outside its list stops the start, because the default is open registration', () => {
        const bad = loadWith('AIMEAT_REGISTRATION_MODE', 'invite-only');
        expect(bad.error).toBeInstanceOf(ConfigStartError);
        expect((bad.error as ConfigStartError).problems.map(p => p.variable)).toEqual(['AIMEAT_REGISTRATION_MODE']);
        expect((bad.error as Error).message).toContain('open registration');
    });

    it('every node type the loader runs is accepted, and another word stops the start', () => {
        for (const t of ['full', 'relay', 'mirror', 'personal']) expect(loadWith('AIMEAT_NODE_TYPE', t).error, t).toBeUndefined();
        expect(loadWith('AIMEAT_NODE_TYPE', 'realy').error).toBeInstanceOf(ConfigStartError);
    });

    it('a refused setting and a set-aside one together: the refusal names only the refused one', () => {
        process.env.AIMEAT_METRICS_ACCESS = 'everyone';
        const bad = loadWith('AIMEAT_STORAGE', 'sqllite');
        expect((bad.error as ConfigStartError).problems.map(p => p.variable)).toEqual(['AIMEAT_STORAGE']);
    });
});

describe('an empty number or fixed-set setting means unset', () => {
    it('an empty lockout count is the default 5, not NaN, and is not reported', () => {
        const { loaded, error } = loadWith('AIMEAT_PASSWORD_LOCKOUT_ATTEMPTS', '');
        expect(error).toBeUndefined();
        expect(loaded!.config.passwordLockoutAttempts).toBe(5);
        expect(loaded!.settingFallbacks).toEqual([]);
    });

    it('an empty metrics access is the default operator, not the open branch', () => {
        const { loaded, error } = loadWith('AIMEAT_METRICS_ACCESS', '');
        expect(error).toBeUndefined();
        expect(loaded!.config.metricsAccess).toBe('operator');
    });

    it('an empty registration mode is the default', () => {
        const { loaded } = loadWith('AIMEAT_REGISTRATION_MODE', ' ');
        expect(loaded!.config.registrationMode).toBe('open');
    });
});

describe('aimeat validate names every value the start sets aside', () => {
    it('as an error, with what the node does about it', () => {
        process.env.AIMEAT_METRICS_ACCESS = 'everyone';
        process.env.AIMEAT_CAPABILITY_WEBHOOKS = 'allow';
        process.env.AIMEAT_REGISTRATION_MODE = 'invite-only';
        const results = validateEnv();
        const metrics = results.find(r => r.variable === 'AIMEAT_METRICS_ACCESS' && r.level === 'error');
        expect(metrics?.message).toContain('starts on the default');
        expect(results.some(r => r.variable === 'AIMEAT_CAPABILITY_WEBHOOKS' && r.level === 'error')).toBe(true);
        expect(results.find(r => r.variable === 'AIMEAT_REGISTRATION_MODE' && r.level === 'error')?.message).toContain('does not start until it is corrected');
    });

    it('a word in another case as a warning, not an error', () => {
        process.env.AIMEAT_METRICS_ACCESS = 'Operator';
        const results = validateEnv().filter(r => r.variable === 'AIMEAT_METRICS_ACCESS');
        expect(results.map(r => r.level)).toEqual(['warning']);
    });
});

describe('createStorage refuses an unknown provider', () => {
    it('throws instead of opening an in-memory database', async () => {
        await expect(createStorage({ provider: 'postgres-kysley' as never })).rejects.toThrow(/Unknown storage provider/);
    });
});
