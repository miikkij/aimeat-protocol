/**
 * @file owner-provisioning.ts
 * @description Single source of truth for minting a brand-new owner + GHII account: generates the
 *   owner keypair, applies the first-owner→operator self-heal, creates the OwnerRecord + GHII
 *   profile (optionally with a password hash, a verified email, and/or a linked external identity),
 *   and records the welcome-bonus transaction. Used by the OIDC signup finalize path and the email
 *   invitation accept path so account creation stays identical across entry points.
 * @structure ProvisionOwnerOpts / ProvisionedOwner; provisionOwner(storage, config, opts).
 * @usage const { owner, ghii } = await provisionOwner(storage, config, { username, displayName, passwordHash });
 * @version-history
 *   v1.0.0 — 2026-07-04 — Extracted from oauth-login.createOwnerForProvider + /v1/ghii register, for
 *     reuse by the email-invitation accept flow.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, GHIIRecord, OwnerRecord } from '../storage/interface.js';
import { generateKeyPair } from '../auth/keypair.js';

/** SHA-256 hex of a normalized email — matches GHII.emailHash hashing everywhere else. */
function emailHashOf(email: string): string {
  return createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

export interface ProvisionOwnerOpts {
  /** Bare owner name (already validated + confirmed free by the caller). */
  username: string;
  displayName: string;
  /** scrypt password hash for cross-device login (omit for social/link-only accounts). */
  passwordHash?: string;
  locale?: string;
  bio?: string;
  /** Email to record as a VERIFIED email (verificationLevel 1) — the IdP or invite proves reachability. */
  verifiedEmail?: string | null;
  /** Enable passwordless magic-link login for this account (invite path — email already proven). */
  enableMagicLink?: boolean;
  /** { providerId: stableSubject } for a linked external (OIDC) identity. */
  externalIdentities?: Record<string, string>;
  /** Fast/back-compat mirror of externalIdentities.google. */
  googleSub?: string;
}

export interface ProvisionedOwner {
  owner: OwnerRecord;
  ghii: GHIIRecord;
}

/**
 * Create a fresh owner + GHII with the welcome bonus. The caller MUST have already validated that
 * `username` is a valid, free owner name. Promotes the account to operator when it is the first real
 * owner or when no operator exists anywhere (self-heal — identical to registration).
 */
export async function provisionOwner(
  storage: Storage,
  config: AimeatConfig,
  opts: ProvisionOwnerOpts,
): Promise<ProvisionedOwner> {
  const { username, displayName } = opts;
  const now = new Date().toISOString();
  const keyPair = await generateKeyPair();

  // First real owner becomes operator (self-heal: also promote if no operator exists anywhere).
  const allOwners = await storage.listOwners();
  const realOwners = allOwners.filter(o => o.name !== 'anonymous');
  const hasOperator = allOwners.some(o => o.roles.includes('operator'));
  const roles: string[] = ['owner'];
  if (realOwners.length === 0 || !hasOperator) roles.push('operator');

  const owner = await storage.createOwner({
    name: username,
    displayName,
    publicKey: keyPair.publicKey,
    roles,
    createdAt: now,
  });

  const verified = opts.verifiedEmail ? opts.verifiedEmail.toLowerCase().trim() : null;
  const ghii = `${username}@${config.nodeId}`;
  const ghiiRecord = await storage.createGHII({
    username,
    nodeId: config.nodeId,
    ghii,
    displayName,
    passwordHash: opts.passwordHash,
    locale: opts.locale,
    bio: opts.bio,
    externalIdentities: opts.externalIdentities,
    googleSub: opts.googleSub,
    emailHash: verified ? emailHashOf(verified) : undefined,
    emailVerifiedAt: verified ? now : undefined,
    notificationEmail: verified ?? undefined,
    magicLinkEnabled: opts.enableMagicLink === true ? true : undefined,
    verificationLevel: verified ? 1 : 0,
    verificationMethod: verified ? 'email' : undefined,
    ownerName: owner.name,
    totpEnabled: false,
    morselBalance: config.welcomeBonus,
    loginCount: 0,
    createdAt: now,
    updatedAt: now,
  });

  if (config.welcomeBonus > 0) {
    await storage.addTransaction({
      id: `tx-${randomUUID()}`,
      gaii: ghii,
      type: 'welcome_bonus',
      amount: config.welcomeBonus,
      timestamp: now,
    });
  }

  return { owner, ghii: ghiiRecord };
}
