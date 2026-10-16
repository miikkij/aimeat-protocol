/**
 * @file test/unit/config-stated-defaults.test.ts
 * @description The defaults the node STATES are the defaults the loader RESOLVES. `aimeat config`
 *   prints a default beside every running value (src/utils/env-config/*), and the init wizard keeps
 *   its own map to decide which answers changed something (CONFIG_DEFAULTS in presets.ts). Both were
 *   hand-written, and both said `operator` for AIMEAT_EXT_INSTALL_ROLE for seven months after the
 *   loader default became `owner`. Here each stated default is compared with what loadConfig()
 *   resolves when no setting is given, so a loader default that moves fails until the text follows.
 * @usage pnpm exec vitest run test/unit/config-stated-defaults.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit D8-04).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadConfig } from '../../src/config.js';
import type { AimeatConfig } from '../../src/config-types.js';
import { nodeSections } from '../../src/utils/env-config/sections-node.js';
import { platformSections } from '../../src/utils/env-config/sections-platform.js';
import { featureSections } from '../../src/utils/env-config/sections-features.js';
import { federationSections } from '../../src/utils/env-config/sections-federation.js';
import { CONFIG_DEFAULTS } from '../../src/cli/init-wizard/presets.js';
import { ALL_CONFIG_MAP, ENV_TO_DOT_PATH, readConfigField, serializeFieldValue } from '../../src/services/config-schema.js';

let saved: NodeJS.ProcessEnv;
let config: AimeatConfig;

beforeAll(() => {
    saved = { ...process.env };
    for (const k of Object.keys(process.env)) if (k.startsWith('AIMEAT_') || k === 'DATABASE_URL') delete process.env[k];
    config = loadConfig({ checkSettings: false }).config;
});
afterAll(() => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
});

/** Entries whose stated default is a description of a derived value, not a value. */
const DERIVED = new Set(['AIMEAT_BASE_URL', 'AIMEAT_SQLITE_PATH']);

describe('aimeat config states the loader defaults', () => {
    it('every literal default matches the value the loader resolves with no setting', () => {
        const sections = [...nodeSections(config), ...platformSections(config), ...featureSections(config), ...federationSections(config)];
        const wrong: string[] = [];
        for (const s of sections) {
            for (const e of s.entries) {
                // "(none)", "(derived)", "(paired)" describe an unset or computed value; the display prints its own words there.
                if (e.secret || DERIVED.has(e.envVar) || e.defaultVal.startsWith('(')) continue;
                if (e.value !== e.defaultVal) wrong.push(`${e.envVar}: states ${e.defaultVal}, loader gives ${e.value}`);
            }
        }
        expect(wrong).toEqual([]);
    });
});

describe('the init wizard compares answers with the loader defaults', () => {
    it('every CONFIG_DEFAULTS entry with a schema row matches the loader', () => {
        const wrong: string[] = [];
        for (const [envVar, stated] of Object.entries(CONFIG_DEFAULTS)) {
            const dotPath = ENV_TO_DOT_PATH[envVar];
            if (!dotPath || DERIVED.has(envVar)) continue;
            const field = ALL_CONFIG_MAP[dotPath];
            if (field.type === 'object' && !field.list) continue;
            const live = readConfigField(config, field);
            // An empty stated default means "not set": the loader holds null, undefined or ''.
            if (stated === '' && (live === null || live === undefined || live === '' || (Array.isArray(live) && live.length === 0))) continue;
            const text = serializeFieldValue(field, live);
            if (text !== stated) wrong.push(`${envVar}: states ${stated}, loader gives ${text}`);
        }
        expect(wrong).toEqual([]);
    });

    it('the two security defaults the audit named are stated right', () => {
        expect(CONFIG_DEFAULTS.AIMEAT_EXT_INSTALL_ROLE).toBe(config.extInstallRole);
        expect(CONFIG_DEFAULTS.AIMEAT_EXTENSIONS_ENABLED).toBe(String(config.extensionsEnabled));
    });
});
