/**
 * @file oidc-client.ts
 * @description Generic OIDC Relying Party wrapper built on openid-client v6.
 *   Broker-agnostic: works with any standard OIDC provider (FTN, BankID, MitID).
 * @version-history
 *   v1.0.0 — 2026-05-02 — Initial implementation
 */

import * as oidc from 'openid-client';
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';

export interface OidcClientConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

export interface OidcAuthRequest {
  authorizationUrl: string;
  state: string;
  nonce: string;
}

export interface OidcTokenResult {
  valid: boolean;
  claims?: Record<string, unknown>;
  error?: string;
}

export interface OidcClient {
  readonly initialized: boolean;
  initialize(): Promise<void>;
  createAuthRequest(): OidcAuthRequest;
  exchangeCode(code: string, state: string, expectedNonce: string): Promise<OidcTokenResult>;
}

export function createOidcClient(clientConfig: OidcClientConfig): OidcClient {
  let serverConfig: oidc.Configuration | null = null;
  let isInitialized = false;

  return {
    get initialized() { return isInitialized; },

    async initialize(): Promise<void> {
      try {
        serverConfig = await oidc.discovery(
          new URL(clientConfig.issuerUrl),
          clientConfig.clientId,
          clientConfig.clientSecret,
        );
        isInitialized = true;
        logger.info(`OIDC client initialized for issuer: ${clientConfig.issuerUrl}`);
      } catch (err) {
        logger.error('OIDC discovery failed', { issuer: clientConfig.issuerUrl, error: String(err) });
        throw err;
      }
    },

    createAuthRequest(): OidcAuthRequest {
      if (!serverConfig) throw new Error('OIDC client not initialized');

      const state = randomUUID();
      const nonce = randomUUID();

      const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientConfig.clientId,
        redirect_uri: clientConfig.redirectUri,
        scope: clientConfig.scopes.join(' '),
        state,
        nonce,
      });

      const authEndpoint = serverConfig.serverMetadata().authorization_endpoint;
      if (!authEndpoint) throw new Error('Authorization endpoint not found in OIDC discovery');

      const authorizationUrl = `${authEndpoint}?${params.toString()}`;

      return { authorizationUrl, state, nonce };
    },

    async exchangeCode(code: string, _state: string, expectedNonce: string): Promise<OidcTokenResult> {
      if (!serverConfig) throw new Error('OIDC client not initialized');

      try {
        const tokens = await oidc.authorizationCodeGrant(
          serverConfig,
          new URL(`${clientConfig.redirectUri}?code=${encodeURIComponent(code)}`),
          { expectedNonce },
        );

        const claims = tokens.claims();
        if (!claims) {
          return { valid: false, error: 'No claims in token response' };
        }

        return {
          valid: true,
          claims: claims as unknown as Record<string, unknown>,
        };
      } catch (err) {
        logger.error('OIDC code exchange failed', { error: String(err) });
        return { valid: false, error: `Token exchange failed: ${String(err)}` };
      }
    },
  };
}
