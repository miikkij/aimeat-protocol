/**
 * @file oidc-client.test.ts
 * @description Unit tests for the generic OIDC client service
 * @version-history
 *   v1.0.0 — 2026-05-02 — Initial test suite
 */

import { describe, it, expect } from 'vitest';
import { createOidcClient } from '../../src/services/oidc-client.js';

describe('OIDC Client', () => {
  const baseConfig = {
    issuerUrl: 'https://fake-issuer.example.com',
    clientId: 'test-client',
    clientSecret: 'test-secret',
    redirectUri: 'http://localhost:40050/v1/ghii/verify/ftn/callback',
    scopes: ['openid', 'profile', 'personal_identity_code'],
  };

  it('reports not initialized before initialize() is called', () => {
    const client = createOidcClient(baseConfig);
    expect(client.initialized).toBe(false);
  });

  it('throws when createAuthRequest is called before initialization', () => {
    const client = createOidcClient(baseConfig);
    expect(() => client.createAuthRequest()).toThrow('not initialized');
  });

  it('throws when exchangeCode is called before initialization', async () => {
    const client = createOidcClient(baseConfig);
    await expect(client.exchangeCode('code', 'state', 'nonce')).rejects.toThrow('not initialized');
  });

  it('initialize() fails gracefully with unreachable issuer', async () => {
    const client = createOidcClient({
      ...baseConfig,
      issuerUrl: 'https://unreachable.invalid',
    });
    await expect(client.initialize()).rejects.toThrow();
    expect(client.initialized).toBe(false);
  });
});
