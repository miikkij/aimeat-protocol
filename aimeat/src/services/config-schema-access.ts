/**
 * @file src/services/config-schema-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Config-tab rows for signing in and the tokens it gives: how long access, refresh, agent
 *   and app tokens last, sign-in with Google, Microsoft Entra and Casdoor, the scopes an ecosystem app
 *   gets, same-owner agent approval and MCP scope enforcement. Until 2026-10-25 none of these had a row,
 *   so they were .env-and-restart only (the seeded backlog of check:config-coverage).
 *
 *   Stored in the database. The token lifetimes and the app and agent rules take effect at once: the
 *   code reads them on every use. The three sign-in providers take effect at the next start (`applies:
 *   'restart'`), because their clients are built when the routes are mounted. A sign-in secret is
 *   stored encrypted with the node key (config-at-rest.ts) and shown only as whether it is set.
 *   MCP scope enforcement is immutable:
 *   switching it off makes every agent's scopes advisory, which whoever runs the node decides.
 * @structure ACCESS_CONFIG_FIELDS
 * @version-history
 *   v1.3.0 — 2026-11-02 — auth.sign_in_lockout (AIMEAT_SIGN_IN_LOCKOUT: off, on), off by default (Jouni, 08.02).
 *   v1.2.0 — 2026-11-02 — auth.two_step_required (AIMEAT_TWO_STEP_REQUIRED: off, operators, everyone) and
 *     auth.password_sign_in (AIMEAT_PASSWORD_SIGN_IN: on, operators, off), mutable, read on every
 *     sign-in. A change that weakens either is refused to an AI credential, and password_sign_in=off is
 *     refused while no operator has a passkey or an identity provider link (services/sign-in-policy.ts,
 *     asked by config-admin-view.ts).
 *   v1.1.0 — 2026-10-26 — mcp.task_after_ms (AIMEAT_MCP_TASK_AFTER_MS, default 10000, 0 = at once), mutable:
 *     when a tool call of a client that declares the MCP Tasks extension answers with a task
 *     (mcp/tasks-extension.ts). Read on every call, so a change takes effect at once.
 *   v1.0.0 — 2026-10-25 — Initial.
 */
// Typed by the keys alone, not AimeatConfig, which would close an import cycle through
// config-types.ts; config-schema.ts checks each key against AimeatConfig where it spreads the rows.
import type { ConfigFieldShape } from './config-field-def.js';
import { isEmptyOrHttpUrl, oneOf } from './config-schema-validators.js';
import { TWO_STEP_REQUIRED_VALUES, PASSWORD_SIGN_IN_VALUES, SIGN_IN_LOCKOUT_VALUES } from '../config-types-account-security.js';

const whole = (min: number) => (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= min;
const bool = (v: unknown): boolean => typeof v === 'boolean';
const text = (v: unknown): boolean => typeof v === 'string';
/** A list row that may be empty: every entry a non-empty word with no comma in it. */
const words = (v: unknown): boolean => Array.isArray(v) && v.every(s => typeof s === 'string' && s.trim() !== '' && !s.includes(','));

type AccessKey = 'accessTtlSeconds' | 'refreshIdleDays' | 'refreshAbsoluteDays' | 'refreshGraceMs' | 'agentJwtTtlSeconds'
  | 'ecoJwtTtlSeconds' | 'googleOAuthEnabled' | 'googleOAuthClientId' | 'googleOAuthClientSecret' | 'googleOAuthRedirectUri'
  | 'entraOAuthEnabled' | 'entraOAuthTenant' | 'entraOAuthClientId' | 'entraOAuthClientSecret' | 'entraOAuthRedirectUri'
  | 'casdoorOAuthEnabled' | 'casdoorOAuthEndpoint' | 'casdoorOAuthClientId' | 'casdoorOAuthClientSecret' | 'casdoorOAuthRedirectUri'
  | 'defaultEcoScopes' | 'maxEcoScopes' | 'sameOwnerAutoApprove' | 'mcpEnforceScopes' | 'mcpTaskAfterMs'
  | 'twoStepRequired' | 'passwordSignIn' | 'signInLockout';

export const ACCESS_CONFIG_FIELDS: ConfigFieldShape<AccessKey>[] = [
  // ── Token lifetimes ──
  { key: 'accessTtlSeconds', dotPath: 'auth.access_ttl_seconds', envVar: 'AIMEAT_ACCESS_TTL', type: 'number', validate: whole(1), immutable: false, description: 'How long a person\'s access token lasts, in seconds, before the refresh token renews it (default 900)', range: '60-86400' },
  { key: 'refreshIdleDays', dotPath: 'auth.refresh_idle_days', envVar: 'AIMEAT_REFRESH_IDLE_DAYS', type: 'number', validate: whole(1), immutable: false, description: 'Days a sign-in stays valid without use (default 30)', range: '1-365' },
  { key: 'refreshAbsoluteDays', dotPath: 'auth.refresh_absolute_days', envVar: 'AIMEAT_REFRESH_ABSOLUTE_DAYS', type: 'number', validate: whole(1), immutable: false, description: 'Days a sign-in stays valid at most, however often it is used (default 90)', range: '1-3650' },
  { key: 'refreshGraceMs', dotPath: 'auth.refresh_grace_ms', envVar: 'AIMEAT_REFRESH_GRACE_MS', type: 'number', validate: whole(0), immutable: false, description: 'Milliseconds a replaced refresh token still works, for two tabs renewing at once (default 60000)', range: '0-600000' },
  { key: 'agentJwtTtlSeconds', dotPath: 'auth.agent_jwt_ttl_seconds', envVar: 'AIMEAT_AGENT_JWT_TTL', type: 'number', validate: whole(1), immutable: false, description: 'How long an agent\'s token lasts, in seconds (default 7776000, 90 days)', range: '60-31536000' },
  { key: 'ecoJwtTtlSeconds', dotPath: 'auth.eco_jwt_ttl_seconds', envVar: 'AIMEAT_ECO_JWT_TTL', type: 'number', validate: whole(1), immutable: false, description: 'How long an ecosystem app\'s token lasts, in seconds (default 7776000, 90 days)', range: '60-31536000' },

  // ── Which sign-ins a person may use (services/sign-in-policy.ts) ──
  { key: 'twoStepRequired', dotPath: 'auth.two_step_required', envVar: 'AIMEAT_TWO_STEP_REQUIRED', type: 'string', ...oneOf(...TWO_STEP_REQUIRED_VALUES), immutable: false, description: 'Who must use two-step sign-in: off (nobody is made to), operators (accounts with the operator role) or everyone. A password or emailed-link sign-in of such an account without a code app set up asks the person to set one up before it opens. A passkey and a sign-in through an identity provider count as two-step. A signed-in session of such an account with no code app, passkey or identity provider link ends at its next renewal, so the person signs in again and sets it up. An AI cannot lower it' },
  { key: 'passwordSignIn', dotPath: 'auth.password_sign_in', envVar: 'AIMEAT_PASSWORD_SIGN_IN', type: 'string', ...oneOf(...PASSWORD_SIGN_IN_VALUES), immutable: false, description: 'Who may sign in with a password: on (everyone), operators (only accounts with the operator role, as a way in when other ways fail) or off (nobody: people use a passkey, the organisation\'s sign-in or an emailed sign-in link). Off and operators also refuse a new password: password registration, invitations with a password, and password reset. Off is refused while no operator has a passkey or an identity provider link. An AI cannot open it wider' },
  { key: 'signInLockout', dotPath: 'auth.sign_in_lockout', envVar: 'AIMEAT_SIGN_IN_LOCKOUT', type: 'string', ...oneOf(...SIGN_IN_LOCKOUT_VALUES), immutable: false, description: 'Whether wrong passwords and wrong two-step codes lock an account for a while: off (default, nothing is counted and nobody is locked out) or on (AIMEAT_PASSWORD_LOCKOUT_ATTEMPTS and _MINUTES, AIMEAT_TOTP_MAX_FAILED and AIMEAT_TOTP_LOCKOUT_SECONDS then decide when and how long). A lock also lets anyone who knows a username keep its owner out; with it off, the per-address delay and the login rate limit bound guessing. An AI cannot switch it off' },

  // ── Sign in with Google ──
  { key: 'googleOAuthEnabled', dotPath: 'auth.google_enabled', envVar: 'AIMEAT_GOOGLE_OAUTH_ENABLED', type: 'boolean', validate: bool, immutable: false, applies: 'restart', description: 'Offer "Sign in with Google"' },
  { key: 'googleOAuthClientId', dotPath: 'auth.google_client_id', envVar: 'AIMEAT_GOOGLE_OAUTH_CLIENT_ID', type: 'string', validate: text, immutable: false, applies: 'restart', description: 'Google sign-in client id (NOT the client of the Google connection for Gmail and YouTube)' },
  { key: 'googleOAuthClientSecret', dotPath: 'auth.google_client_secret', envVar: 'AIMEAT_GOOGLE_OAUTH_CLIENT_SECRET', type: 'string', validate: text, immutable: false, applies: 'restart', description: 'Google sign-in client secret (secret)', adminDisplay: 'configured' },
  { key: 'googleOAuthRedirectUri', dotPath: 'auth.google_redirect_uri', envVar: 'AIMEAT_GOOGLE_OAUTH_REDIRECT_URI', type: 'string', validate: isEmptyOrHttpUrl, immutable: false, applies: 'restart', description: 'Address Google returns to after sign-in. Empty derives it from the node address' },

  // ── Sign in with Microsoft Entra ──
  { key: 'entraOAuthEnabled', dotPath: 'auth.entra_enabled', envVar: 'AIMEAT_ENTRA_OAUTH_ENABLED', type: 'boolean', validate: bool, immutable: false, applies: 'restart', description: 'Offer "Sign in with Microsoft"' },
  { key: 'entraOAuthTenant', dotPath: 'auth.entra_tenant', envVar: 'AIMEAT_ENTRA_OAUTH_TENANT', type: 'string', validate: v => typeof v === 'string' && /^[A-Za-z0-9.-]{1,128}$/.test(v), immutable: false, applies: 'restart', description: 'Entra directory: common, organizations, consumers, or a directory id or domain (default common)' },
  { key: 'entraOAuthClientId', dotPath: 'auth.entra_client_id', envVar: 'AIMEAT_ENTRA_OAUTH_CLIENT_ID', type: 'string', validate: text, immutable: false, applies: 'restart', description: 'Entra sign-in app (client) id (NOT the app of the Outlook connection)' },
  { key: 'entraOAuthClientSecret', dotPath: 'auth.entra_client_secret', envVar: 'AIMEAT_ENTRA_OAUTH_CLIENT_SECRET', type: 'string', validate: text, immutable: false, applies: 'restart', description: 'Entra sign-in client secret (secret)', adminDisplay: 'configured' },
  { key: 'entraOAuthRedirectUri', dotPath: 'auth.entra_redirect_uri', envVar: 'AIMEAT_ENTRA_OAUTH_REDIRECT_URI', type: 'string', validate: isEmptyOrHttpUrl, immutable: false, applies: 'restart', description: 'Address Microsoft returns to after sign-in. Empty derives it from the node address' },

  // ── Sign in with Casdoor ──
  { key: 'casdoorOAuthEnabled', dotPath: 'auth.casdoor_enabled', envVar: 'AIMEAT_CASDOOR_OAUTH_ENABLED', type: 'boolean', validate: bool, immutable: false, applies: 'restart', description: 'Offer sign-in through a Casdoor server' },
  { key: 'casdoorOAuthEndpoint', dotPath: 'auth.casdoor_endpoint', envVar: 'AIMEAT_CASDOOR_OAUTH_ENDPOINT', type: 'string', validate: isEmptyOrHttpUrl, immutable: false, applies: 'restart', description: 'Address of the Casdoor server' },
  { key: 'casdoorOAuthClientId', dotPath: 'auth.casdoor_client_id', envVar: 'AIMEAT_CASDOOR_OAUTH_CLIENT_ID', type: 'string', validate: text, immutable: false, applies: 'restart', description: 'Casdoor application client id' },
  { key: 'casdoorOAuthClientSecret', dotPath: 'auth.casdoor_client_secret', envVar: 'AIMEAT_CASDOOR_OAUTH_CLIENT_SECRET', type: 'string', validate: text, immutable: false, applies: 'restart', description: 'Casdoor application client secret (secret)', adminDisplay: 'configured' },
  { key: 'casdoorOAuthRedirectUri', dotPath: 'auth.casdoor_redirect_uri', envVar: 'AIMEAT_CASDOOR_OAUTH_REDIRECT_URI', type: 'string', validate: isEmptyOrHttpUrl, immutable: false, applies: 'restart', description: 'Address Casdoor returns to after sign-in. Empty derives it from the node address' },

  // ── Ecosystem apps and agents ──
  { key: 'defaultEcoScopes', dotPath: 'scopes.default_eco_scopes', envVar: 'AIMEAT_DEFAULT_ECO_SCOPES', type: 'object', list: true, validate: words, immutable: false, description: 'Permissions an ecosystem app gets when its request names none (default memory:read, memory:write, organism:read)' },
  { key: 'maxEcoScopes', dotPath: 'scopes.max_eco_scopes', envVar: 'AIMEAT_MAX_ECO_SCOPES', type: 'object', list: true, validate: words, immutable: false, description: 'The most an ecosystem app may be granted; * allows any permission the owner approves' },
  { key: 'sameOwnerAutoApprove', dotPath: 'agents.same_owner_auto_approve', envVar: 'AIMEAT_SAME_OWNER_AUTO_APPROVE', type: 'boolean', validate: bool, immutable: false, description: 'An agent connected by its own owner, or by one of the owner\'s agents, is approved without a second press. Never across owners, never with more permissions' },
  { key: 'mcpEnforceScopes', dotPath: 'mcp.enforce_scopes', envVar: 'AIMEAT_MCP_ENFORCE_SCOPES', type: 'boolean', validate: bool, immutable: true, description: 'Refuse an MCP tool an agent holds no permission for. Off only logs the call, so every agent can use every tool. Set by whoever runs the node, in the environment' },
  { key: 'mcpTaskAfterMs', dotPath: 'mcp.task_after_ms', envVar: 'AIMEAT_MCP_TASK_AFTER_MS', type: 'number', validate: v => whole(0)(v) && (v as number) <= 600000, immutable: false, description: 'A tool call from an AI client that supports MCP tasks and runs longer than this many milliseconds answers at once with a task the client checks later (0 = every such call)', range: '0-600000' },
];
