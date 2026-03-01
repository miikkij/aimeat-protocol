import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEudiwService } from '../../src/services/eudiw.js';
import type { EudiwService } from '../../src/services/eudiw.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, TrustedIssuerRecord } from '../../src/storage/interface.js';

// ── Helpers ──────────────────────────────────────────────────

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
    } as unknown as Storage;
}

function createTestVpToken(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${header}.${body}.fake-signature`;
}

function makeTrustedIssuer(url: string, trusted = true): TrustedIssuerRecord {
    return {
        id: `issuer-${Math.random().toString(36).slice(2, 8)}`,
        name: 'Test Issuer',
        url,
        publicKey: 'test-public-key',
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
            service = createEudiwService(makeConfig({ eudiwEnabled: true }), storage);
            expect(service.enabled).toBe(true);
        });

        it('reports disabled when config.eudiwEnabled is false', () => {
            const storage = makeMockStorage();
            service = createEudiwService(makeConfig({ eudiwEnabled: false }), storage);
            expect(service.enabled).toBe(false);
        });
    });

    describe('generateAuthorizationRequest', () => {
        it('returns valid OpenID4VP structure', () => {
            const storage = makeMockStorage();
            service = createEudiwService(makeConfig(), storage);
            const request = service.generateAuthorizationRequest('test-state-123');
            expect(request.response_type).toBe('vp_token');
            expect(request.response_mode).toBe('direct_post');
            expect(request.state).toBe('test-state-123');
            expect(request.nonce).toBeTruthy();
        });

        it('contains correct client_id from config', () => {
            const storage = makeMockStorage();
            service = createEudiwService(makeConfig({ eudiwClientId: 'my-custom-verifier' }), storage);
            const request = service.generateAuthorizationRequest('state-1');
            expect(request.client_id).toBe('my-custom-verifier');
        });

        it('contains presentation_definition with input descriptors', () => {
            const storage = makeMockStorage();
            service = createEudiwService(makeConfig(), storage);
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
            service = createEudiwService(makeConfig({ eudiwRedirectUri: '', baseUrl: 'http://localhost:40050' }), storage);
            const request = service.generateAuthorizationRequest('state-1');
            expect(request.redirect_uri).toBe('http://localhost:40050/v1/ghii/verify/eudiw/callback');
        });

        it('uses custom redirect_uri when eudiwRedirectUri is set', () => {
            const storage = makeMockStorage();
            service = createEudiwService(makeConfig({ eudiwRedirectUri: 'https://custom.example.com/cb' }), storage);
            const request = service.generateAuthorizationRequest('state-1');
            expect(request.redirect_uri).toBe('https://custom.example.com/cb');
        });
    });

    describe('verifyPresentation', () => {
        it('rejects invalid VP token format (not 3 parts)', async () => {
            const storage = makeMockStorage();
            service = createEudiwService(makeConfig(), storage);
            const result = await service.verifyPresentation('not.valid', {});
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Invalid VP token format');
        });

        it('rejects invalid base64url payload', async () => {
            const storage = makeMockStorage();
            service = createEudiwService(makeConfig(), storage);
            const result = await service.verifyPresentation('header.!!!invalid!!!.sig', {});
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Invalid VP token payload');
        });

        it('rejects expired tokens', async () => {
            const issuerUrl = 'https://issuer.example.com';
            const issuer = makeTrustedIssuer(issuerUrl);
            trustedIssuers.set(issuer.id, issuer);
            const storage = makeMockStorage(trustedIssuers);
            service = createEudiwService(makeConfig(), storage);

            const expiredPayload = { iss: issuerUrl, exp: Math.floor(Date.now() / 1000) - 3600 };
            const token = createTestVpToken(expiredPayload);
            const result = await service.verifyPresentation(token, {});
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Credential expired');
        });

        it('rejects missing issuer in payload', async () => {
            const storage = makeMockStorage();
            service = createEudiwService(makeConfig(), storage);
            const token = createTestVpToken({ sub: 'no-issuer-here' });
            const result = await service.verifyPresentation(token, {});
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Missing issuer in VP token');
        });

        it('rejects untrusted issuers', async () => {
            const storage = makeMockStorage(); // no trusted issuers
            service = createEudiwService(makeConfig(), storage);
            const token = createTestVpToken({ iss: 'https://unknown-issuer.com', exp: Math.floor(Date.now() / 1000) + 3600 });
            const result = await service.verifyPresentation(token, {});
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Untrusted issuer');
        });

        it('rejects issuer marked as untrusted', async () => {
            const issuerUrl = 'https://untrusted.example.com';
            const issuer = makeTrustedIssuer(issuerUrl, false);
            trustedIssuers.set(issuer.id, issuer);
            const storage = makeMockStorage(trustedIssuers);
            service = createEudiwService(makeConfig(), storage);

            const token = createTestVpToken({ iss: issuerUrl, exp: Math.floor(Date.now() / 1000) + 3600 });
            const result = await service.verifyPresentation(token, {});
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Untrusted issuer');
        });

        it('accepts valid tokens with trusted issuer and extracts attributes', async () => {
            const issuerUrl = 'https://trusted-issuer.example.com';
            const issuer = makeTrustedIssuer(issuerUrl, true);
            trustedIssuers.set(issuer.id, issuer);
            const storage = makeMockStorage(trustedIssuers);
            service = createEudiwService(makeConfig(), storage);

            const token = createTestVpToken({
                iss: issuerUrl,
                exp: Math.floor(Date.now() / 1000) + 3600,
                vc: {
                    credentialSubject: {
                        id: 'did:example:123',
                        type: 'Person',
                        given_name: 'Alice',
                        family_name: 'Smith',
                        birthdate: '1990-01-01',
                    },
                },
            });
            const result = await service.verifyPresentation(token, {});
            expect(result.valid).toBe(true);
            expect(result.issuer).toBe(issuerUrl);
            expect(result.attributes).toBeDefined();
            // id and type should be excluded from attributes
            expect(result.attributes!.given_name).toBe('Alice');
            expect(result.attributes!.family_name).toBe('Smith');
            expect(result.attributes!.birthdate).toBe('1990-01-01');
            expect(result.attributes!.id).toBeUndefined();
            expect(result.attributes!.type).toBeUndefined();
        });
    });
});
