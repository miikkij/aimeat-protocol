/**
 * @file test/unit/subdomain-site-origin.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A label a publish gives an app is served only on the app origin, never on the apex
 *   namespace where the node's own pages answer (secaudit2026oct22): apexServesSite decides it from
 *   the row's origin, classifySiteOrigin classifies an older row only on positive evidence, and the
 *   once-only start step writes the classified origins and names the rest on the Security page,
 *   once, leaving them as they were.
 * @usage pnpm exec vitest run test/unit/subdomain-site-origin.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { OwnerRecord, SubdomainSiteRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { apexServesSite, autoLabelCandidates, classifySiteOrigin } from '../../src/services/subdomain-site-origin.js';
import { classifySubdomainSiteOriginsOnce } from '../../src/services/subdomain-site-origin-keep.js';
import { listSecurityIncidents } from '../../src/services/security-incident.js';

const NODE = 'test-node';
const config = { nodeId: NODE } as AimeatConfig;
const HOSTS = { baseUrl: 'https://aimeat.io', appHost: 'apps.aimeat.io', portfolioHost: 'portfolio.aimeat.io', coHost: 'co.aimeat.io', pageHost: 'pages.aimeat.io' };
const AT = '2026-09-01T00:00:00.000Z';

function row(subdomain: string, target: string, createdBy: string, kind: SubdomainSiteRecord['kind'] = 'app'): SubdomainSiteRecord {
    return { subdomain, kind, target, enabled: true, createdBy, createdAt: AT, updatedAt: AT };
}

describe('apexServesSite', () => {
    it('does not serve a publisher\'s label or a node name on the apex', () => {
        expect(apexServesSite({ kind: 'app', origin: 'publisher' }, 'notes', HOSTS)).toBe(false);
        expect(apexServesSite({ kind: 'app', origin: 'operator' }, 'login', HOSTS)).toBe(false);
    });
    it('serves an operator\'s site, an unclassified row and every redirect on the apex', () => {
        expect(apexServesSite({ kind: 'app', origin: 'operator' }, 'notes', HOSTS)).toBe(true);
        expect(apexServesSite({ kind: 'app', origin: null }, 'notes', HOSTS)).toBe(true);
        expect(apexServesSite({ kind: 'app' }, 'notes', HOSTS)).toBe(true);
        expect(apexServesSite({ kind: 'redirect', origin: 'publisher' }, 'login', HOSTS)).toBe(true);
    });
});

describe('autoLabelCandidates', () => {
    it('tries the base, the owner-prefixed base, then numbered bases', () => {
        const c = autoLabelCandidates('alice', 'Notes App.html');
        expect(c.slice(0, 3)).toEqual(['notes-app', 'alice-notes-app', 'notes-app-2']);
        expect(c).toHaveLength(52);
        expect(autoLabelCandidates('alice', 'x.html')[0]).toBe('app-x');
    });
});

describe('classifySiteOrigin', () => {
    const operators = new Set(['op']);
    const isOp = (n: string) => operators.has(n);
    it('a row only the auto-assign writes is the publisher\'s', () => {
        expect(classifySiteOrigin(row('notes', 'alice/notes.html', `alice@${NODE}`), NODE, isOp)).toBe('publisher');
        expect(classifySiteOrigin(row('alice-notes', 'alice/notes.html', `alice@${NODE}`), NODE, isOp)).toBe('publisher');
        expect(classifySiteOrigin(row('notes-7', 'alice/notes.html', `alice@${NODE}`), NODE, isOp)).toBe('publisher');
    });
    it('a row the operator routes wrote is the operator\'s, a redirect included', () => {
        expect(classifySiteOrigin(row('shop', 'alice/notes.html', `op@${NODE}`), NODE, isOp)).toBe('operator');
        expect(classifySiteOrigin(row('shop', 'op/notes.html', `claude#op@${NODE}`), NODE, isOp)).toBe('operator');
        expect(classifySiteOrigin(row('go', 'https://example.com/', `alice@${NODE}`, 'redirect'), NODE, isOp)).toBe('operator');
    });
    it('leaves a row it cannot tell apart unclassified', () => {
        // An operator's own app: the operator could have mapped it by hand with the same values.
        expect(classifySiteOrigin(row('notes', 'op/notes.html', `op@${NODE}`), NODE, isOp)).toBeNull();
        // A label the auto-assign never makes.
        expect(classifySiteOrigin(row('brand', 'alice/notes.html', `alice@${NODE}`), NODE, isOp)).toBeNull();
        // A createdBy an account erasure replaced.
        expect(classifySiteOrigin(row('notes', 'alice/notes.html', 'erased:0a1b2c'), NODE, isOp)).toBeNull();
    });
});

describe('classifySubdomainSiteOriginsOnce', () => {
    let storage: SqliteStorage;
    beforeEach(async () => {
        storage = new SqliteStorage(':memory:');
        await storage.createOwner({ name: 'op', publicKey: 'a2V5', roles: ['owner', 'operator'], createdAt: AT } as OwnerRecord);
        await storage.createOwner({ name: 'alice', publicKey: 'a2V5', roles: ['owner'], createdAt: AT } as OwnerRecord);
    });

    it('writes the classified origins, names the rest once, and changes nothing on a second start', async () => {
        await storage.createSubdomainSite(row('notes', 'alice/notes.html', `alice@${NODE}`));
        await storage.createSubdomainSite(row('shop', 'alice/notes.html', `op@${NODE}`));
        await storage.createSubdomainSite(row('opnotes', 'op/opnotes.html', `op@${NODE}`));
        await storage.createSubdomainSite({ ...row('fixed', 'alice/fixed.html', `op@${NODE}`), origin: 'operator' });

        const out = await classifySubdomainSiteOriginsOnce(storage, config);
        expect(out).toEqual({ operator: 1, publisher: 1, unclassified: ['opnotes'] });
        expect((await storage.getSubdomainSite('notes'))?.origin).toBe('publisher');
        expect((await storage.getSubdomainSite('notes'))?.updatedAt).toBe(AT);
        expect((await storage.getSubdomainSite('shop'))?.origin).toBe('operator');
        expect((await storage.getSubdomainSite('opnotes'))?.origin).toBeNull();
        expect((await storage.getSubdomainSite('fixed'))?.origin).toBe('operator');

        const incidents = (await listSecurityIncidents(storage, config)).items.filter(i => i.type === 'subdomain_site_origin');
        expect(incidents).toHaveLength(1);
        expect(incidents[0]!.detail).toContain('opnotes');
        expect(incidents[0]!.detail).toContain('PATCH /v1/admin/subdomains/{label}');

        expect(await classifySubdomainSiteOriginsOnce(storage, config)).toBeNull();
        expect((await listSecurityIncidents(storage, config)).items.filter(i => i.type === 'subdomain_site_origin')).toHaveLength(1);
    });

    it('reads past one page of rows', async () => {
        for (let i = 0; i < 205; i++) await storage.createSubdomainSite(row(`notes-${i + 2}`, 'alice/notes.html', `alice@${NODE}`));
        await storage.createSubdomainSite(row('zz-shop', 'alice/notes.html', `op@${NODE}`));
        const out = await classifySubdomainSiteOriginsOnce(storage, config);
        // notes-2 .. notes-51 are auto-assign labels; notes-52 and up are not, so they stay undecided.
        expect(out?.publisher).toBe(50);
        expect(out?.unclassified).toHaveLength(155);
        expect(out?.operator).toBe(1);
        expect((await storage.getSubdomainSite('zz-shop'))?.origin).toBe('operator');
    });

    it('opens no incident when every row is classified', async () => {
        await storage.createSubdomainSite(row('notes', 'alice/notes.html', `alice@${NODE}`));
        expect(await classifySubdomainSiteOriginsOnce(storage, config)).toEqual({ operator: 0, publisher: 1, unclassified: [] });
        expect((await listSecurityIncidents(storage, config)).items.filter(i => i.type === 'subdomain_site_origin')).toHaveLength(0);
    });
});
