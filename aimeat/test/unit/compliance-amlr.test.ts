/**
 * @file compliance-amlr.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The anti-money-laundering regulation as a compliance framework, and the customer due
 *   diligence register an obliged organism gets as a draft.
 *
 *   THE VERDICT. One yes makes the organisation an obliged entity with the regulation's duties; all
 *   no is not in scope; one unanswered question leaves it unclassified, because silence is not a no.
 *
 *   THE DRAFT. The register `org-kyc` belongs to an organism that declared itself an obliged entity
 *   (a `declaration` in its compliance document `aml`), and to no other: it lists customers' identity
 *   data, and a draft that put it on every organism would claim processing nobody does.
 * @usage cd aimeat && pnpm exec vitest run test/unit/compliance-amlr.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import { describe, it, expect } from 'vitest';
import { frameworkById } from '../../src/data/compliance-frameworks.js';
import { frameworkVerdicts, organismRegisterDraft } from '../../src/services/compliance/derived.js';
import { registerDrafts } from '../../src/services/compliance/register-drafts.js';
import { RegisterSchema } from '../../src/services/compliance/docs-schemas.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';

const NODE = 'test-node';
const SYSTEM = `system@${NODE}`;
const CONFIG = { nodeId: NODE, consentAuditRetentionDays: 90 } as unknown as AimeatConfig;

const amlr = frameworkById('amlr')!;
const allNo = Object.fromEntries(amlr.questionnaire.questions.map(q => [q.id, false]));
const verdictOf = (answers: Record<string, boolean>) =>
    frameworkVerdicts({ answers: { amlr: answers } }, 'organism').find(v => v.id === 'amlr')!;

const declaration = {
    id: 'd1', type: 'declaration', legalName: 'Alice Tilit Oy', businessId: '1234567-8', sector: 'accounting',
    complianceOfficer: 'alice', scope: 'Bookkeeping for small companies',
};

/** A storage with organisms and the system's compliance records, keyed as services/compliance/docs.ts keys them. */
function storageWith(records: Record<string, unknown>, organisms = ['org-a', 'org-b']): Storage {
    return {
        getOrganism: async (id: string) => (organisms.includes(id) ? { id, name: `Organism ${id}` } : null),
        getMemory: async (owner: string, key: string) => (owner === SYSTEM && key in records ? { key, value: records[key] } : null),
        listAllMemory: async (q: { prefix: string }) => ({
            items: Object.entries(records).filter(([k]) => k.startsWith(q.prefix)).map(([key, value]) => ({ key, value, ownerGaii: SYSTEM })),
        }),
        listApps: async () => ({ apps: [] }),
    } as unknown as Storage;
}

describe('the AMLR framework', () => {
    it('is answered at the node and at an organism, under the EU regulation and directive', () => {
        expect(amlr.scopes).toEqual(['node', 'organism']);
        expect(amlr.laws).toEqual(['Regulation (EU) 2024/1624', 'Directive (EU) 2024/1640']);
        expect(amlr.name.fi).toBe('Rahanpesun estäminen (AMLR)');
    });

    it.each(amlr.questionnaire.questions.map(q => q.id))('one yes (%s) makes an obliged entity with its obligations', (id) => {
        const v = verdictOf({ ...allNo, [id]: true });
        expect(v.verdict.class).toBe('obliged-entity');
        expect(v.obligations).toHaveLength(8);
        for (const art of ['art. 10', 'art. 11', 'art. 19–28', 'art. 29–46', 'art. 69', 'art. 73', 'art. 77', 'art. 80']) {
            expect(v.obligations.some(o => o.includes(art)), art).toBe(true);
        }
        expect(v.obligations.some(o => /sanctions/i.test(o))).toBe(true);
    });

    it('all no is not in scope, with no obligations', () => {
        const v = verdictOf(allNo);
        expect(v.verdict.class).toBe('not-in-scope');
        expect(v.obligations).toEqual([]);
    });

    it('an unanswered question leaves it unclassified, not "not in scope"', () => {
        const rest = Object.fromEntries(Object.entries(allNo).filter(([id]) => id !== 'q-gambling'));
        expect(verdictOf(rest).verdict.class).not.toBe('not-in-scope');
    });
});

describe('the customer due diligence draft', () => {
    const declared = { 'compliance.aml.org.org-a': { items: [declaration] } };

    it('an organism with a declaration gets org-kyc beside its member register, valid against the schema', async () => {
        const items = await organismRegisterDraft(storageWith(declared), 'org-a', { nodeId: NODE });
        expect(items.map(r => r.id)).toEqual(['org-members', 'org-kyc']);
        const kyc = items[1]!;
        expect(RegisterSchema.safeParse(kyc).success).toBe(true);
        expect(kyc.legalBasis).toEqual(['legal-obligation']);
        expect(kyc.retentionMonths).toBe(60);
        expect(kyc.recipients?.[0]).toMatch(/Rahanpesun selvittelykeskus/);
        expect(kyc.answerSources?.dataCategories).toBe('evidence');
        expect(kyc.containers).toEqual([{ kind: 'organism', organism_id: 'org-a' }]);
    });

    it('an organism without a declaration, and a caller that names no node, get the member register only', async () => {
        expect((await organismRegisterDraft(storageWith(declared), 'org-b', { nodeId: NODE })).map(r => r.id)).toEqual(['org-members']);
        expect((await organismRegisterDraft(storageWith(declared), 'org-a')).map(r => r.id)).toEqual(['org-members']);
        expect((await organismRegisterDraft(storageWith({}), 'org-a', { obliged: true })).map(r => r.id)).toEqual(['org-members', 'org-kyc']);
    });

    it('registerDrafts lists the declared organism, and only that one', async () => {
        const places = await registerDrafts({ storage: storageWith(declared), config: CONFIG }, []);
        const orgs = places.filter(p => p.scope.kind === 'organism');
        expect(orgs.map(p => p.scope)).toEqual([{ kind: 'organism', organismId: 'org-a' }]);
        expect(orgs[0]!.items.map(r => r.id)).toEqual(['org-members', 'org-kyc']);
        expect((await registerDrafts({ storage: storageWith({}), config: CONFIG }, [])).some(p => p.scope.kind === 'organism')).toBe(false);
    });

    it('beside a stored register, only the missing org-kyc is drafted; a stored org-kyc ends the draft', async () => {
        const storedOther = [{ scope: { kind: 'organism' as const, organismId: 'org-a' }, doc: { items: [{ id: 'customers' }] } }];
        const places = await registerDrafts({ storage: storageWith(declared), config: CONFIG }, storedOther);
        expect(places.find(p => p.scope.kind === 'organism')!.items.map(r => r.id)).toEqual(['org-kyc']);
        const storedKyc = [{ scope: { kind: 'organism' as const, organismId: 'org-a' }, doc: { items: [{ id: 'org-kyc' }] } }];
        expect((await registerDrafts({ storage: storageWith(declared), config: CONFIG }, storedKyc)).some(p => p.scope.kind === 'organism')).toBe(false);
    });
});
