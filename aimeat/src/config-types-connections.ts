/**
 * @file src/config-types-connections.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description OUTBOUND connections (TARGET-057, aimeat-connect): the applications this node is
 *   registered as at each service a person can connect their own account at. Mixed into
 *   AimeatConfig, which had crossed the 800-line ceiling again; the fields moved here verbatim and
 *   nothing else changed.
 *
 *   NOTE THE DIRECTION, which is the whole reason this is separate from config-types-social-login.ts
 *   sitting beside it. Those blocks decide who may sign IN here. These decide which application this
 *   node presents when a person connects their own account THERE. Signing in with Google and reading
 *   someone's Gmail are different consent, granted separately and revocable separately, so they are
 *   different registrations and different credentials — never the same client id in two places.
 * @structure ConnectionsConfig — the master switch, then one credential pair per fixed-endpoint
 *   provider, then the callback and the test-only stand-in.
 * @usage export interface AimeatConfig extends ConnectionsConfig { … }
 * @version-history
 *   v1.0.0 — 2026-08-26 — Extracted from config-types.ts (max-file-lines), with the Microsoft mail
 *     registration as the block that pushed it over.
 */

export interface ConnectionsConfig {
  /**
   * The capability master switch. Off means NOTHING is offered, whoever brought what — which is the
   * safe public value for a node whose operator has not thought about it yet.
   */
  connectionsEnabled: boolean;

  // Fixed-endpoint provider credentials. Identify the APPLICATION, one per node, the same for every
  // user. The USER's tokens never come near config: they live encrypted in Connection.credential.
  // An instance-scoped provider (Mastodon) has nothing here at all — its client credentials are
  // per instance and acquired at runtime (storage ProviderClient).

  /**
   * One Google application, shared by YouTube and by both halves of Gmail. They are one registration
   * at Google; what differs is the scopes each provider asks for, and the consent screen names them.
   * Deliberately NOT the sign-in client.
   */
  connectGoogleClientId: string;
  connectGoogleClientSecret: string;

  /**
   * Microsoft (Entra) application, for reading and sending a person's own Outlook / Microsoft 365
   * mail. A SEPARATE registration from the Entra SIGN-IN app (`entra*`), for the same reason Google
   * has two.
   */
  connectMicrosoftClientId: string;
  connectMicrosoftClientSecret: string;
  /**
   * Which directory the node's own app is registered in: 'common' (work, school and personal
   * accounts), 'organizations' (work and school), or a tenant GUID. It goes into the authorize and
   * token URL PATHS, so getting it wrong fails at Microsoft with a message about the application
   * rather than about the tenant. A principal who brings their own single-tenant app supplies its
   * tenant alongside the client credentials; this is only the node's own.
   */
  connectMicrosoftTenant: string;

  /** LinkedIn app client id. Consumer tier, self-serve: no product review to wait on. */
  connectLinkedinClientId: string;
  connectLinkedinClientSecret: string;

  /** X app client id. Pay-per-use: every post is a charge, capped by a spend limit set at X. */
  connectXClientId: string;
  connectXClientSecret: string;

  /** Empty = derive from baseUrl. It must match every provider registration byte for byte. */
  connectRedirectUri: string;

  /**
   * TEST ONLY, empty everywhere else. Base URL of a local stand-in provider, so the E2E can drive
   * the REAL authorization round — state, PKCE, exchange, identity, rotating refresh, revoke —
   * against a server it controls. Mocking the service layer instead would test the mock.
   */
  connectFakeBaseUrl: string;
}
