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
import { grantEntitlement, readEntitlements } from '../../src/services/package-entitlements.js';
import { createClaim, redeemClaim } from '../../src/services/package-claims.js';
import { isOwnPackage } from '../../src/services/package-approvals.js';
import { installSetRepositories } from '../../src/services/install-set-trust.js';
import { peerCarriesAgents } from '../../src/services/federation.js';
import type { PackageRecord } from '../../src/storage/interface.js';

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

describe('PKG-2: a sale onto a grant another seller or the author made keeps its channel', () => {
    /** The repository's storage, as much of it as grantEntitlement reads and writes. */
    function repo(): Storage {
        const mem = new Map<string, any>();
        return {
            listVersions: async () => ({ versions: [{ author: 'alice' }] }),
            getMemory: async (ns: string, key: string) => mem.get(`${ns}/${key}`) ?? null,
            setMemory: async (rec: any) => { mem.set(`${rec.ownerGaii}/${rec.key}`, rec); },
        } as unknown as Storage;
    }
    const AUTHOR = { owner: 'alice', isOperator: false };
    const G = 'com.example.kit';

    it('another seller\'s later date is a new sale, and the customer stays on their channel', async () => {
        const s = repo();
        const first = await grantEntitlement(s, AUTHOR, { groupId: G, nodeId: 'aimeat-customer-001', updatesUntil: '2027-06-01T00:00:00.000Z', channel: 'stable' }, undefined, { seller: 'shop-a' });
        expect(first.ok).toBe(true);
        const other = await grantEntitlement(s, AUTHOR, { groupId: G, nodeId: 'aimeat-customer-001', updatesUntil: '2027-09-01T00:00:00.000Z', channel: 'beta' }, undefined, { seller: 'shop-b' });
        expect(other.ok && other.entitlement).toMatchObject({ updatesUntil: '2027-09-01T00:00:00.000Z', channel: 'stable', soldBy: 'shop-b' });
    });

    it('a seller extending the author\'s own grant does not change its channel; an earlier date is refused', async () => {
        const s = repo();
        await grantEntitlement(s, AUTHOR, { groupId: G, nodeId: 'aimeat-customer-002', updatesUntil: '2027-01-01T00:00:00.000Z', channel: 'beta' });
        const sale = await grantEntitlement(s, AUTHOR, { groupId: G, nodeId: 'aimeat-customer-002', updatesUntil: '2027-09-01T00:00:00.000Z', channel: 'stable' }, undefined, { seller: 'shop-a' });
        expect(sale.ok && sale.entitlement.channel).toBe('beta');
        const shorter = await grantEntitlement(s, AUTHOR, { groupId: G, nodeId: 'aimeat-customer-002', updatesUntil: '2026-11-01T00:00:00.000Z' }, undefined, { seller: 'shop-b' });
        expect(shorter.ok).toBe(false);
    });
});

describe('PKG-5: a package from another node is never the installer\'s own', () => {
    const base = { authorGhii: 'alice@test-node' } as unknown as PackageRecord;

    it('a package written here by the installer is theirs', () => {
        expect(isOwnPackage(base, 'alice@test-node')).toBe(true);
        expect(isOwnPackage(base, 'bob@test-node')).toBe(false);
    });

    it('a pulled or signed package is not, even when its descriptor names the installer as author', () => {
        const pulled = { ...base, upstream: { node: 'other-node', authorGhii: 'alice@test-node' } } as unknown as PackageRecord;
        expect(isOwnPackage(pulled, 'alice@test-node')).toBe(false);
    });
});

describe('PKG-7: concurrent grants and redeems do not overwrite each other', () => {
    /** A repository store with the compare-and-swap writes the providers have. */
    function casRepo(): Storage {
        const mem = new Map<string, any>();
        const tick = () => new Promise(r => setTimeout(r, 1));
        const id = (o: string, k: string) => `${o}/${k}`;
        return {
            listVersions: async () => { await tick(); return { versions: [{ author: 'alice' }] }; },
            getMemory: async (o: string, k: string) => { await tick(); return mem.get(id(o, k)) ?? null; },
            setMemory: async (rec: any) => { await tick(); mem.set(id(rec.ownerGaii, rec.key), rec); },
            createMemoryIfAbsent: async (rec: any) => { await tick(); if (mem.has(id(rec.ownerGaii, rec.key))) return null; mem.set(id(rec.ownerGaii, rec.key), rec); return rec; },
            setMemoryIfVersion: async (rec: any, v: number) => { await tick(); const cur = mem.get(id(rec.ownerGaii, rec.key)); if (!cur || cur.version !== v) return null; mem.set(id(rec.ownerGaii, rec.key), rec); return rec; },
        } as unknown as Storage;
    }
    const AUTHOR = { owner: 'alice', isOperator: false };

    it('two nodes granted at the same moment both hold the package', async () => {
        const s = casRepo();
        await Promise.all(['aimeat-node-a', 'aimeat-node-b', 'aimeat-node-c'].map(nodeId => grantEntitlement(s, AUTHOR, { groupId: 'g', nodeId })));
        expect((await readEntitlements(s, 'g')).map(e => e.nodeId).sort()).toEqual(['aimeat-node-a', 'aimeat-node-b', 'aimeat-node-c']);
    });

    it('one claim code redeemed four times at once grants one node', async () => {
        const s = casRepo();
        const made = await createClaim(s, { groupId: 'g', seller: 'shop-node' });
        if (!made.ok) throw new Error('claim');
        const key = 'k'.repeat(44);
        const nodes = ['aimeat-r-1', 'aimeat-r-2', 'aimeat-r-3', 'aimeat-r-4'];
        const peers = new Map(nodes.map(n => [n, { nodeId: n, url: `https://${n}.example`, publicKey: key, status: 'active' } as never]));
        const outs = await Promise.all(nodes.map(nodeId => redeemClaim({ storage: s, peers, repository: true }, {
            groupId: 'g', author: 'alice', code: made.claim_code, nodeId, node: { url: `https://${nodeId}.example`, public_key: key },
        })));
        expect(outs.filter(o => o.ok).length).toBe(1);
        expect((await readEntitlements(s, 'g')).length).toBe(1);
    });
});

describe('PKG-8: a grant adds no peer on a node that is not a repository, and never names the node itself', () => {
    function repo(): Storage {
        const mem = new Map<string, any>();
        return {
            listVersions: async () => ({ versions: [{ author: 'alice' }] }),
            getMemory: async (ns: string, key: string) => mem.get(`${ns}/${key}`) ?? null,
            setMemory: async (rec: any) => { mem.set(`${rec.ownerGaii}/${rec.key}`, rec); },
        } as unknown as Storage;
    }
    const AUTHOR = { owner: 'alice', isOperator: false };

    it('refuses this node\'s own id', async () => {
        const out = await grantEntitlement(repo(), AUTHOR, { groupId: 'g', nodeId: 'aimeat-self-001' }, undefined, { thisNodeId: 'aimeat-self-001' });
        expect(out.ok === false && out.code).toBe('INVALID_INPUT');
    });

    it('refuses to register a new node unless this node runs the repository role', async () => {
        const node = { url: 'https://evil.example', public_key: 'k'.repeat(44) };
        const out = await grantEntitlement(repo(), AUTHOR, { groupId: 'g', nodeId: 'aimeat-evil-001', node }, new Map(), { thisNodeId: 'aimeat-self-001' });
        expect(out.ok === false && out.code).toBe('NOT_A_REPOSITORY');
    });

    it('agent resolution and port redirects use only peers that can hold an agent', () => {
        expect(peerCarriesAgents({ status: 'active', allowRouting: false, allowMessaging: false })).toBe(false);
        expect(peerCarriesAgents({ status: 'active', allowRouting: false, allowMessaging: true })).toBe(true);
        expect(peerCarriesAgents({ status: 'active' })).toBe(true);
        expect(peerCarriesAgents({ status: 'suspended' })).toBe(false);
    });
});

describe('PKG-9: only an install set an operator applied names a trusted package source', () => {
    it('an owner\'s own bundle record adds no source; the operator\'s does', async () => {
        const storage = {
            listMemory: async () => [
                { key: 'install-sets.op.set1', value: { bundle: { node_id: 'repo-trusted' }, applied_by: 'op' } },
                { key: 'install-sets.alice.mine', value: { bundle: { node_id: 'repo-alice-chose' }, applied_by: 'alice' } },
                { key: 'install-sets.bot.mine', value: { bundle: { node_id: 'repo-agent-chose' }, applied_by: 'bot#alice@n' } },
                { key: 'install-sets.dco.boot', value: { bundle: { node_id: 'repo-at-startup' }, applied_by: 'startup' } },
            ],
            getOwner: async (name: string) => ({ name, roles: name === 'op' ? ['owner', 'operator'] : ['owner'] }),
            getMemory: async () => null,
        } as unknown as Storage;
        expect([...await installSetRepositories(storage)].sort()).toEqual(['repo-at-startup', 'repo-trusted']);
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
