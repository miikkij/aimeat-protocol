/**
 * @file test/unit/package-trust.test.ts
 * @description What a package's owner approves is what its code gets (secaudit 2026-10, plan S8).
 *   PKG-3: an extension reaches the network, AI jobs, email and payments only through `ctx`, and only
 *   for the capabilities its approval showed; an aliased or computed call and the raw `__*` host
 *   functions get nothing. PKG-4: the package approval and the grant read an app's scopes the same way.
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial.
 */
import { describe, it, expect } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, PackageComponent } from '../../src/storage/interface.js';
import { executeExtensionAction } from '../../src/services/extension-runtime.js';
import { buildExtensionCtx } from '../../src/services/extension-ctx.js';
import { buildExtensionRecordFromManifest } from '../../src/services/extension-manifest.js';
import {
    capabilitiesOfRecord, CAPABILITY_DECLARATION_KEY, type ExtensionCapabilitySet,
} from '../../src/services/extension-capability-declaration.js';
import { packageCapabilities } from '../../src/services/package-capabilities.js';
import { appScopesOf, parseAppScopes } from '../../src/services/protected-resource.js';

const config = {
    nodeId: 'test-node',
    baseUrl: 'http://localhost:40050',
    extensionMaxCodeSizeKb: 512,
    extensionMaxMemoryMb: 64,
    extensionTimeoutMs: 30_000,
    extensionMaxApiCalls: 100,
    extensionMaxDebitPerCall: 100,
    extensionMaxPayMorsels: 1000,
} as unknown as AimeatConfig;

const LIMITS = { memoryMb: 16, timeoutMs: 5000, maxApiCalls: 20 };

function ctxWith(capabilities: ExtensionCapabilitySet, extra: Record<string, unknown> = {}) {
    return buildExtensionCtx({
        config, storage: {} as Storage, extMemoryOwner: 'ext:probe', capabilities,
        caller: { gaii: 'alice@test-node', owner: 'alice', roles: ['owner'] }, extConfig: {}, logPrefix: '[ext:probe]',
        extension: { name: 'probe', owner: 'alice' },
        ...extra,
    });
}

const NONE: ExtensionCapabilitySet = { network: false, ai: false, email: false, payments: false, declared: true };

function manifest(extra: string[] = []): string {
    return [
        'metadata:', '  name: probe', '  version: 1.0.0', '  description: Probe', '  author: alice',
        ...extra,
        'actions:', '  - id: run', '    method: POST', '    path: /run', '    script: run.js',
    ].join('\n');
}

describe('PKG-3: the sandbox gives a script only the capabilities its approval showed', () => {
    it('the raw host functions are gone before the author\'s code runs', async () => {
        const script = `const early = typeof __fetch;
export default async function (ctx) {
    return { early, fetch: typeof __fetch, email: typeof globalThis.__email, buy: typeof globalThis['__ext_' + 'buy'], memory: typeof __memory_get };
}`;
        const out = await executeExtensionAction(script, ctxWith({ ...NONE, network: true }), {}, LIMITS);
        expect(out).toEqual({ early: 'undefined', fetch: 'undefined', email: 'undefined', buy: 'undefined', memory: 'undefined' });
    });

    it('a computed ctx.fetch is not inferred as network, and the sandbox refuses it', async () => {
        const script = `const k = 'fe' + 'tch';
export default async function (ctx) {
    try { await ctx[k]('https://example.com/'); return { reached: true }; }
    catch (e) { return { refused: String(e && e.message || e) }; }
}`;
        const caps = capabilitiesOfRecord({ actions: [{ scriptContent: script }] });
        expect(caps).toMatchObject({ network: false, declared: false });
        const out = await executeExtensionAction(script, ctxWith(caps), {}, LIMITS);
        expect(String(out.refused)).toContain('CAPABILITY_NOT_DECLARED');
    });

    it('email, buying and AI jobs are absent without their capability, and present with it', () => {
        const fns = { email: async () => true, buy: async () => ({}), ai: { start: async () => ({}) } };
        const without = ctxWith(NONE, fns);
        expect([without.email, without.buy, without.ai]).toEqual([undefined, undefined, undefined]);
        const withAll = ctxWith({ network: true, ai: true, email: true, payments: true, declared: true }, fns);
        expect(typeof withAll.email).toBe('function');
        expect(typeof withAll.buy).toBe('function');
        expect(withAll.ai).toBeDefined();
    });

    it('a declared list is the answer, whatever the script text names', () => {
        const built = buildExtensionRecordFromManifest(manifest(['capabilities: [network]']),
            { 'run.js': 'export default async function (ctx) { await ctx.email("a@b.c", "s", "b"); return {}; }' },
            config, 'alice', new Date().toISOString());
        expect(built.ok).toBe(true);
        if (!built.ok) return;
        expect(built.record.config?.[CAPABILITY_DECLARATION_KEY]).toEqual(['network']);
        expect(capabilitiesOfRecord(built.record)).toEqual({ network: true, ai: false, email: false, payments: false, declared: true });
    });

    it('a manifest naming a capability that does not exist is refused, and config: cannot set the list', () => {
        const bad = buildExtensionRecordFromManifest(manifest(['capabilities: [network, shell]']),
            { 'run.js': 'export default async function () { return {}; }' }, config, 'alice', new Date().toISOString());
        expect(bad.ok).toBe(false);
        if (!bad.ok) expect(bad.code).toBe('INVALID_MANIFEST');
        const sneaky = buildExtensionRecordFromManifest(manifest(['config:', '  __capabilities: [network, email]']),
            { 'run.js': 'export default async function () { return {}; }' }, config, 'alice', new Date().toISOString());
        expect(sneaky.ok).toBe(true);
        if (sneaky.ok) expect(capabilitiesOfRecord(sneaky.record)).toMatchObject({ network: false, email: false, declared: false });
    });

    it('the package approval shows the list the sandbox enforces', () => {
        const script = `const k = 'fe' + 'tch';\nexport default async function (ctx) { return ctx[k]('https://example.com/'); }`;
        const comp = { id: 'ext1', type: 'extension', label: 'Probe',
            content: JSON.stringify({ manifest: manifest(), scripts: { 'run.js': script } }) } as unknown as PackageComponent;
        const ext = packageCapabilities([comp], config, 'alice').capabilities.extensions[0]!;
        expect(ext.network).toBe(false);
    });
});

describe('PKG-4: the approval and the grant read an app\'s scopes the same way', () => {
    // The first tag in the page asks for much; a later one, written name-first, asks for little. The
    // grant reads the first tag. The approval's own regex preferred the name-first tag, so the owner
    // approved the short list and the grant got the long one.
    const html = '<html><head>'
        + '<meta content="memory:read memory:write organism:write" name="aimeat-scopes">'
        + '<meta name="aimeat-scopes" content="memory:read">'
        + '</head><body></body></html>';

    it('shows the owner the list the grant will carry', () => {
        const comp = { id: 'app1', type: 'app', label: 'App', content: html } as unknown as PackageComponent;
        const app = packageCapabilities([comp], config, 'alice').capabilities.apps[0]!;
        expect(app.scopes).toEqual([...parseAppScopes(html)].sort());
        expect(app.scopes).toContain('organism:write');
    });

    it('a declaration past the first 64 KB is not read by either, so both fall back to the default', () => {
        const late = `<html><head>${'<!-- pad -->'.repeat(7000)}<meta name="aimeat-scopes" content="ai:use"></head></html>`;
        const comp = { id: 'app2', type: 'app', label: 'App', content: late } as unknown as PackageComponent;
        const app = packageCapabilities([comp], config, 'alice').capabilities.apps[0]!;
        expect(app).toMatchObject(appScopesOf(late));
        expect(app.declared).toBe(false);
    });
});
