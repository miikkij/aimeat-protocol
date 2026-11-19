/**
 * @file test/unit/aml-mode.test.ts
 * @description The pure parts of the anti-money-laundering section (services/aml/; decision
 *   decision-aml-velvoitteet-ovat-operaattorin-aktivoima-tila): the setting's parser, the findings built
 *   from facts (every kind present, proposed until reviewed, the per-declaration kinds named after their
 *   organism, the mode proposal only where the mode does not already allow owners), and the obligation
 *   rows per mode.
 * @version-history
 *   2026-11-19 — The facts carry the cash vouchers (AMLR art. 80): the finding cash_over_limit and the row
 *     aml-ob-cash, both on the node's view only.
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design, stage A).
 */
import { describe, it, expect } from 'vitest';
import { parseAmlMode } from '../../src/config/data-access.js';
import { AML_FINDING_KINDS } from '../../src/services/aml/contract.js';
import { buildAmlFindings, type AmlFacts } from '../../src/services/aml/findings.js';
import { amlObligations } from '../../src/services/aml/report.js';
import type { AmlDeclaration } from '../../src/services/compliance/docs-schemas.js';

const NOW = '2026-11-19T12:00:00.000Z';

const decl = (over: Partial<AmlDeclaration> = {}): AmlDeclaration => ({
    id: 'd1', type: 'declaration', legalName: 'Alice Tilit Oy', businessId: '1234567-8', sector: 'accounting',
    complianceOfficer: 'alice', scope: 'Bookkeeping for small companies', ...over,
});

const facts = (over: Partial<AmlFacts> = {}): AmlFacts => ({
    mode: 'report', owner: null, now: NOW, declarations: [], reviews: new Map(),
    splitsForOthers: [], cryptoPayouts: [], agentLimits: [], sellers: [], personalServices: [], traders: [],
        kyc: { lists: [], cards: 0, due: 0, notScreened: 0 }, cash: { recorded: 0, cash: 0, otherCurrency: 0, overLimit: [] }, ...over,
});

const overItem = { owner: 'alice', direction: 'income' as const, counterparty: 'Bob', total: 1_000_001, currency: 'EUR' as const, count: 1, from: '2026-11-01', to: '2026-11-01', voucherIds: ['v1'] };

const orgDecl = (d: AmlDeclaration, organismId = 'org-1') => ({ scope: { kind: 'organism' as const, organismId }, declaration: d, organismName: 'Alice Tilit' });

describe('parseAmlMode', () => {
    it('reads the four modes and makes anything else report, the mode that refuses nothing', () => {
        for (const m of ['report', 'none', 'owners', 'node'] as const) expect(parseAmlMode(m)).toBe(m);
        expect(parseAmlMode(undefined)).toBe('report');
        expect(parseAmlMode('NODE')).toBe('report');
    });
});

describe('buildAmlFindings', () => {
    it('holds every kind with count 0 on an empty node, each citing a regulation, all proposed', () => {
        const out = buildAmlFindings(facts());
        expect(new Set(out.map(f => f.kind))).toEqual(new Set(AML_FINDING_KINDS));
        for (const f of out) {
            expect(f.count).toBe(0);
            expect(f.regulation.length).toBeGreaterThan(0);
            expect(f.source).toBe('proposed');
            expect(f.reason.length).toBeGreaterThan(10);
        }
    });

    it('proposes mode owners for a declared organism only while the mode does not allow it', () => {
        const d = [orgDecl(decl({ complianceManager: 'carol', deputy: 'bob' }))];
        const inReport = buildAmlFindings(facts({ declarations: d })).find(f => f.id === 'org_declares_obliged')!;
        expect(inReport.count).toBe(1);
        expect(inReport.proposal?.action).toBe('set_mode_owners');
        expect(inReport.proposal?.request?.body).toEqual({ changes: [{ path: 'compliance.aml_mode', value: 'owners' }] });
        const inOwners = buildAmlFindings(facts({ mode: 'owners', declarations: d })).find(f => f.id === 'org_declares_obliged')!;
        expect(inOwners.proposal).toBeUndefined();
    });

    it('names a declaration with roles, registration or assessment missing after its organism', () => {
        const out = buildAmlFindings(facts({ mode: 'owners', declarations: [orgDecl(decl())] }));
        expect(out.find(f => f.id === 'roles_incomplete:org-1')?.count).toBe(1);
        expect(out.find(f => f.id === 'registration_missing:org-1')?.count).toBe(1);
        expect(out.find(f => f.id === 'risk_assessment_stale:org-1')?.count).toBe(1);
        expect(out.some(f => f.id === 'roles_incomplete')).toBe(false);
    });

    it('reads a complete, current declaration as nothing left open', () => {
        const full = decl({ complianceManager: 'carol', deputy: 'bob', supervisorRegisteredAt: '2026-01-02', fiuRegisteredAt: '2026-01-03', riskAssessmentAt: '2026-06-01' });
        const out = buildAmlFindings(facts({ mode: 'owners', declarations: [orgDecl(full)] }));
        for (const k of ['roles_incomplete', 'registration_missing', 'risk_assessment_stale']) expect(out.find(f => f.id === k)?.count).toBe(0);
        const stale = buildAmlFindings(facts({ mode: 'owners', declarations: [orgDecl({ ...full, riskAssessmentAt: '2025-06-01' })] }));
        expect(stale.find(f => f.id === 'risk_assessment_stale:org-1')?.count).toBe(1);
    });

    it('reports a missing declaration in modes owners and node only', () => {
        expect(buildAmlFindings(facts({ mode: 'report' })).find(f => f.id === 'declaration_missing')!.count).toBe(0);
        expect(buildAmlFindings(facts({ mode: 'owners' })).find(f => f.id === 'declaration_missing')!.count).toBe(1);
        const node = buildAmlFindings(facts({ mode: 'node', declarations: [orgDecl(decl())] })).find(f => f.id === 'declaration_missing')!;
        expect(node.count).toBe(1);
        expect(node.proposal?.action).toBe('record_declaration');
    });

    it('counts sellers, splits, payouts, agents and offerings from the facts', () => {
        const out = buildAmlFindings(facts({
            sellers: [{ owner: 'alice', rails: ['card'] }, { owner: 'bob', rails: ['stablecoin'] }],
            splitsForOthers: [{ provider: 'alice', capability: 'translate', beneficiaries: 2 }],
            cryptoPayouts: [{ from: 'alice', beneficiary: 'carol', count: 3 }],
            agentLimits: [{ owner: 'alice', agents: 2 }],
            personalServices: [{ offeringId: 'o1', title: 'Bookkeeping', provider: 'bob' }],
            traders: [{ provider: 'bob', offerings: 4 }],
        }));
        const count = (id: string) => out.find(f => f.id === id)!.count;
        expect(count('payers_not_screened')).toBe(2);
        expect(count('payouts_for_others')).toBe(1);
        expect(count('crypto_for_others')).toBe(3);
        expect(count('agent_spends_money')).toBe(2);
        expect(count('personal_services_sold')).toBe(1);
        expect(count('marketplace_traders')).toBe(1);
    });

    it('reports cash payments over the art. 80 limit for every business, and leaves the finding out of an owner\'s slice', () => {
        const none = buildAmlFindings(facts()).find(f => f.kind === 'cash_over_limit')!;
        expect(none.count).toBe(0);
        expect(none.regulation.map(r => r.ref)).toEqual(['art. 80']);
        const hit = buildAmlFindings(facts({ cash: { recorded: 3, cash: 2, otherCurrency: 1, overLimit: [overItem] } })).find(f => f.kind === 'cash_over_limit')!;
        expect(hit.count).toBe(1);
        expect(hit.items[0]).toMatchObject({ owner: 'alice', total: 1_000_001, voucherIds: ['v1'] });
        expect(hit.reason).toMatch(/every business/);
        expect(hit.reason).toMatch(/Only vouchers in EUR/);
        expect(hit.proposal?.action).toBe('review_cash_payments');
        expect(buildAmlFindings(facts({ owner: 'alice', cash: null })).some(f => f.kind === 'cash_over_limit')).toBe(false);
    });

    it('turns a reviewed finding human, with the decision', () => {
        const reviews = new Map([['payers_not_screened', { id: 'payers_not_screened', type: 'review' as const, decision: 'dismissed' as const, note: 'test node' }]]);
        const f = buildAmlFindings(facts({ reviews })).find(x => x.id === 'payers_not_screened')!;
        expect(f.source).toBe('human');
        expect(f.review?.decision).toBe('dismissed');
    });
});

describe('amlObligations', () => {
    it('reads custody as evidence always, and the obliged duties as not applicable on a node with no obliged work', () => {
        const rows = amlObligations(facts(), { ftnEnabled: false });
        expect(rows.find(r => r.code === 'aml-ob-custody')!.status).toBe('evidence');
        expect(rows.find(r => r.code === 'aml-ob-sanctions')!.status).toBe('not_applicable');
        for (const code of ['aml-ob-risk-assessment', 'aml-ob-roles', 'aml-ob-cdd', 'aml-ob-monitoring', 'aml-ob-reporting', 'aml-ob-retention']) {
            expect(rows.find(r => r.code === code)!.status).toBe('not_applicable');
        }
    });

    it('reads customer due diligence once obliged work is allowed: screening needs a fetched list, the hold and the calendar are there', () => {
        const noList = amlObligations(facts({ mode: 'owners', sellers: [{ owner: 'alice', rails: ['card'] }] }), { ftnEnabled: true });
        expect(noList.find(r => r.code === 'aml-ob-sanctions')!.status).toBe('missing');
        expect(noList.find(r => r.code === 'aml-ob-retention')!.status).toBe('evidence');
        expect(noList.find(r => r.code === 'aml-ob-monitoring')!.status).toBe('evidence');
        expect(noList.find(r => r.code === 'aml-ob-cdd')!.status).toBe('evidence');
        const lists = [{ source: 'eu-fsf', entries: 6000, fetchedAt: '2026-11-19T05:10:00.000Z' }, { source: 'un', entries: 1000, fetchedAt: '2026-11-19T05:10:00.000Z' }];
        const withLists = amlObligations(facts({ mode: 'owners', kyc: { lists, cards: 3, due: 1, notScreened: 0 } }), { ftnEnabled: false });
        expect(withLists.find(r => r.code === 'aml-ob-sanctions')!.status).toBe('evidence');
        expect(withLists.find(r => r.code === 'aml-ob-monitoring')!.status).toBe('check');
        expect(withLists.find(r => r.code === 'aml-ob-cdd')!.status).toBe('check');
        const unscreened = amlObligations(facts({ mode: 'owners', kyc: { lists, cards: 3, due: 0, notScreened: 2 } }), { ftnEnabled: true });
        expect(unscreened.find(r => r.code === 'aml-ob-sanctions')!.status).toBe('check');
    });

    it('reads the cash limit in every mode: not applicable with no payment method recorded, evidence, check; absent in a slice', () => {
        const cash = (over: Partial<AmlFacts>) => amlObligations(facts(over), { ftnEnabled: false }).find(r => r.code === 'aml-ob-cash');
        expect(cash({})!.status).toBe('not_applicable');
        expect(cash({ cash: { recorded: 4, cash: 1, otherCurrency: 0, overLimit: [] } })!.status).toBe('evidence');
        expect(cash({ mode: 'none', cash: { recorded: 4, cash: 2, otherCurrency: 0, overLimit: [overItem] } })!.status).toBe('check');
        expect(cash({ owner: 'alice', cash: null })).toBeUndefined();
    });
});
