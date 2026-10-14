/**
 * @file src/services/config-schema-connections.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The outbound connection client settings on the admin Config tab: the applications
 *   this node registers AS at Google, Microsoft, LinkedIn, X, Meta (Facebook, Instagram) and Reddit,
 *   and the callback address every one of them must name. A pure move out of config-schema.ts
 *   (max-file-lines): CONFIG_FIELDS spreads these rows where they stood, so the Config tab lists
 *   them in the same order.
 * @structure CONNECT_CLIENT_CONFIG_FIELDS
 * @version-history
 *   v1.0.0 — 2026-10-15 — Moved from config-schema.ts when Facebook, Instagram and Reddit took it
 *     past 800 lines; the three new providers' rows arrived in the same change.
 */
import type { ConnectionsConfig } from '../config-types-connections.js';
import type { ConfigFieldShape } from './config-field-def.js';

export const CONNECT_CLIENT_CONFIG_FIELDS: ConfigFieldShape<keyof ConnectionsConfig>[] = [
  { key: 'connectGoogleClientId', dotPath: 'connections.google_client_id', envVar: 'AIMEAT_CONNECT_GOOGLE_CLIENT_ID', type: 'string', validate: () => true, immutable: false, description: 'Google app for YouTube and both halves of Gmail (NOT the sign-in client)' },
  { key: 'connectGoogleClientSecret', dotPath: 'connections.google_client_secret', envVar: 'AIMEAT_CONNECT_GOOGLE_CLIENT_SECRET', type: 'string', validate: () => true, immutable: true, description: 'Google app secret (secret)', adminDisplay: 'configured' },
  { key: 'connectMicrosoftClientId', dotPath: 'connections.microsoft_client_id', envVar: 'AIMEAT_CONNECT_MICROSOFT_CLIENT_ID', type: 'string', validate: () => true, immutable: false, description: 'Microsoft (Entra) app for reading and sending Outlook mail (NOT the sign-in app)' },
  { key: 'connectMicrosoftClientSecret', dotPath: 'connections.microsoft_client_secret', envVar: 'AIMEAT_CONNECT_MICROSOFT_CLIENT_SECRET', type: 'string', validate: () => true, immutable: true, description: 'Microsoft app secret (secret)', adminDisplay: 'configured' },
  // Goes into the authorize and token URL PATHS, so a wrong value fails at Microsoft rather than
  // here. Validated to the same shape the route accepts from a user.
  { key: 'connectMicrosoftTenant', dotPath: 'connections.microsoft_tenant', envVar: 'AIMEAT_CONNECT_MICROSOFT_TENANT', type: 'string', validate: v => typeof v === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(v), immutable: false, description: 'Entra directory: common | organizations | consumers | a directory id' },
  { key: 'connectLinkedinClientId', dotPath: 'connections.linkedin_client_id', envVar: 'AIMEAT_CONNECT_LINKEDIN_CLIENT_ID', type: 'string', validate: () => true, immutable: false, description: 'LinkedIn app client id' },
  { key: 'connectLinkedinClientSecret', dotPath: 'connections.linkedin_client_secret', envVar: 'AIMEAT_CONNECT_LINKEDIN_CLIENT_SECRET', type: 'string', validate: () => true, immutable: true, description: 'LinkedIn app secret (secret)', adminDisplay: 'configured' },
  { key: 'connectXClientId', dotPath: 'connections.x_client_id', envVar: 'AIMEAT_CONNECT_X_CLIENT_ID', type: 'string', validate: () => true, immutable: false, description: 'X app client id (pay-per-use: every post is a charge)' },
  { key: 'connectXClientSecret', dotPath: 'connections.x_client_secret', envVar: 'AIMEAT_CONNECT_X_CLIENT_SECRET', type: 'string', validate: () => true, immutable: true, description: 'X app secret (secret)', adminDisplay: 'configured' },
  { key: 'connectFacebookClientId', dotPath: 'connections.facebook_client_id', envVar: 'AIMEAT_CONNECT_FACEBOOK_CLIENT_ID', type: 'string', validate: () => true, immutable: false, description: 'Meta app id for publishing to a Facebook Page' },
  { key: 'connectFacebookClientSecret', dotPath: 'connections.facebook_client_secret', envVar: 'AIMEAT_CONNECT_FACEBOOK_CLIENT_SECRET', type: 'string', validate: () => true, immutable: true, description: 'Meta app secret (secret)', adminDisplay: 'configured' },
  { key: 'connectFacebookConfigId', dotPath: 'connections.facebook_config_id', envVar: 'AIMEAT_CONNECT_FACEBOOK_CONFIG_ID', type: 'string', validate: v => typeof v === 'string' && /^\d{0,32}$/.test(v), immutable: false, description: 'Facebook Login for Business configuration id (empty: scopes only)' },
  { key: 'connectInstagramClientId', dotPath: 'connections.instagram_client_id', envVar: 'AIMEAT_CONNECT_INSTAGRAM_CLIENT_ID', type: 'string', validate: () => true, immutable: false, description: 'Instagram app id (Instagram Login; not the Meta app id)' },
  { key: 'connectInstagramClientSecret', dotPath: 'connections.instagram_client_secret', envVar: 'AIMEAT_CONNECT_INSTAGRAM_CLIENT_SECRET', type: 'string', validate: () => true, immutable: true, description: 'Instagram app secret (secret)', adminDisplay: 'configured' },
  { key: 'connectRedditClientId', dotPath: 'connections.reddit_client_id', envVar: 'AIMEAT_CONNECT_REDDIT_CLIENT_ID', type: 'string', validate: () => true, immutable: false, description: 'Reddit web app client id' },
  { key: 'connectRedditClientSecret', dotPath: 'connections.reddit_client_secret', envVar: 'AIMEAT_CONNECT_REDDIT_CLIENT_SECRET', type: 'string', validate: () => true, immutable: true, description: 'Reddit app secret (secret)', adminDisplay: 'configured' },
  // Must match every provider registration byte for byte. A mismatch surfaces only at the
  // provider's own consent screen, as redirect_uri_mismatch, so it is worth being able to read.
  { key: 'connectRedirectUri', dotPath: 'connections.redirect_uri', envVar: 'AIMEAT_CONNECT_REDIRECT_URI', type: 'string', validate: () => true, immutable: false, description: 'OAuth callback URL; empty derives it from baseUrl' },
];
