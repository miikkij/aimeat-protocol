/**
 * @file eudiw-verifier.test.ts
 * @description Unit tests for the EUDIW verification service
 * @version-history
 *   v1.0.0 — 2026-03-01 — Initial test suite
 *   v2.0.0 — 2026-05-02 — Updated for real SD-JWT verification
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { createEudiwService } from '../../src/services/eudiw.js';
import type { EudiwService } from '../../src/services/eudiw.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, TrustedIssuerRecord } from '../../src/storage/interface.js';
import { createSdJwtVerifier } from '../../src/services/sd-jwt.js';
import { generateTestKeyPair, createTestSdJwt, type TestKeyPair } from '../helpers/test-sd-jwt.js';

// ── Helpers ──────────────────────────────────────────────────

let testKeyPair: TestKeyPair;

beforeAll(async () => {
    testKeyPair = await generateTestKeyPair('EdDSA');
});

function makeConfig(overrides: Partial<AimeatConfig> = {}): AimeatConfig {
    return {
        nodeId: 'test-node-001',
        baseUrl: 'http://localhost:40050',
        eudiwEnabled: true,
        eudiwClientId: 'aimeat-verifier-001',
        eudiwRedirectUri: '',
        ...overrides,
    } as AimeatConfig;
}

function makeMockStorage(trustedIssuers: Map<string, TrustedIssuerRecord> = new Map()) {
    return {
        getTrustedIssuerByUrl: vi.fn(async (url: string) => {
            for (const issuer of trustedIssuers.values()) {
                if (issuer.url === url) return issuer;
            }
            return null;
        }),
        listTrustedIssuers: vi.fn(async (_opts?: { type?: string }) => {
            return [...trustedIssuers.values()];
        }),
    } as unknown as Storage;
}

function makeTrustedIssuer(url: string, trusted = true, publicKeyJwk?: object): TrustedIssuerRecord {
    return {
        id: `issuer-${Math.random().toString(36).slice(2, 8)}`,
        name: 'Test Issuer',
        url,
        publicKey: JSON.stringify(publicKeyJwk ?? testKeyPair.publicJwk),
        type: 'eudiw',
        trusted,
        addedBy: 'operator',
        createdAt: new Date().toISOString(),
    };
}

// ── Tests ────────────────────────────────────────────────────

describe('EUDIW Service', () => {
    let service: EudiwService;
    let trustedIssuers: Map<string, TrustedIssuerRecord>;

    beforeEach(() => {
        trustedIssuers = new Map();
    });

    describe('enabled state', () => {
        it('reports enabled when config.eudiwEnabled is true', () => {
            const storage = makeMockStorage();
            service = createEudiwService(makeConfig({ eudiwEnabled: true }), storage, createSdJwtVerifier());
            expect(service.enabled).toBe(true);
        });

        it('reports disabled when config.eudiwEnabled is false', () => {
            const storage = makeMockStorage();
            service = createEudiwService(makeConfig({ eudiwEnabled: false }), storage, createSdJwtVerifier());
            expect(service.enabled).toBe(false);
        });
    });

    describe('generateAuthorizationRequest', () => {
        it('returns valid OpenID4VP structure', () => {
            const storage = makeMockStorage();
            service = createEudiwService(makeConfig(), storage, createSdJwtVerifier());
            const request = service.generateAuthorizationRequest('test-state-123');
            expect(request.response_type).toBe('vp_token');
            expect(request.response_mode).toBe('direct_post');
            expect(request.state).toBe('test-state-123');
            expect(request.nonce).toBeTruthy();
        });

        it('contains correct client_id from config', () => {
            const storage = makeMockStorage();
            service = createEudiwService(makeConfig({ eudiwClientId: 'my-custom-verifier' }), storage, createSdJwtVerifier());
            const request = service.generateAuthorizationRequest('state-1');
            expect(request.client_id).toBe('my-custom-verifier');
        });

        it('contains presentation_definition with input descriptors', () => {
            const storage = makeMockStorage();
            service = createEudiwService(makeConfig(), storage, createSdJwtVerifier());
            const request = service.generateAuthorizationRequest('state-1');
            const pd = request.presentation_definition as Record<string, unknown>;
            expect(pd).toBeTruthy();
            expect(pd.id).toBe('aimeat-identity-verification');
            const descriptors = pd.input_descriptors as Array<Record<string, unknown>>;
            expect(descriptors).toHaveLength(1);
            expect(descriptors[0].id).toBe('identity-credential');
        });

        it('uses fallback redirect_uri when eudiwRedirectUri is empty', () => {
            const storage = makeMockStorage();
            service = createEudiwService(makeConfig({ eudiwRedirectUri: '', baseUrl: 'http://localhost:40050' }), storage, createSdJwtVerifier());
            const request = service.generateAuthorizationRequest('state-1');
            expect(request.redirect_uri).toBe('http://localhost:40050/v1/ghii/verify/eudiw/callback');
        });

        it('uses custom redirect_uri when eudiwRedirectUri is set', () => {
            const storage = makeMockStorage();
            service = createEudiwService(makeConfig({ eudiwRedirectUri: 'https://custom.example.com/cb' }), storage, createSdJwtVerifier());
            const request = service.generateAuthorizationRequest('state-1');
            expect(request.redirect_uri).toBe('https://custom.example.com/cb');
        });
    });

    describe('verifyPresentation', () => {
        it('rejects invalid SD-JWT format', async () => {
            const storage = makeMockStorage();
            service = createEudiwService(makeConfig(), storage, createSdJwtVerifier());
            const result = await service.verifyPresentation('not-a-valid-token', {});
            expect(result.valid).toBe(false);
        });

        it('rejects untrusted issuers', async () => {
            const storage = makeMockStorage();
            service = createEudiwService(makeConfig(), storage, createSdJwtVerifier());
            const token = await createTestSdJwt(
                { given_name: 'Eve' },
                'https://unknown-issuer.com',
                testKeyPair,
            );
            const result = await service.verifyPresentation(token, {});
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Untrusted issuer');
        });

        it('rejects issuer marked as untrusted', async () => {
            const issuerUrl = 'https://untrusted.example.com';
            const issuer = makeTrustedIssuer(issuerUrl, false);
            trustedIssuers.set(issuer.id, issuer);
            const storage = makeMockStorage(trustedIssuers);
            service = createEudiwService(makeConfig(), storage, createSdJwtVerifier());

            const token = await createTestSdJwt({ given_name: 'Eve' }, issuerUrl, testKeyPair);
            const result = await service.verifyPresentation(token, {});
            expect(result.valid).toBe(false);
        });

        it('rejects token signed with wrong key', async () => {
            const issuerUrl = 'https://trusted-issuer.example.com';
            const wrongKeyPair = await generateTestKeyPair('EdDSA');
            const issuer = makeTrustedIssuer(issuerUrl, true);
            trustedIssuers.set(issuer.id, issuer);
            const storage = makeMockStorage(trustedIssuers);
            service = createEudiwService(makeConfig(), storage, createSdJwtVerifier());

            const token = await createTestSdJwt({ given_name: 'Eve' }, issuerUrl, wrongKeyPair);
            const result = await service.verifyPresentation(token, {});
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Signature verification failed');
        });

        it('accepts valid tokens with trusted issuer and extracts attributes', async () => {
            const issuerUrl = 'https://trusted-issuer.example.com';
            const issuer = makeTrustedIssuer(issuerUrl, true);
            trustedIssuers.set(issuer.id, issuer);
            const storage = makeMockStorage(trustedIssuers);
            service = createEudiwService(makeConfig(), storage, createSdJwtVerifier());

            const token = await createTestSdJwt(
                { given_name: 'Alice', family_name: 'Smith', birthdate: '1990-01-01' },
                issuerUrl,
                testKeyPair,
            );
            const result = await service.verifyPresentation(token, {});
            expect(result.valid).toBe(true);
            expect(result.issuer).toBe(issuerUrl);
            expect(result.attributes).toBeDefined();
            expect(result.attributes!.given_name).toBe('Alice');
            expect(result.attributes!.family_name).toBe('Smith');
            expect(result.attributes!.birthdate).toBe('1990-01-01');
        });
    });
});
