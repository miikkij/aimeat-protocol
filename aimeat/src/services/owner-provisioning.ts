/**
 * @file owner-provisioning.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Single source of truth for minting a brand-new owner + GHII account: generates the
 *   owner keypair, applies the first-owner→operator self-heal, creates the OwnerRecord + GHII
 *   profile (optionally with a password hash, a verified email, and/or a linked external identity),
 *   and records the welcome-bonus transaction. Used by the OIDC signup finalize path and the email
 *   invitation accept path so account creation stays identical across entry points.
 * @structure ProvisionEmailTakenError; ProvisionOwnerOpts / ProvisionedOwner; provisionOwner(storage, config, opts).
 * @usage const { owner, ghii } = await provisionOwner(storage, config, { username, displayName, passwordHash });
 * @version-history
 *   v1.2.0 — 2026-08-18 — Registration-mode gate (open|invite|closed): registrationRefusal() is the
 *     one rule table, every ProvisionOwnerOpts carries a required `via`, and provisionOwner throws
 *     RegistrationClosedError as the backstop behind the per-door checks.
 *   v1.1.0 — 2026-07-19 — Enforce one-verified-email-per-account-per-node: reject a verifiedEmail already
 *     bound elsewhere BEFORE creating any rows (ProvisionEmailTakenError), so the DB-unique emailHash can
 *     never leave a dangling owner.
 *   v1.0.0 — 2026-07-04 — Extracted from oauth-login.createOwnerForProvider + /v1/ghii register, for
 *     reuse by the email-invitation accept flow.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, GHIIRecord, OwnerRecord } from '../storage/interface.js';
import { generateKeyPair } from '../auth/keypair.js';
import { logger } from '../utils/logger.js';
import { promoteContactsForVerifiedEmail } from './contacts.js';

/** SHA-256 hex of a normalized email — matches GHII.emailHash hashing everywhere else. */
function emailHashOf(email: string): string {
  return createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

/** Thrown by provisionOwner when the requested verified email is already bound to another account.
 *  Callers map it to a 409 EMAIL_TAKEN. */
export class ProvisionEmailTakenError extends Error {
  constructor(message: string) { super(message); this.name = 'ProvisionEmailTakenError'; }
}

/**
 * How a new account is arriving. The registration-mode gate decides by this:
 *  - 'direct'     — anyone who found the door: API/web registration, the self-service invite request
 *  - 'oauth'      — a first sign-in through an OIDC provider (an existing linked account is a LOGIN
 *                   and is never gated)
 *  - 'invitation' — a member of this node minted an invitation (email invite, code key) and someone
 *                   is redeeming it
 */
export type RegistrationVia = 'direct' | 'oauth' | 'invitation';

/** Thrown by provisionOwner when config.registrationMode refuses this creation. Callers map it to
 *  403 REGISTRATION_CLOSED. Routes SHOULD also refuse at the door with registrationRefusal() so the
 *  visitor gets the answer before any work happens; this throw is the backstop that makes a
 *  forgotten door impossible. */
export class RegistrationClosedError extends Error {
  readonly code = 'REGISTRATION_CLOSED';
  constructor(message: string) { super(message); this.name = 'RegistrationClosedError'; }
}

/**
 * Does the node's registration mode refuse an account arriving this way? Returns the refusal
 * message, or null when the creation may proceed. One rule table, read everywhere:
 *
 *              direct   oauth   invitation
 *   open        yes      yes      yes
 *   invite      no       no       yes
 *   closed      no       no       no
 */
export function registrationRefusal(config: AimeatConfig, via: RegistrationVia): string | null {
  const mode = config.registrationMode;
  if (mode === 'closed') return 'This node does not accept new accounts.';
  if (mode === 'invite' && via !== 'invitation') {
    return 'This node creates new accounts by invitation only. Ask a member of this node to send you an invitation.';
  }
  return null;
}

export interface ProvisionOwnerOpts {
  /** How this account is arriving — the registration-mode gate decides by it. REQUIRED so the
   *  compiler forces every new call site to classify itself (see {@link RegistrationVia}). */
  via: RegistrationVia;
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

  // Registration-mode backstop. Refuse BEFORE any row exists — the routes already answered the
  // visitor at the door; this is what makes a door that forgot the check impossible.
  const refusal = registrationRefusal(config, opts.via);
  if (refusal) throw new RegistrationClosedError(refusal);

  // One-email-per-account-per-node: refuse to provision a verified email already bound elsewhere BEFORE
  // creating any rows (the GHII's emailHash is DB-unique — creating the owner first would leave a
  // dangling owner when createGHII hit the constraint). Callers surface this as a clean 4xx.
  const verifiedEmail = opts.verifiedEmail ? opts.verifiedEmail.toLowerCase().trim() : null;
  if (verifiedEmail) {
    const taken = await storage.getGHIIByEmailHash(emailHashOf(verifiedEmail));
    if (taken) {
      throw new ProvisionEmailTakenError(`Email already registered to ${taken.ghii}`);
    }
  }

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

  const verified = verifiedEmail;
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

  // An account created with an ALREADY-proven address is the third way a verified binding comes
  // into being, so it links address-book entries exactly as the two verification routes do
  // (TARGET-063). Best-effort: provisioning must not fail because a contact could not be linked.
  if (verified) {
    await promoteContactsForVerifiedEmail(storage, emailHashOf(verified), ghii)
      .catch(err => { logger.warn('provisionOwner: contact promotion is best-effort', { error: String(err) }); });
  }

  if (config.welcomeBonus > 0) {
    await storage.addTransaction({
      id: `tx-${randomUUID()}`,
      gaii: ghii,
      type: 'welcome_bonus',
      amount: config.welcomeBonus,
      timestamp: now,
    });
  }

  // Which onboarding path this account was created on (05-mittaus.md). This is the SHARED
  // account-creation core — invitation accept (including the agent door), OAuth sign-up and
  // code-key provisioning all land here — so the marker belongs here rather than at each door.
  // It was missing, and every account made through any of them read as `legacy`: created on the
  // new path, invisible to its numbers, and quietly padding the old path's instead.
  void import('./onboarding-funnel.js')
    .then(m => m.recordTrack(storage, config, owner.name))
    .catch(err => logger.warn('provisionOwner: track marker failed', { error: String(err) }));

  // The operator's welcome, so the mailbox is not empty on day one. Fire-and-forget for the same
  // reason as the marker above: a greeting must never be able to turn a signup into a 500.
  void import('./welcome-message.js')
    .then(m => m.sendOperatorWelcome(storage, config, owner.name))
    .catch(err => logger.warn('provisionOwner: welcome message failed', { error: String(err) }));

  return { owner, ghii: ghiiRecord };
}
