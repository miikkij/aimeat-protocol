/**
 * @file test/unit/data-intermediation.test.ts
 * @description The pure parts of the data intermediation section (plan doc-mvwxcas3dom3, D7.3, D7.4,
 *   D7.6): the Article 12 rows and their status per mode, the findings built from facts (always (a) to
 *   (e), each citing the regulation, proposed until reviewed, an open organism with the proposal to
 *   require approval), and which offering delivers data.
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D7.3, D7.4, D7.6).
 */
import { describe, it, expect } from 'vitest';
import { art12Rows, type Art12Input } from '../../src/services/data-intermediation/art12.js';
import { buildFindings, type IntermediationFacts } from '../../src/services/data-intermediation/findings.js';
import { offeringDeliversData } from '../../src/services/data-intermediation/contract.js';

const base: Art12Input = {
    mode: 'report', notificationLegalName: null, providerOrganisms: 0, packages: 3, dcatOpen: true, dataspaceProtocol: false,
    consentEnabled: true, consentAuditRetentionDays: 365, activeConsents: 4, liveNamedShares: 1, breachesRecorded: 0,
};

describe('art12Rows', () => {
    it('has the eight points in order', () => {
        expect(art12Rows(base).map(r => r.point)).toEqual(['a', 'c', 'd', 'h', 'i', 'k', 'n', 'o']);
    });
    it('reads (a) missing when the node provides the service with no notification, check with one', () => {
        expect(art12Rows({ ...base, mode: 'node' })[0]!.status).toBe('missing');
        expect(art12Rows({ ...base, mode: 'node', notificationLegalName: 'Esimerkki Oy' })[0]!.status).toBe('check');
        expect(art12Rows({ ...base, mode: 'owners', providerOrganisms: 1 })[0]!.status).toBe('check');
        expect(art12Rows(base)[0]!.status).toBe('check');
    });
    it('states that no node-side path reads exchanged data, and names one when it does', () => {
        expect(art12Rows(base)[0]!.evidence.node_side_readers_of_exchanged_data).toEqual([]);
        const named = art12Rows({ ...base, readers: ['analytics/rollup'] })[0]!;
        expect(named.text).toContain('analytics/rollup');
    });
    it('reads (i) check on a node that lists nothing outside, (n) missing with consent off', () => {
        const rows = art12Rows({ ...base, dcatOpen: false, consentEnabled: false });
        expect(rows.find(r => r.point === 'i')!.status).toBe('check');
        expect(rows.find(r => r.point === 'n')!.status).toBe('missing');
        expect(rows.find(r => r.point === 'o')!.status).toBe('check');
    });
    it('gives every row evidence and a text', () => {
        for (const r of art12Rows(base)) {
            expect(Object.keys(r.evidence).length).toBeGreaterThan(0);
            expect(r.text.length).toBeGreaterThan(10);
            expect(['evidence', 'check', 'missing']).toContain(r.status);
        }
    });
});

const facts = (over: Partial<IntermediationFacts> = {}): IntermediationFacts => ({
    mode: 'report', owner: null, nodeNotification: null, providers: [],
    dataOfferings: [], outsideContracts: [], openOrganisms: [], appsOpenRegistration: [], appRegistrationSettingPresent: false,
    pricedShares: [], personParties: [], exchangedPackages: [], nodeAiReadsFiles: false, reviews: new Map(),
    counts: { packages: 0, liveShares: 0, parties: 0, consents: 0 }, ...over,
});

describe('buildFindings', () => {
    it('always holds (a) to (e), with count 0 when nothing matches, each citing the regulation', () => {
        const out = buildFindings(facts());
        expect(out.map(f => f.kind)).toEqual(['data_offering_public', 'contract_outside_buyer', 'open_organism_with_data', 'app_open_registration_commerce', 'priced_named_share']);
        for (const f of out) {
            expect(f.count).toBe(0);
            expect(f.regulation.length).toBeGreaterThan(0);
            expect(f.regulation.every(r => r.act === '2022/868')).toBe(true);
            expect(f.source).toBe('proposed');
        }
    });
    it('counts the data offerings and the outside contracts, with a reason', () => {
        const out = buildFindings(facts({
            dataOfferings: [{ offeringId: 'o1', title: 'Firms', providerOwner: 'alice', kind: 'ext-action' }],
            outsideContracts: [{ entitlementId: 'e1', provider: 'alice', buyer: 'bob', capability: 'prh/get', buyerKind: 'account' }],
        }));
        const a = out.find(f => f.kind === 'data_offering_public')!;
        expect(a.count).toBe(1);
        expect(a.reason).toContain('listed to everyone');
        expect(a.regulation.map(r => r.ref)).toContain('recital 28');
        expect(out.find(f => f.kind === 'contract_outside_buyer')!.items[0]).toMatchObject({ buyer: 'bob' });
    });
    it('proposes approval for an open organism with data, and does not change it', () => {
        const out = buildFindings(facts({ openOrganisms: [{ id: 'org-1', name: 'Open club', packages: ['pkg:alice/club'] }] }));
        const c = out.find(f => f.kind === 'open_organism_with_data')!;
        expect(c.id).toBe('open_organism_with_data:org-1');
        expect(c.proposal?.request).toEqual({ method: 'PUT', url: '/v1/organisms/org-1', body: { join_policy: 'approval_required' } });
        expect(c.regulation.map(r => r.ref)).toContain('art. 2(11)(c)');
    });
    it('reads a reviewed finding as the person\'s', () => {
        const out = buildFindings(facts({ reviews: new Map([['data_offering_public', { id: 'data_offering_public', type: 'review', decision: 'dismissed', note: 'own data only' }]]) }));
        const a = out.find(f => f.kind === 'data_offering_public')!;
        expect(a.source).toBe('human');
        expect(a.review).toMatchObject({ decision: 'dismissed', note: 'own data only' });
    });
    it('notes a missing notification in mode node, and none with one', () => {
        expect(buildFindings(facts({ mode: 'node' })).some(f => f.kind === 'notification_missing')).toBe(true);
        expect(buildFindings(facts({ mode: 'node', nodeNotification: { id: 'n', type: 'notification', legalName: 'X Oy', businessId: '1234567-8', scope: 'EXCHANGE' } })).some(f => f.kind === 'notification_missing')).toBe(false);
        expect(buildFindings(facts({ mode: 'report' })).some(f => f.kind === 'notification_missing')).toBe(false);
    });
    it('names the person parties whose contact an account holds (D2.10)', () => {
        const f = buildFindings(facts({ personParties: [{ owner: 'alice', count: 2 }] })).find(x => x.kind === 'person_party_contact')!;
        expect(f.owner).toBe('alice');
        expect(f.reason).toContain('records of processing');
    });
    it('finds the node\'s own AI reading exchanged data in mode node only', () => {
        const pkgs = [{ offeringId: 'o9', title: 'Sold package' }];
        expect(buildFindings(facts({ mode: 'node', exchangedPackages: pkgs, nodeAiReadsFiles: true })).some(f => f.kind === 'node_ai_reads_exchanged_data')).toBe(true);
        expect(buildFindings(facts({ mode: 'node', exchangedPackages: pkgs, nodeAiReadsFiles: false })).some(f => f.kind === 'node_ai_reads_exchanged_data')).toBe(false);
        expect(buildFindings(facts({ mode: 'report', exchangedPackages: pkgs, nodeAiReadsFiles: true })).some(f => f.kind === 'node_ai_reads_exchanged_data')).toBe(false);
    });
});

describe('offeringDeliversData', () => {
    it('reads the stated field first, then the kind', () => {
        expect(offeringDeliversData({ kind: 'ext-action' })).toBe(true);
        expect(offeringDeliversData({ kind: 'datapackage' })).toBe(true);
        expect(offeringDeliversData({ kind: 'app-tool' })).toBe(false);
        expect(offeringDeliversData({ kind: 'agent-work' })).toBe(false);
        expect(offeringDeliversData({ kind: 'ext-action', deliversData: false })).toBe(false);
        expect(offeringDeliversData({ kind: 'app-tool', deliversData: true })).toBe(true);
    });
});
