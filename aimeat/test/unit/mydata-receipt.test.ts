import { describe, it, expect } from 'vitest';
import { createMyDataReceiptService } from '../../src/services/mydata-receipt.js';
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

        it('has jurisdiction FI', () => {
            const service = createMyDataReceiptService(makeConfig());
            const receipt = service.generateReceipt(makeConsent());
            expect(receipt.jurisdiction).toBe('FI');
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
