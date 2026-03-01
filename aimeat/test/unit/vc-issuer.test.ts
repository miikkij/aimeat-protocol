import { describe, it, expect } from 'vitest';
import { createVcIssuerService } from '../../src/services/vc-issuer.js';
import type { AimeatConfig } from '../../src/config.js';
import type { GHIIRecord } from '../../src/storage/interface.js';

// ── Helpers ──────────────────────────────────────────────────

function makeConfig(overrides: Partial<AimeatConfig> = {}): AimeatConfig {
    return {
        nodeId: 'test-node-001',
        vcIssuerDid: '',
        ...overrides,
    } as AimeatConfig;
}

function makeGHIIRecord(overrides: Partial<GHIIRecord> = {}): GHIIRecord {
    return {
        username: 'alice',
        nodeId: 'test-node-001',
        ghii: 'alice@test-node-001',
        displayName: 'Alice Test',
        verificationLevel: 1 as 0 | 1 | 2,
        ownerName: 'alice',
        totpEnabled: false,
        createdAt: '2024-06-15T10:00:00.000Z',
        updatedAt: '2024-06-15T10:00:00.000Z',
        ...overrides,
    };
}

// ── Tests ────────────────────────────────────────────────────

describe('VC Issuer Service', () => {
    describe('issueIdentityCredential', () => {
        it('returns correct @context', () => {
            const service = createVcIssuerService(makeConfig());
            const vc = service.issueIdentityCredential(makeGHIIRecord());
            expect(vc['@context']).toEqual([
                'https://www.w3.org/ns/credentials/v2',
                'https://aimeat.spechops.com/ns/credentials/v1',
            ]);
        });

        it('has type VerifiableCredential and AIMEATIdentityCredential', () => {
            const service = createVcIssuerService(makeConfig());
            const vc = service.issueIdentityCredential(makeGHIIRecord());
            expect(vc.type).toEqual(['VerifiableCredential', 'AIMEATIdentityCredential']);
        });

        it('includes correct default issuer DID based on nodeId', () => {
            const service = createVcIssuerService(makeConfig({ vcIssuerDid: '' }));
            const vc = service.issueIdentityCredential(makeGHIIRecord());
            expect(vc.issuer).toBe('did:web:test-node-001.aimeat.example');
        });

        it('uses custom vcIssuerDid from config when provided', () => {
            const service = createVcIssuerService(makeConfig({ vcIssuerDid: 'did:web:custom.example.com' }));
            const vc = service.issueIdentityCredential(makeGHIIRecord());
            expect(vc.issuer).toBe('did:web:custom.example.com');
        });

        it('has GHII-based id in credential subject', () => {
            const service = createVcIssuerService(makeConfig());
            const vc = service.issueIdentityCredential(makeGHIIRecord({ ghii: 'bob@test-node-002' }));
            expect(vc.credentialSubject.id).toBe('did:aimeat:bob@test-node-002');
        });

        it('includes verificationLevel in credential subject', () => {
            const service = createVcIssuerService(makeConfig());
            const vc = service.issueIdentityCredential(makeGHIIRecord({ verificationLevel: 2 }));
            expect(vc.credentialSubject.verificationLevel).toBe(2);
        });

        it('includes memberSince (date only from createdAt)', () => {
            const service = createVcIssuerService(makeConfig());
            const vc = service.issueIdentityCredential(makeGHIIRecord({ createdAt: '2024-06-15T10:30:00.000Z' }));
            expect(vc.credentialSubject.memberSince).toBe('2024-06-15');
        });

        it('has issuanceDate set', () => {
            const service = createVcIssuerService(makeConfig());
            const vc = service.issueIdentityCredential(makeGHIIRecord());
            expect(vc.issuanceDate).toBeTruthy();
            // Validate ISO format
            expect(() => new Date(vc.issuanceDate)).not.toThrow();
            expect(new Date(vc.issuanceDate).getTime()).toBeGreaterThan(0);
        });
    });
});
