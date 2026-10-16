/**
 * @file test/unit/init-wizard-writers.test.ts
 * @description `aimeat init` from the answers to the running config: the wizard steps run against a
 *   scripted prompt, each of the three writers turns the answers into a file, and loadConfig() reads
 *   that file back. What the operator answered is what the node runs, in every format: no answer is
 *   dropped from the .env, a "No" is written where the loader's default is on, and the JSON and INI
 *   files use the paths the loader reads.
 * @usage pnpm exec vitest run test/unit/init-wizard-writers.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit D8-03).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** The answer every yes/no question gets in the current test. */
let confirmAnswer = false;

vi.mock('@clack/prompts', () => ({
    isCancel: () => false,
    cancel: () => undefined,
    note: () => undefined,
    log: { info: () => undefined, warn: () => undefined, success: () => undefined, step: () => undefined, message: () => undefined },
    confirm: async () => confirmAnswer,
    // A text question takes its default, or an answer of the shape its key asks for (the test's t()
    // returns the key, so the message is `init.operatorHostingUrl` and the like).
    text: async (opts: { message: string; defaultValue?: string }) => {
        if (opts.defaultValue) return opts.defaultValue;
        if (/Url$/i.test(opts.message)) return 'https://authority.example.test/';
        if (/Date$/i.test(opts.message)) return '2026-10-16';
        if (/Email$/i.test(opts.message)) return 'privacy@example.test';
        if (/Percent$/i.test(opts.message)) return '5';
        return `Answer to ${opts.message}`;
    },
    password: async () => 'Correct-Horse-Battery-Staple-42',
    select: async (opts: { initialValue?: unknown; options: Array<{ value: unknown }> }) => opts.initialValue ?? opts.options[0].value,
    multiselect: async (opts: { initialValues?: unknown[] }) => opts.initialValues ?? [],
}));

const { createT } = await import('../../src/i18n.js');
const { loadConfig } = await import('../../src/config.js');
const { buildPresets } = await import('../../src/cli/init-wizard/presets.js');
const { askCoreSettings } = await import('../../src/cli/init-wizard/steps-core.js');
const { askOperatorSettings } = await import('../../src/cli/init-wizard/steps-operator.js');
const { askAllAdvancedSettings } = await import('../../src/cli/init-wizard/steps-advanced.js');
const { generateEnvContent, generateIniContent, generateJsonContent, OTHER_SETTINGS_TITLE } = await import('../../src/cli/init-wizard/generate.js');

let saved: NodeJS.ProcessEnv;
let dir: string;
beforeEach(() => {
    saved = { ...process.env };
    for (const k of Object.keys(process.env)) if (k.startsWith('AIMEAT_') || k === 'DATABASE_URL') delete process.env[k];
    dir = mkdtempSync(join(tmpdir(), 'aimeat-init-'));
});
afterEach(() => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    rmSync(dir, { recursive: true, force: true });
});

/** The answers of a public node set up with "all advanced settings", every yes/no answered `answer`. */
async function publicAnswers(answer: boolean): Promise<Record<string, string>> {
    confirmAnswer = answer;
    const t = ((key: string) => key) as ReturnType<typeof createT>;
    const cfg = loadConfig({ checkSettings: false }).config;
    const preset = buildPresets(cfg).public;
    const settings = await askCoreSettings(t, preset, 'public', {});
    settings.AIMEAT_BASE_URL = 'https://node.example.test';
    Object.assign(settings, await askOperatorSettings(t, 'public', {}));
    Object.assign(settings, await askAllAdvancedSettings(t, cfg, 'public', settings.AIMEAT_BASE_URL));
    // A public node runs on PostgreSQL in production; the test reads the file back without opening it.
    settings.AIMEAT_STORAGE = 'sqlite';
    settings.AIMEAT_SQLITE_PATH = join(dir, 'node.db');
    settings.AIMEAT_SECURITY_PROFILE = 'public';
    return settings;
}

/** Parses the .env the wizard wrote into variables, the way node --env-file reads it. */
function parseEnv(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
        const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
        if (!m) continue;
        let v = m[2];
        if (/^".*"$/.test(v)) v = v.slice(1, -1);
        out[m[1]] = v;
    }
    return out;
}

/** Every variable a wizard step can set, read from the step sources. */
function assignedBySteps(): string[] {
    const root = join(process.cwd(), 'src', 'cli');
    const files = [join(root, 'init-wizard.ts'), ...readdirSync(join(root, 'init-wizard')).map(f => join(root, 'init-wizard', f))];
    const keys = new Set<string>();
    for (const f of files) {
        for (const m of readFileSync(f, 'utf8').matchAll(/settings\.((?:AIMEAT|DATABASE)_[A-Z0-9_]+)\s*=/g)) keys.add(m[1]);
    }
    return [...keys].sort();
}

describe('the .env writer', () => {
    it('names every variable a wizard step can set in a section of its own', () => {
        const all = Object.fromEntries(assignedBySteps().map(k => [k, 'x']));
        const text = generateEnvContent(all);
        expect(text).not.toContain(`# ── ${OTHER_SETTINGS_TITLE}`);
        for (const k of Object.keys(all)) expect(text, k).toMatch(new RegExp(`^${k}=`, 'm'));
    });

    it('still writes a key no section names, under Other settings', () => {
        const text = generateEnvContent({ AIMEAT_SOMETHING_NEW: 'yes' });
        expect(text).toContain(OTHER_SETTINGS_TITLE);
        expect(text).toMatch(/^AIMEAT_SOMETHING_NEW="?yes"?$/m);
    });

    it('carries the operator identity to the running config', async () => {
        const settings = await publicAnswers(false);
        expect(settings.AIMEAT_OPERATOR_NAME).toBeTruthy();
        Object.assign(process.env, parseEnv(generateEnvContent(settings)));
        const { config } = loadConfig();
        expect(config.operator.name).toBe(settings.AIMEAT_OPERATOR_NAME);
        expect(config.operator.email).toBe(settings.AIMEAT_OPERATOR_EMAIL);
    });

    it('a "No" to extensions, push and the app origin turns them off on the running node', async () => {
        const settings = await publicAnswers(false);
        Object.assign(process.env, parseEnv(generateEnvContent(settings)));
        const { config } = loadConfig();
        expect(config.extensionsEnabled).toBe(false);
        expect(config.pushEnabled).toBe(false);
        expect(config.appOriginEnabled).toBe(false);
    });

    it('a "Yes" turns them on', async () => {
        const settings = await publicAnswers(true);
        Object.assign(process.env, parseEnv(generateEnvContent(settings)));
        const { config } = loadConfig();
        expect(config.extensionsEnabled).toBe(true);
        expect(config.pushEnabled).toBe(true);
        expect(config.appOriginEnabled).toBe(true);
    });
});

describe.each([
    ['json', (s: Record<string, string>) => generateJsonContent(s)],
    ['ini', (s: Record<string, string>) => generateIniContent(s)],
])('the %s writer', (ext, write) => {
    it('writes a file the loader reads back to the same config', async () => {
        const settings = await publicAnswers(false);
        const file = join(dir, `node.${ext}`);
        writeFileSync(file, write(settings));
        const { config, fileKeys } = loadConfig({ configPath: file });
        expect(fileKeys.length).toBeGreaterThan(10);
        expect(config.nodeId).toBe(settings.AIMEAT_NODE_ID);
        expect(config.storageProvider).toBe('sqlite');
        expect(config.sqlitePath).toBe(settings.AIMEAT_SQLITE_PATH);
        expect(config.operator.name).toBe(settings.AIMEAT_OPERATOR_NAME);
        expect(config.extensionsEnabled).toBe(false);
        expect(config.appOriginEnabled).toBe(false);
    });
});
