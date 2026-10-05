/**
 * @file scripts/measure-package-repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The scale measurement the package sale design asks for before a repository opens to
 *   strangers (docs/specs/package-sale-design.md, section 7 "Scale"; phase 5). Seeds a throwaway SQLite
 *   repository with package groups and entitled nodes at a hosting provider's size, and measures what
 *   grows with them: the bytes of one group's entitlements record against the 1024 kB memory value rule
 *   (checked on the memory routes, not on this system-namespace write), and
 *   the time of a customer node's listing (repositoryListing), which reads every entitlements record.
 *   Nothing here touches a running node or any database but its own temporary file.
 * @usage cd aimeat && pnpm exec tsx scripts/measure-package-repository.ts [--groups 200] [--nodes 1000] [--held 5]
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial (package sale design, phase 5).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createStorage } from '../src/storage/storage-factory.js';
import { repositoryListing, NS_PACKAGE_ENTITLEMENTS, type PackageEntitlement } from '../src/services/packages/sale/package-entitlements.js';
import type { PackageRecord } from '../src/storage/interface.js';

const arg = (name: string, fallback: number): number => {
    const i = process.argv.indexOf(`--${name}`);
    const n = i >= 0 ? parseInt(process.argv[i + 1] ?? '', 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
};
const GROUPS = arg('groups', 200);
const NODES = arg('nodes', 1000);
const HELD = arg('held', 5);

const dir = mkdtempSync(join(tmpdir(), 'aimeat-repo-measure-'));
const storage = await createStorage({ provider: 'sqlite', sqlitePath: join(dir, 'repo.db') });
const now = new Date().toISOString();
const nodeId = (i: number) => `aimeat-measure-${String(i).padStart(5, '0')}`;

const t0 = performance.now();
let biggest = 0;
for (let g = 0; g < GROUPS; g++) {
    const groupId = `kit${g}::vendor`;
    const pkg: PackageRecord = {
        id: randomUUID(), packageGroupId: groupId, name: `kit${g}`, author: 'vendor', authorGhii: 'vendor@measure',
        version: 'v2026-10-02-0000', changelog: '', description: 'A measured package', category: 'other', tags: [],
        visibility: 'private', status: 'published', manifest: '', createdAt: now, updatedAt: now,
        components: [{ id: 'app.html', type: 'app', label: 'App', content: '<html></html>', contentHash: 'x', dependencies: [] }],
    };
    await storage.createPackage(pkg);
    // Every node holds HELD groups, spread over all of them; each group holds about NODES of them.
    const nodes: Record<string, PackageEntitlement> = {};
    for (let n = 0; n < NODES; n++) {
        const id = nodeId((g * NODES + n) % Math.max(1, Math.floor(GROUPS * NODES / HELD)));
        nodes[id] = {
            nodeId: id, updatesUntil: '2027-10-02T00:00:00.000Z', channel: 'stable', note: 'sold by aimeat-shop-001: order cs_00000000-0000-0000-0000-000000000000',
            soldBy: 'aimeat-shop-001', terms: { offerTermsId: 't1', price: { amount: 20_000_000, currency: 'EUR' }, renewal: { amount: 5_000_000, currency: 'EUR', period_days: 30 }, acceptedAt: now },
            grantedAt: now, grantedBy: 'vendor', updatedAt: now,
        } as PackageEntitlement;
    }
    const value = { groupId, nodes };
    biggest = Math.max(biggest, Buffer.byteLength(JSON.stringify(value), 'utf8'));
    await storage.setMemory({
        key: `entitlements.${groupId}`, ownerGaii: NS_PACKAGE_ENTITLEMENTS, value, visibility: 'private',
        tags: ['package-entitlements'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
    });
}
const seeded = performance.now() - t0;

const runs: number[] = [];
let rows = 0;
for (let i = 0; i < 5; i++) {
    const s = performance.now();
    rows = (await repositoryListing(storage, nodeId(i * 7), { includePublic: false })).length;
    runs.push(performance.now() - s);
}
runs.sort((a, b) => a - b);

console.log(JSON.stringify({
    groups: GROUPS, nodes_per_group: NODES, groups_per_node: HELD,
    largest_entitlements_record_kb: Math.round(biggest / 1024),
    bytes_per_entitlement: Math.round(biggest / NODES),
    nodes_per_group_at_1024_kb: Math.floor(1024 * 1024 / (biggest / NODES)),
    listing_rows: rows, listing_ms_median: Math.round(runs[2]!), listing_ms_max: Math.round(runs[4]!),
    seed_s: Math.round(seeded / 1000),
}, null, 2));

(storage as unknown as { close?: () => void }).close?.();
rmSync(dir, { recursive: true, force: true });
