/**
 * @file connect-client-config.test.ts
 * @description Guards the one property that matters for `aimeat connect client <id>`: it edits a
 *   config file the user already owns, so it must MERGE. Every adapter here is checked against a
 *   config that already holds another MCP server, another extension, and unrelated top-level keys.
 *   Losing any of those would silently disconnect the user's other tools.
 * @structure One describe per adapter, plus the parse-failure guard and the token-stays-out-of-the
 *   -file guard that applies to all of them.
 * @version-history
 *   v1.0.0 — 2026-08-02 — Initial creation: one-command client connect.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { readJsonFile, readYamlFile, objectAt, backup } from '../../src/cli/connect/clients/fs-merge.js';
import { gooseAdapter } from '../../src/cli/connect/clients/goose.js';
import { cursorAdapter, vscodeAdapter } from '../../src/cli/connect/clients/cursor-vscode.js';
import { claudeDesktopAdapter } from '../../src/cli/connect/clients/claude.js';
import type { ClientTarget } from '../../src/cli/connect/clients/types.js';

let sandbox: string;
let target: ClientTarget;

/** Point every per-platform config path at a sandbox by hijacking the env vars they read. */
const savedEnv: Record<string, string | undefined> = {};
function setEnv(key: string, value: string): void {
    savedEnv[key] = process.env[key];
    process.env[key] = value;
}

beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'aimeat-client-'));
    setEnv('APPDATA', join(sandbox, 'AppData'));
    setEnv('XDG_CONFIG_HOME', join(sandbox, 'xdg'));
    setEnv('HOME', sandbox);
    setEnv('USERPROFILE', sandbox);

    const home = join(sandbox, '.aimeat-test');
    mkdirSync(join(home, 'tokens'), { recursive: true });
    writeFileSync(join(home, 'tokens', 'goose@alice.token'), 'test-token-value');
    target = {
        nodeUrl: 'https://aimeat.io',
        mcpUrl: 'https://aimeat.io/v1/mcp',
        agent: 'goose',
        owner: 'alice',
        home,
        tokenFile: join(home, 'tokens', 'goose@alice.token'),
        serverName: 'aimeat',
        workdir: join(sandbox, 'work'),
    };
});

afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    rmSync(sandbox, { recursive: true, force: true });
});

describe('fs-merge', () => {
    it('refuses to overwrite a config it cannot parse', () => {
        const file = join(sandbox, 'broken.json');
        writeFileSync(file, '{ this is not json');
        expect(() => readJsonFile(file)).toThrow(/not valid JSON/);
        const y = join(sandbox, 'broken.yaml');
        writeFileSync(y, 'a:\n  - [unclosed\n');
        expect(() => readYamlFile(y)).toThrow(/not valid YAML/);
    });

    it('treats a missing file as empty and keeps existing nested objects', () => {
        expect(readJsonFile(join(sandbox, 'nope.json'))).toEqual({});
        const root: Record<string, unknown> = { servers: { other: { url: 'x' } } };
        const servers = objectAt(root, 'servers');
        servers.aimeat = { url: 'y' };
        expect(root.servers).toEqual({ other: { url: 'x' }, aimeat: { url: 'y' } });
    });

    it('backs a file up before it is modified, and reports nothing when there was no file', () => {
        const file = join(sandbox, 'cfg.json');
        expect(backup(file)).toBeNull();
        writeFileSync(file, '{"a":1}');
        const bak = backup(file);
        expect(bak).toBe(`${file}.aimeat-bak`);
        expect(readFileSync(bak!, 'utf8')).toBe('{"a":1}');
    });
});

describe('goose adapter', () => {
    it('keeps other extensions and the rest of the config', async () => {
        const file = gooseAdapter.configPath();
        mkdirSync(join(file, '..'), { recursive: true });
        writeFileSync(file, [
            'GOOSE_MODE: auto',
            'GOOSE_MODEL: some/model',
            'extensions:',
            '  developer:',
            '    type: builtin',
            '    enabled: true',
            '  someone-elses-server:',
            '    type: stdio',
            '    cmd: node',
            '    enabled: true',
        ].join('\n'));

        await gooseAdapter.apply(target);

        const after = parseYaml(readFileSync(file, 'utf8')) as Record<string, Record<string, Record<string, unknown>>>;
        expect(after.GOOSE_MODE).toBe('auto');
        expect(after.GOOSE_MODEL).toBe('some/model');
        expect(after.extensions['someone-elses-server']).toEqual({ type: 'stdio', cmd: 'node', enabled: true });
        expect(after.extensions.developer.type).toBe('builtin');
        expect(after.extensions.aimeat.type).toBe('streamable_http');
        expect(after.extensions.aimeat.uri).toBe('https://aimeat.io/v1/mcp');
    });

    it('never writes the token into the config, only a variable reference', async () => {
        await gooseAdapter.apply(target);
        const raw = readFileSync(gooseAdapter.configPath(), 'utf8');
        expect(raw).not.toContain('test-token-value');
        expect(raw).toContain('${AIMEAT_AGENT_TOKEN}');
    });

    it('writes a launcher that reads the token at run time', async () => {
        const result = await gooseAdapter.apply(target);
        const ps1 = result.written.find((f) => f.endsWith('.ps1'))!;
        expect(existsSync(ps1)).toBe(true);
        const script = readFileSync(ps1, 'utf8');
        expect(script).toContain(target.tokenFile);
        expect(script).not.toContain('test-token-value');
    });
});

describe('cursor and vscode adapters', () => {
    it('cursor merges into mcpServers without dropping another server', async () => {
        const file = cursorAdapter.configPath();
        mkdirSync(join(file, '..'), { recursive: true });
        writeFileSync(file, JSON.stringify({ mcpServers: { github: { url: 'https://example.test/mcp' } } }));

        await cursorAdapter.apply(target);

        const after = readJsonFile(file) as { mcpServers: Record<string, { url: string; headers?: Record<string, string> }> };
        expect(after.mcpServers.github.url).toBe('https://example.test/mcp');
        expect(after.mcpServers.aimeat.url).toBe('https://aimeat.io/v1/mcp');
        expect(after.mcpServers.aimeat.headers?.Authorization).toBe('Bearer ${env:AIMEAT_AGENT_TOKEN}');
    });

    it('vscode uses servers + type http and keeps inputs', async () => {
        const file = vscodeAdapter.configPath();
        mkdirSync(join(file, '..'), { recursive: true });
        writeFileSync(file, JSON.stringify({ inputs: [{ id: 'x', type: 'promptString' }], servers: { other: { type: 'stdio', command: 'node' } } }));

        await vscodeAdapter.apply(target);

        const after = readJsonFile(file) as { inputs: unknown[]; servers: Record<string, Record<string, unknown>> };
        expect(after.inputs).toHaveLength(1);
        expect(after.servers.other.command).toBe('node');
        expect(after.servers.aimeat.type).toBe('http');
        expect(after.servers.aimeat.url).toBe('https://aimeat.io/v1/mcp');
    });

    it('neither writes the token itself', async () => {
        await cursorAdapter.apply(target);
        await vscodeAdapter.apply(target);
        expect(readFileSync(cursorAdapter.configPath(), 'utf8')).not.toContain('test-token-value');
        expect(readFileSync(vscodeAdapter.configPath(), 'utf8')).not.toContain('test-token-value');
    });
});

describe('claude desktop adapter', () => {
    it('writes a stdio entry and NEVER a url (a url makes Desktop discard the whole block)', async () => {
        const file = claudeDesktopAdapter.configPath();
        mkdirSync(join(file, '..'), { recursive: true });
        writeFileSync(file, JSON.stringify({ mcpServers: { filesystem: { command: 'npx', args: ['-y', 'server'] } } }));

        await claudeDesktopAdapter.apply(target);

        const after = readJsonFile(file) as { mcpServers: Record<string, Record<string, unknown>> };
        expect(after.mcpServers.filesystem.command).toBe('npx');
        expect(after.mcpServers.aimeat.url).toBeUndefined();
        expect(after.mcpServers.aimeat.command).toBeTruthy();
        expect((after.mcpServers.aimeat.env as Record<string, string>).AIMEAT_HOME).toBe(target.home);
        expect(readFileSync(file, 'utf8')).not.toContain('test-token-value');
    });

    it('passes the surface through to the connector when one is asked for', async () => {
        const file = claudeDesktopAdapter.configPath();
        mkdirSync(join(file, '..'), { recursive: true });
        await claudeDesktopAdapter.apply({ ...target, surface: 'appdev' });
        const after = readJsonFile(file) as { mcpServers: Record<string, { args: string[] }> };
        expect(after.mcpServers.aimeat.args).toContain('--surface');
        expect(after.mcpServers.aimeat.args).toContain('appdev');
    });
});
