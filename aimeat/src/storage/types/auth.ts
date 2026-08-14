/**
 * @file src/storage/types/auth.ts
 * @description Auth, OAuth, device/eco authorization, consent, and identity-verification record types. Extracted from src/storage/interface.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/storage/interface.ts (max-file-lines)
 */
import type { EcoDataAreaGrant } from './identity.js';
export interface OtkRecord {
  key: string;
  ownerGaii: string;
  action: string;         // 'write_memory' | 'post_board' | 'session' | 'initial' | 'register_agent'
  params: Record<string, unknown>;
  expiresAt: string;      // ISO timestamp; for initial OTKs, set to far-future until first use
  initial: boolean;       // true = timer starts on first use, not at creation
  used: boolean;
  usedAt: string | null;  // ISO timestamp of first use (grace window starts here)
  sessionId: string | null; // links OTKs to a session for inactivity timeout
  createdAt: string;
}

export interface OAuthClientRecord {
  clientId: string;           // primary key
  clientSecret: string;       // stored hashed (SHA-256)
  clientName: string;
  redirectUris: string[];
  createdAt: string;
}

export interface OAuthRefreshTokenRecord {
  tokenHash: string;          // primary key — SHA-256 of the raw refresh token
  clientId: string;
  gaii: string;
  owner: string;
  roles: string[];
  createdAt: string;
}

export interface OAuthApprovalRecord {
  clientId: string;           // compound key: clientId + gaii
  gaii: string;
  owner: string;
  scope: string;              // e.g. 'aimeat:full'
  approvedAt: string;
}

// App grant — a long-lived authorization issued to an in-page app so it can
// obtain agent tokens that resolve to the granting owner's GHII.
export interface AppGrantRecord {
  grantId: string;            // PK — e.g. "appgrant-<hex>"
  app: string;                // app identity, "owner/filename"
  appName: string;            // display name
  appOrigin: string;          // origin the app runs on (for display/redirect validation)
  owner: string;              // bare owner name who granted
  gaii: string;               // owner GHII (alice@node) the issued token resolves to
  scopes: string[];           // granted agent scopes (JSON array)
  /**
   * Ceiling on what this app may spend of its owner's money, in morsels, across the life of the
   * grant. `null` = no ceiling (the scope alone). A yes/no permission is a poor answer to "may this
   * app buy for me" — the useful answer is an amount, and it only became expressible once an app
   * could be named apart from its owner at all.
   */
  spendCapMorsels?: number | null;
  /** Spent so far under this grant, in morsels. Only moves when the app itself causes a charge. */
  spentMorsels?: number;
  refreshTokenHash: string | null;  // SHA-256 of current refresh token; null once revoked
  createdAt: string;          // ISO
  lastUsedAt: string | null;  // ISO
  revoked: boolean;
}

export interface DeviceAuthorizationRecord {
  deviceCode: string;
  userCode: string;
  ownerName: string;
  agentName: string;
  displayName?: string;
  description?: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  scopes?: string[];
  createdAt: string;
  expiresAt: string;
  lastPolledAt?: string;
  pollInterval: number;
  approvedBy?: string;
  /** Optional agent mode the requesting agent declared at device-authorize time. */
  mode?: 'autonomous' | 'interactive' | 'task-runner' | 'coordinator' | 'workstation';
  agentCredentials?: {
    gaii: string;
    privateKey: string;
    publicKey: string;
    token?: string;
    expires_at?: string;
  };
}

/**
 * EcoAuthorizationRecord — the pending "hello integration" handshake request for an ecosystem app,
 * a near-copy of DeviceAuthorizationRecord. Carries the eco-specific fields captured before approval
 * (app name, the TOFU-pinned publicKey, the requested scopes + data-area allowlist, the opaque
 * boundRef). On approval the GEAI credential is stashed in `appCredentials` for one-time pickup.
 */
export interface EcoAuthorizationRecord {
  deviceCode: string;
  userCode: string;
  ownerName: string;
  app: string;
  displayName?: string;
  description?: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  /** The app's verification key submitted at hello, pinned TOFU. */
  publicKey?: string;
  /** Scopes requested by the app (owner may narrow at approval). */
  scopes?: string[];
  /** Data-area allowlist requested by the app (owner may edit at approval). */
  dataAreas?: EcoDataAreaGrant[];
  /** Opaque ecosystem-side account reference, carried through to the binding record. */
  boundRef?: string;
  createdAt: string;
  expiresAt: string;
  lastPolledAt?: string;
  pollInterval: number;
  approvedBy?: string;
  /**
   * Static compatibility-validation result for the submitted manifest (connector profile §5). Set at
   * hello time when a manifest is provided. The owner approves a known-good integration; an approve is
   * blocked when this exists and `ok` is false.
   */
  validationResult?: {
    ok: boolean;
    checks: { name: string; ok: boolean; detail?: string }[];
    validatedAt: string;
  };
  /**
   * The capabilities declared in the submitted manifest (stored at hello, copied onto the
   * EcosystemAppRecord at approval). Lets the binding carry the capability contract forward.
   */
  capabilities?: { id: string; inputSchema?: Record<string, unknown>; outputSchema?: Record<string, unknown> }[];
  /** Optional automation hints from the manifest (schedulable capabilities + advisory sink + recommended agents). */
  automation?: {
    schedulable?: { id: string; produces?: string; produces_key?: string; cadences?: string[] }[];
    advisory_sink?: string;
    recommended_agents?: { name?: string; match_tags?: string[]; why: { fi: string; en: string } }[];
  };
  /** The app's OWN bilingual Markdown setup guide (stored at hello, copied onto the EcosystemApp at approval). */
  setup?: { fi: string; en: string };
  appCredentials?: {
    geai: string;
    /** The app's TOFU-pinned verification key (echoed back; the app already holds its private half). */
    publicKey: string;
    token?: string;
    expires_at?: string;
  };
}

export interface ConsentRecord {
  id: string;                 // UUID
  ownerGaii: string;          // Data owner (consent grantor)
  dataPattern: string;        // Glob-pattern: "profile.*.interests", "iot.*"
  recipient: string;          // "*" | GAII | "organism.{id}"
  purpose: string;            // Free-form: "discovery", "marketplace", "research"
  scope: 'private' | 'dmz' | 'federation' | 'auth';
  expires: string | null;     // ISO 8601 or null (indefinite)
  status: 'active' | 'revoked' | 'expired';
  grantedAt: string;          // ISO timestamp
  revokedAt: string | null;   // ISO timestamp or null
  metadata?: Record<string, unknown>;  // Free-form metadata
}

export interface ConsentAuditEntry {
  id: string;                 // UUID
  consentId: string;          // References ConsentRecord.id
  ownerGaii: string;          // Whose data was accessed
  accessorGaii: string;       // Who accessed the data
  memoryKey: string;          // Which key was read (or the consent dataPattern for grant/revoke)
  action: 'read' | 'list' | 'search' | 'grant' | 'revoke';  // What was done
  timestamp: string;          // ISO timestamp
  allowed: boolean;           // Did consent allow this? (always true for grant/revoke)
}

export interface EmailVerificationRecord {
  id: string;
  ownerName: string;
  emailHash: string;
  code: string;           // SHA-256 hash of 6-digit code
  purpose: 'registration' | 'login' | 'change' | 'password_reset' | 'account_recovery' | 'email_verification';
  status: 'pending' | 'verified' | 'expired';
  attempts: number;
  expiresAt: string;
  createdAt: string;
  verifiedAt: string | null;
}

// Phase 3.3 — Trusted Issuers
export interface TrustedIssuerRecord {
  id: string;
  name: string;
  url: string;
  publicKey: string;
  type: 'eudiw' | 'ftn' | 'w3c_vc' | 'custom';
  trusted: boolean;
  addedBy: string;
  createdAt: string;
}

// Phase 3.3 — Verification Nonces (EUDIW/FTN state tracking)
//
// Also the pending-authorization store for OUTBOUND connections (TARGET-057). It is reused rather
// than duplicated because it already IS this primitive: a single-use value bound to a principal,
// carried across a provider redirect, with expiry sweeping (cleanExpiredNonces) already wired.
// A second table would have been a second sweeper and a second way to forget one.
export interface VerificationNonceRecord {
  id: string;
  owner: string;
  type: 'eudiw' | 'ftn' | 'google_login' | 'casdoor_login' | 'entra_login' | 'connect';
  state: string;
  /** OIDC nonce for the login types; the PKCE code_verifier for `connect`. */
  nonce: string;
  redirectUri: string;
  /**
   * Flow-specific JSON the callback needs and the URL must not carry. For `connect` that is the
   * provider, the instance and the mode: putting them in the redirect URL instead would let the
   * caller of the callback choose which provider their code is redeemed against.
   */
  payload?: string | null;
  createdAt: string;
  expiresAt: string;
}
