/**
 * @file test/unit/config-list-settings.test.ts
 * @description A setting whose running value is a list of strings is a list on every path a value
 *   takes: parsed from raw text, normalized on the save path, written back as raw text. Until
 *   2026-10-11 six such rows were typed 'string', so a save wrote the text into a field the code
 *   reads as an array and `allowed.includes(origin)` became a substring test.
 * @usage pnpm test -- config-list-settings
 * @version-history
 *   v1.1.1 — 2026-10-25 — email.company_smtp_private_hosts, the list row W2b added (secaudit2026oct22).
 *   v1.1.0 — 2026-10-25 — The list rows that came with the rest of the settings' rows, and the one
 *     immutable list row (ai.provider_allowlist).
 *   v1.0.0 — 2026-10-11 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { CONFIG_FIELDS, ALL_CONFIG_MAP, parseConfigValue, serializeFieldValue } from '../../src/services/config-schema.js';
import { asList, isStringList, listFromText } from '../../src/services/config-schema-validators.js';
import { applyConfigChanges } from '../../src/services/config-apply.js';
import type { AimeatConfig } from '../../src/config-types.js';
import type { Storage } from '../../src/storage/interface.js';

const LIST_PATHS = [
    'cors.allowed_origins', 'scopes.default_agent_scopes', 'scopes.max_agent_scopes',
    'push.notify_types', 'realtime.stun_servers', 'federation.default_scopes',
    // Rows since 2026-10-25, when every setting the node reads got one (check:config-coverage).
    'scopes.default_eco_scopes', 'scopes.max_eco_scopes', 'ai.cop_sections', 'features.capability_webhook_domain_allowlist',
    // The private mail hosts companies may send through (config-schema-node-limits.ts, secaudit2026oct22).
    'email.company_smtp_private_hosts',
];
/** List rows that are set in the environment only: a stored key is sent only to these hosts. */
const IMMUTABLE_LIST_PATHS = ['ai.provider_allowlist'];

describe('the list helpers', () => {
    it('split a comma-separated text, trim the parts and drop the empty ones', () => {
        expect(listFromText(' https://a.example , https://b.example,,')).toEqual(['https://a.example', 'https://b.example']);
    });

    it('normalize whatever arrives: a list stays, a text is split, a JSON array text is read as the array', () => {
        expect(asList(['a', 'b'])).toEqual(['a', 'b']);
        expect(asList('a, b')).toEqual(['a', 'b']);
        expect(asList('["a","b"]')).toEqual(['a', 'b']);
        expect(asList('*')).toEqual(['*']);
        expect(asList(5)).toBe(5);
    });

    it('accept a list of non-empty texts and refuse a text, an empty list and an entry with a comma', () => {
        expect(isStringList(['*'])).toBe(true);
        expect(isStringList('https://a.example')).toBe(false);
        expect(isStringList([])).toBe(false);
        expect(isStringList(['a', ''])).toBe(false);
        expect(isStringList(['a,b'])).toBe(false);
        expect(isStringList(['a', 5])).toBe(false);
    });
});

describe('the list rows of the schema', () => {
    it('are exactly the settings the node holds as a list, typed object and marked list', () => {
        expect(CONFIG_FIELDS.filter(f => f.list).map(f => f.dotPath).sort()).toEqual([...LIST_PATHS, ...IMMUTABLE_LIST_PATHS].sort());
        for (const path of IMMUTABLE_LIST_PATHS) expect(ALL_CONFIG_MAP[path].type, path).toBe('object');
        for (const path of LIST_PATHS) {
            expect(ALL_CONFIG_MAP[path].type, path).toBe('object');
            expect(ALL_CONFIG_MAP[path].immutable, path).toBe(false);
        }
    });

    it('refuse a text and accept a list, so a text can never be written to the running config', () => {
        for (const path of LIST_PATHS) {
            expect(ALL_CONFIG_MAP[path].validate('memory:read,memory:write'), path).toBe(false);
            expect(ALL_CONFIG_MAP[path].validate(['memory:read', 'memory:write']), path).toBe(true);
        }
    });

    it('parse raw text (an environment variable, a stored row, Consul) into a list', () => {
        const row = ALL_CONFIG_MAP['cors.allowed_origins'];
        expect(parseConfigValue(row, 'https://a.example,https://b.example')).toEqual(['https://a.example', 'https://b.example']);
        expect(parseConfigValue(row, '["https://a.example"]')).toEqual(['https://a.example']);
    });

    it('write a list back as the comma-separated text its environment variable holds', () => {
        const row = ALL_CONFIG_MAP['cors.allowed_origins'];
        const raw = serializeFieldValue(row, ['https://a.example', 'https://b.example']);
        expect(raw).toBe('https://a.example,https://b.example');
        expect(parseConfigValue(row, raw)).toEqual(['https://a.example', 'https://b.example']);
        // A row that is not a list keeps the JSON form.
        expect(serializeFieldValue(ALL_CONFIG_MAP['agent.system_principles'], ['a', 'b'])).toBe('["a","b"]');
    });
});

describe('applyConfigChanges with a list setting', () => {
    /** A config holding the six lists and a storage that records what was stored. */
    function setup() {
        const stored: Record<string, string> = {};
        const config = {
            nodeId: 'test', sealedConfigKeys: [], corsAllowedOrigins: ['*'], maxAgentScopes: ['*'],
            rateLimits: {},
        } as unknown as AimeatConfig;
        const storage = { setConfigValue: async (p: string, v: string) => { stored[p] = v; } } as unknown as Storage;
        return { config, storage, stored };
    }

    it('turns a comma-separated text into a list before the check, in the store and in the running config', async () => {
        const { config, storage, stored } = setup();
        const r = await applyConfigChanges({ config, storage }, [{ path: 'cors.allowed_origins', value: 'https://app.example.com, https://b.example' }]);
        expect(r.errors).toEqual([]);
        expect(r.applied[0].new_value).toEqual(['https://app.example.com', 'https://b.example']);
        expect(config.corsAllowedOrigins).toEqual(['https://app.example.com', 'https://b.example']);
        expect(stored['cors.allowed_origins']).toBe('https://app.example.com,https://b.example');
        // The reason this matters: a list is matched whole, a text is matched by substring.
        expect((config.corsAllowedOrigins as string[]).includes('https://app.example')).toBe(false);
    });

    it('takes a list as it is, and refuses an empty one without touching the config', async () => {
        const { config, storage, stored } = setup();
        const ok = await applyConfigChanges({ config, storage }, [{ path: 'scopes.max_agent_scopes', value: ['memory:read', 'organism:read'] }]);
        expect(ok.errors).toEqual([]);
        expect(config.maxAgentScopes).toEqual(['memory:read', 'organism:read']);

        const empty = await applyConfigChanges({ config, storage }, [{ path: 'scopes.max_agent_scopes', value: '' }]);
        expect(empty.applied).toEqual([]);
        expect(empty.errors[0].path).toBe('scopes.max_agent_scopes');
        expect(config.maxAgentScopes).toEqual(['memory:read', 'organism:read']);
        expect(stored['scopes.max_agent_scopes']).toBe('memory:read,organism:read');
    });
});
