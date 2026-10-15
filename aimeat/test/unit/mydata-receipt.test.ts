import { describe, it, expect } from 'vitest';
import { createMyDataReceiptService, consentCollectionMethod } from '../../src/services/mydata-receipt.js';
import type { AimeatConfig } from '../../src/config.js';
import type { ConsentRecord } from '../../src/storage/interface.js';

// ── Helpers ──────────────────────────────────────────────────

function makeConfig(overrides: Partial<AimeatConfig> = {}): AimeatConfig {
    return {
        nodeId: 'test-node-001',
        ...overrides,
    } as AimeatConfig;
}

function makeConsent(overrides: Partial<ConsentRecord> = {}): ConsentRecord {
    return {
        id: 'consent-001',
        ownerGaii: 'alice/agent-1@test-node-001',
        dataPattern: 'profile.*.interests',
        recipient: '*',
        purpose: 'discovery',
        scope: 'dmz',
        expires: null,
        status: 'active',
        grantedAt: '2024-06-15T10:00:00.000Z',
        revokedAt: null,
        ...overrides,
    };
}

// ── Tests ────────────────────────────────────────────────────

describe('MyData Receipt Service', () => {
    describe('generateReceipt', () => {
        it('returns version KI-CR-v1.1.0', () => {
            const service = createMyDataReceiptService(makeConfig());
            const receipt = service.generateReceipt(makeConsent());
            expect(receipt.version).toBe('KI-CR-v1.1.0');
        });

        // Feature-list audit #161: FI, fi and "web form" were written for every node and consent.
        it('takes the jurisdiction from the operator country setting', () => {
            const op = (country: string) => makeConfig({ operator: { country } as AimeatConfig['operator'] });
            expect(createMyDataReceiptService(op('Finland')).generateReceipt(makeConsent()).jurisdiction).toBe('FI');
            expect(createMyDataReceiptService(op('Spain')).generateReceipt(makeConsent()).jurisdiction).toBe('ES');
            expect(createMyDataReceiptService(op('se')).generateReceipt(makeConsent()).jurisdiction).toBe('SE');
            expect(createMyDataReceiptService(op('Atlantis')).generateReceipt(makeConsent()).jurisdiction).toBe('Atlantis');
            expect(createMyDataReceiptService(op('')).generateReceipt(makeConsent()).jurisdiction).toBe('unspecified');
        });

        it('takes the language from the person, else the node default', () => {
            const service = createMyDataReceiptService(makeConfig());
            expect(service.generateReceipt(makeConsent(), { language: 'es' }).language).toBe('es');
            expect(service.generateReceipt(makeConsent()).language).toBe('en');
        });

        it('takes the collection method from how the consent was given', () => {
            const service = createMyDataReceiptService(makeConfig());
            expect(service.generateReceipt(makeConsent({ metadata: { collection_method: 'API call by an agent' } })).collectionMethod).toBe('API call by an agent');
            expect(service.generateReceipt(makeConsent()).collectionMethod).toBe('not recorded');
        });

        it('names the way of giving from the caller', () => {
            expect(consentCollectionMethod('rest', { kind: 'owner', inPerson: true })).toBe('web form');
            expect(consentCollectionMethod('rest', { kind: 'agent', inPerson: false })).toBe('API call by an agent');
            expect(consentCollectionMethod('mcp', { kind: 'agent', inPerson: false })).toBe('MCP tool call by an agent');
            expect(consentCollectionMethod('mcp', { kind: 'owner', inPerson: true })).toBe('MCP tool call by the person');
        });

        it('has piiPrincipalId matching consent owner', () => {
            const service = createMyDataReceiptService(makeConfig());
            const consent = makeConsent({ ownerGaii: 'bob/agent-2@node-002' });
            const receipt = service.generateReceipt(consent);
            expect(receipt.piiPrincipalId).toBe('bob/agent-2@node-002');
        });

        it('has service name including consent purpose', () => {
            const service = createMyDataReceiptService(makeConfig());
            const consent = makeConsent({ purpose: 'marketplace' });
            const receipt = service.generateReceipt(consent);
            expect(receipt.services).toHaveLength(1);
            expect(receipt.services[0].service).toBe('AIMEAT marketplace');
            expect(receipt.services[0].purposes[0].purpose).toBe('marketplace');
        });

        it('has piiController matching node ID', () => {
            const service = createMyDataReceiptService(makeConfig({ nodeId: 'my-custom-node' }));
            const receipt = service.generateReceipt(makeConsent());
            expect(receipt.piiControllers).toHaveLength(1);
            expect(receipt.piiControllers[0].piiController).toBe('my-custom-node');
            expect(receipt.piiControllers[0].onBehalf).toBe(false);
        });

        it('handles consent with expiry (termination = expiry)', () => {
            const service = createMyDataReceiptService(makeConfig());
            const consent = makeConsent({ expires: '2025-12-31T23:59:59.000Z' });
            const receipt = service.generateReceipt(consent);
            expect(receipt.services[0].purposes[0].termination).toBe('expiry');
        });

        it('handles consent without expiry (termination = revocation)', () => {
            const service = createMyDataReceiptService(makeConfig());
            const consent = makeConsent({ expires: null });
            const receipt = service.generateReceipt(consent);
            expect(receipt.services[0].purposes[0].termination).toBe('revocation');
        });
    });
});
