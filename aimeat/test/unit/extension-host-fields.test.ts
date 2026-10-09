/**
 * @file test/unit/extension-host-fields.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A host the installer answers instead of the author (manifest `network.host_fields`,
 *   services/extension-network-hosts.ts), so one package bundle serves every buyer:
 *   - the built record keeps the field, and ctx.fetch reaches the declared hosts plus the field's
 *     value, and is refused any other host with `Fetch blocked:`;
 *   - a value with a scheme, a path, a wildcard or two names is refused when it is set, at build,
 *     at install (planPackageConfig) and by the owner (setExtensionConfig);
 *   - the package's config-needs asks the field (required, or not when the manifest says optional);
 *   - the owner changing the value changes what ctx.fetch reaches, with no reinstall;
 *   - the approval names the field, never its value.
 *   safeFetch is replaced by a recorder, the way extension-ai-provider-ctx.test.ts does it.
 * @usage cd aimeat && pnpm exec vitest run test/unit/extension-host-fields.test.ts
 * @version-history
 *   v1.1.0 — 2026-10-09 — An unset field beside fixed hosts is named in the refusal.
 *   v1.0.0 — 2026-10-09 — Initial (wish-a-package-s-extension-hosts-settable-per-install-the-soc-s-w).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, ExtensionRecord, PackageRecord } from '../../src/storage/interface.js';
import type { SafeFetchInit } from '../../src/utils/url-validator.js';

const calls: string[] = [];
vi.mock('../../src/utils/url-validator.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/utils/url-validator.js')>();
    return {
        ...actual,
        safeFetch: vi.fn(async (url: string, _init: SafeFetchInit = {}) => { calls.push(url); return new Response('{"ok":true}', { status: 200 }); }),
    };
});

const { buildExtensionRecordFromManifest } = await import('../../src/services/extension-manifest.js');
const { capabilitiesOfRecord } = await import('../../src/services/extension-capability-declaration.js');
const { buildExtensionCtx } = await import('../../src/services/extension-ctx.js');
const { parseHostFieldValue, NETWORK_HOST_FIELDS_KEY } = await import('../../src/services/extension-network-hosts.js');
const { setExtensionConfig } = await import('../../src/services/extension-config-set.js');
const { questionsOf } = await import('../../src/services/packages/compose/package-config-needs.js');
const { planPackageConfig } = await import('../../src/services/packages/compose/package-config.js');
const { packageCapabilities } = await import('../../src/services/packages/install/package-capabilities.js');

const config = {
    nodeId: 'node-1', encryptionKey: null, totpSecretEncryptionKey: null,
    extensionMaxCodeSizeKb: 512, extensionMaxMemoryMb: 64, extensionTimeoutMs: 10_000,
    extensionMaxApiCalls: 10, extensionMaxDebitPerCall: 100, extensionMaxPayMorsels: 1000,
} as unknown as AimeatConfig;

const SCRIPTS = { 'pull.js': 'export default async function (ctx) { return await ctx.fetch("https://a.example/"); }' };

function manifest(network: string, configBlock: string): string {
    return [
        'metadata:',
        '  name: soc-ingest',
        '  version: 1.0.0',
        '  description: Reads an indexer',
        '  author: alice',
        'capabilities: [network]',
        network,
        configBlock,
        'actions:',
        '  - id: pull',
        '    method: POST',
        '    path: /pull',
        '    script: pull.js',
    ].join('\n');
}

const NET = 'network: { hosts: [a.example], host_fields: { X: required } }';
const build = (yaml: string) => buildExtensionRecordFromManifest(yaml, SCRIPTS, config, 'alice', '2026-10-09T00:00:00.000Z');

function record(network = NET, configBlock = 'config:\n  X: { default: b.example, description: The indexer }'): ExtensionRecord {
    const built = build(manifest(network, configBlock));
    if (!built.ok) throw new Error(`build refused: ${built.message}`);
    return built.record;
}

const ctxOf = (ext: ExtensionRecord) => buildExtensionCtx({
    capabilities: capabilitiesOfRecord(ext),
    config, storage: {} as Storage, extMemoryOwner: 'ext:soc-ingest',
    caller: { gaii: 'alice@node-1', owner: 'alice', roles: [] }, extConfig: {}, logPrefix: '[ext:soc-ingest]',
    extension: { name: 'soc-ingest', owner: 'alice' },
});

/** A storage holding one extension, whose update merges the way the providers do. */
function storageWith(ext: ExtensionRecord) {
    let stored = ext;
    const updateExtension = vi.fn(async (_name: string, updates: Partial<ExtensionRecord>) => { stored = { ...stored, ...updates }; return stored; });
    return { storage: { updateExtension, getExtension: async () => stored } as unknown as Storage, updateExtension, current: () => stored };
}

beforeEach(() => { calls.length = 0; });

describe('a host field joins the fetch allowlist of its install', () => {
    it('reaches the declared host and the field value, and refuses any other host', async () => {
        const ext = record();
        expect(ext.config?.[NETWORK_HOST_FIELDS_KEY]).toEqual([{ field: 'X', required: true }]);
        expect(ext.config?.X).toBe('b.example');
        expect(capabilitiesOfRecord(ext).hosts).toEqual(['a.example', 'b.example']);

        const ctx = ctxOf(ext);
        expect((await ctx.fetch('https://a.example/x')).status).toBe(200);
        expect((await ctx.fetch('https://B.example:9200/_search')).status).toBe(200);
        await expect(ctx.fetch('https://c.example/')).rejects.toThrow(/^Fetch blocked:/);
        expect(calls).toEqual(['https://a.example/x', 'https://B.example:9200/_search']);
    });

    it('a field with no value adds nothing, and with no fixed hosts every fetch is refused, saying the field is not set', async () => {
        const ext = record('network: { host_fields: { X: optional } }', 'config:\n  X: { description: The indexer }');
        expect(ext.config?.X).toBe('');
        expect(capabilitiesOfRecord(ext).hosts).toEqual([]);
        await expect(ctxOf(ext).fetch('https://a.example/')).rejects.toThrow(/Fetch blocked:.*network\.hosts: none; the owner has not set the host field X/);
        expect(calls).toEqual([]);
    });

    it('beside fixed hosts, an unset field is named in the refusal, and the fixed hosts still answer', async () => {
        // The SOC's shape: Microsoft hosts fixed, WAZUH_HOST optional and left empty. Before v1.2.1 the
        // refusal named only the fixed hosts (koeajo-hostfield1, 2026-10-09).
        const ext = record('network: { hosts: [a.example], host_fields: { X: optional } }', 'config:\n  X: { description: The indexer }');
        expect(capabilitiesOfRecord(ext)).toMatchObject({ hosts: ['a.example'], unsetHostFields: ['X'] });
        const ctx = ctxOf(ext);
        await expect(ctx.fetch('https://wazuh.example:9200/')).rejects.toThrow(/network\.hosts: a\.example; the owner has not set the host field X\)/);
        expect((await ctx.fetch('https://a.example/')).status).toBe(200);
        expect(capabilitiesOfRecord(record()).unsetHostFields).toBeUndefined();
    });
});

describe('a host field value is one host', () => {
    it.each([
        ['Wazuh.Example.COM', 'wazuh.example.com', 'wazuh.example.com'],
        ['wazuh.example.com:9200', 'wazuh.example.com:9200', 'wazuh.example.com'],
        ['10.0.0.5:9200', '10.0.0.5:9200', '10.0.0.5'],
        ['', '', null],
    ])('accepts %j', (raw, value, host) => {
        expect(parseHostFieldValue(raw)).toEqual({ ok: true, value, host });
    });

    it.each([
        'https://wazuh.example.com', 'wazuh.example.com/api', '*.example.com', 'a.example b.example',
        'a.example,b.example', '[::1]', 'fe80::1', 'wazuh.example.com:0', 'wazuh.example.com:70000', '010.0.0.5', 42,
    ])('refuses %j', (raw) => {
        expect(parseHostFieldValue(raw).ok).toBe(false);
    });

    it.each([
        ['network: { hosts: [a.example], hostFields: [X] }', /spelled host_fields/],
        ['network: { hosts: [a.example], host_fields: [X] }', /must be a map of config field to required or optional/],
        ['network: { host_fields: { X: maybe } }', /must be required or optional/],
        ['network: { host_fields: { Y: required } }', /Y, which is not a field of this manifest's config/],
    ])('a manifest is refused: %s', (network, why) => {
        const out = build(manifest(network, 'config:\n  X: { description: The indexer }'));
        expect(out.ok).toBe(false);
        if (!out.ok) expect(out.message).toMatch(why);
    });

    it('a manifest is refused when the host field is secret, or its own value is not a host', () => {
        const secret = build(manifest(NET, 'config:\n  X: { type: secret, description: The indexer }'));
        expect(secret.ok || secret.message).toMatch(/is a secret field/);
        const bad = build(manifest(NET, 'config:\n  X: { default: "https://b.example/api" }'));
        expect(bad.ok || bad.message).toMatch(/config\.X is a host field/);
    });
});

describe('the owner changes the host without a new version', () => {
    it('changes what ctx.fetch reaches from the next run on', async () => {
        const { storage, current } = storageWith(record());
        const out = await setExtensionConfig({ storage, config }, current(), { X: 'C.example:9200' });
        expect(out.ok && out.changed).toEqual(['X']);
        expect(current().config?.X).toBe('c.example:9200');
        expect(current().version).toBe('1.0.0');

        const ctx = ctxOf(current());
        expect((await ctx.fetch('https://c.example:9200/')).status).toBe(200);
        await expect(ctx.fetch('https://b.example/')).rejects.toThrow(/^Fetch blocked:/);
    });

    it.each([
        [{ X: 'https://c.example' }, /X is a host field/],
        [{ X: 'c.example/path' }, /X is a host field/],
        [{ X: '*.example' }, /X is a host field/],
        [{ X: 'c.example d.example' }, /X is a host field/],
        [{ Y: 'c.example' }, /does not declare Y/],
        [{ __networkHostFields: [] }, /does not declare __networkHostFields/],
        [{ X: { encrypted: 'x' } }, /X is a host field/],
        [{}, /non-empty object/],
    ])('refuses %j and writes nothing', async (values, why) => {
        const { storage, current, updateExtension } = storageWith(record());
        const out = await setExtensionConfig({ storage, config }, current(), values);
        expect(out.ok).toBe(false);
        if (!out.ok) { expect(out.code).toBe('INVALID_INPUT'); expect(out.message).toMatch(why); }
        expect(updateExtension).not.toHaveBeenCalled();
    });
});

describe('the package asks the host field before the sale', () => {
    const pkgOf = (network: string): PackageRecord => ({
        packageGroupId: 'soc', author: 'alice', version: '1.0.0', name: 'SOC',
        components: [{ id: 'soc-ingest', type: 'extension', label: 'soc-ingest',
            content: JSON.stringify({ manifest: manifest(network, 'config:\n  X: { description: The indexer }\n  REGION: eu'), scripts: SCRIPTS }) }],
    }) as unknown as PackageRecord;

    it('a required host field is a required question marked host, an optional one is not required', () => {
        const required = questionsOf(pkgOf(NET), {}, config);
        expect(required.ok && required.questions.find(q => q.field === 'X')).toMatchObject({ component: 'soc-ingest', kind: 'extension', required: true, secret: false, host: true });
        expect(required.ok && required.questions.find(q => q.field === 'REGION')).toMatchObject({ required: false });
        expect(required.ok && required.questions.find(q => q.field === 'REGION')?.host).toBeUndefined();

        const optional = questionsOf(pkgOf('network: { hosts: [a.example], host_fields: { X: optional } }'), {}, config);
        expect(optional.ok && optional.questions.find(q => q.field === 'X')).toMatchObject({ required: false, host: true });
    });

    it('the install takes one host, normalised, and refuses anything else before a part registers', () => {
        const pkg = pkgOf(NET);
        const planned = pkg.components.map(c => ({ componentId: c.id, type: c.type, registeredAs: c.id, originalHash: '', customized: false }));
        const ok = planPackageConfig(pkg.components, planned, { 'soc-ingest': { X: ' Wazuh.Example.com:9200 ' } }, { config, owner: 'alice' });
        expect(ok.ok && ok.entries[0].values).toEqual({ X: 'wazuh.example.com:9200' });
        const bad = planPackageConfig(pkg.components, planned, { 'soc-ingest': { X: 'https://wazuh.example.com' } }, { config, owner: 'alice' });
        expect(bad.ok || bad.message).toMatch(/soc-ingest\.X is a host field/);
    });

    it('the approval names the field and the fixed hosts, never a value', () => {
        const pkg = pkgOf(NET);
        const caps = packageCapabilities(pkg.components, config, 'alice');
        expect(caps.capabilities.extensions[0].network_hosts).toEqual(['a.example']);
        expect(caps.capabilities.extensions[0].network_host_fields).toEqual([{ field: 'X', required: true }]);
        expect(caps.items).toContain('extension:soc-ingest:network-host-field:X');
        expect(caps.items.filter(i => i.includes('network-host:'))).toEqual(['extension:soc-ingest:network-host:a.example']);
    });
});
