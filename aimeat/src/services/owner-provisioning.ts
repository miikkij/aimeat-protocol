/**
 * @file owner-provisioning.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Single source of truth for minting a brand-new owner + GHII account: generates the
 *   owner keypair, applies the first-owner→operator self-heal, creates the OwnerRecord + GHII
 *   profile (optionally with a password hash, a verified email, and/or a linked external identity),
 *   and records the welcome-bonus transaction. Used by the OIDC signup finalize path and the email
 *   invitation accept path so account creation stays identical across entry points.
 * @structure emailHashOf; ProvisionEmailTakenError; creditWelcomeBonus; ProvisionOwnerOpts / ProvisionedOwner; provisionOwner(storage, config, opts).
 * @usage const { owner, ghii } = await provisionOwner(storage, config, { username, displayName, passwordHash });
 * @version-history
 *   v1.8.0 — 2026-10-15 — ownerRegistrationRefusal / announceOwnerRegistered: the registration hooks run
 *     on every account-creating route, provisionOwner included, and a refusal throws
 *     RegistrationHookRefusedError before any row exists (feature-list audit 89).
 *   v1.7.0 — 2026-10-15 — createdAccountIsOperator: the one operator rule for every account-creating
 *     route; provisionOwner asks it too (feature-list audit 19).
 *   v1.6.1 — 2026-10-05 — Whether an operator exists is read with isOperatorAccount (secaudit 2026-10, C2).
 *   v1.6.0 — 2026-10-01 — An account created with an already-proven address takes up the open app
 *     roster invitations of that address (services/app-member-invites.ts), beside the contact promotion.
 *   v1.5.0 — 2026-09-14 — creditWelcomeBonus() is exported, and the two registration routes that
 *     minted their own accounts call it instead of writing the transaction themselves. The bonus was
 *     the same eight lines in three files, so its amount and its condition had three homes.
 *   v1.4.0 — 2026-08-24 — via: 'provisioning' (BR-04 SCIM): an organisation's directory pushing an
 *     account is an administrator's act, refused only under `closed`; and it never triggers the
 *     first-owner→operator self-heal, so a directory sync cannot crown a node's operator.
 *   v1.3.0 — 2026-08-21 — The 'oauth' registration mode: a first sign-in through a configured
 *     identity provider creates the account, the password doors stay refused. The mode an
 *     organisation node wants — who exists is decided in the IdP (for Entra, the tenant allowlist
 *     in oidc-providers.ts), not by who found the registration form.
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
import { isOperatorAccount } from '../utils/operator-account.js';
import { promoteContactsForVerifiedEmail } from './contacts.js';
import { applyAppInvitesForVerifiedEmail } from './app-member-invites.js';
import { executeHooks } from './hooks.js';
import { fireHook } from '../utils/fire-hook.js';

/** SHA-256 hex of a normalized email — matches GHII.emailHash hashing everywhere else. */
export function emailHashOf(email: string): string {
  return createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

/** Thrown by provisionOwner when the requested verified email is already bound to another account.
 *  Callers map it to a 409 EMAIL_TAKEN. */
export class ProvisionEmailTakenError extends Error {
  constructor(message: string) { super(message); this.name = 'ProvisionEmailTakenError'; }
}

/**
 * How a new account is arriving. The registration-mode gate decides by this:
 *  - 'direct'       — anyone who found the door: API/web registration, the self-service invite request
 *  - 'oauth'        — a first sign-in through an external identity provider, OIDC or SAML (an
 *                     existing linked account is a LOGIN and is never gated)
 *  - 'invitation'   — a member of this node minted an invitation (email invite, code key) and someone
 *                     is redeeming it
 *  - 'provisioning' — an organisation's directory pushed the account over SCIM (BR-04): an
 *                     administrator's act, not a visitor's, so only `closed` refuses it
 */
export type RegistrationVia = 'direct' | 'oauth' | 'invitation' | 'provisioning';

/** Thrown by provisionOwner when config.registrationMode refuses this creation. Callers map it to
 *  403 REGISTRATION_CLOSED. Routes SHOULD also refuse at the door with registrationRefusal() so the
 *  visitor gets the answer before any work happens; this throw is the backstop that makes a
 *  forgotten door impossible. */
export class RegistrationClosedError extends Error {
  readonly code: string = 'REGISTRATION_CLOSED';
  constructor(message: string) { super(message); this.name = 'RegistrationClosedError'; }
}

/** Thrown by provisionOwner when an extension action bound to pre_owner_registration refuses the
 *  account. It is a RegistrationClosedError, so every caller that maps that one to a 403 maps this one
 *  too, with the code HOOK_REJECTED that POST /v1/owners answers. */
export class RegistrationHookRefusedError extends RegistrationClosedError {
  override readonly code: string = 'HOOK_REJECTED';
  constructor(message: string) { super(message); this.name = 'RegistrationHookRefusedError'; }
}

/**
 * Whether an extension bound to pre_owner_registration refuses this account. Returns the refusal
 * message, or null when the creation may proceed. Every account-creating route asks it before any row
 * exists: the hook ran only on POST /v1/owners, and an account made through POST /v1/ghii,
 * register-web, an identity provider, an invitation, SCIM or an install set skipped it, although the
 * operator binds the hook to stop account creation (feature-list audit 89).
 */
export async function ownerRegistrationRefusal(
  storage: Storage,
  config: AimeatConfig,
  ctx: { name: string; displayName?: string; via: RegistrationVia },
): Promise<string | null> {
  const result = await executeHooks(config, storage, 'pre_owner_registration',
    { name: ctx.name, display_name: ctx.displayName, via: ctx.via });
  if (result.allowed) return null;
  return result.reason ?? 'An extension on this node refused the registration.';
}

/** Tell the extensions bound to post_owner_registration that the account exists. Fire-and-forget. */
export function announceOwnerRegistered(
  storage: Storage,
  config: AimeatConfig,
  owner: { name: string; roles: string[] },
  via: RegistrationVia,
): void {
  fireHook(config, storage, 'post_owner_registration', { name: owner.name, roles: owner.roles, via });
}

/**
 * Does the node's registration mode refuse an account arriving this way? Returns the refusal
 * message, or null when the creation may proceed. One rule table, read everywhere:
 *
 *              direct   oauth   invitation   provisioning
 *   open        yes      yes      yes           yes
 *   oauth       no       yes      yes           yes
 *   invite      no       no       yes           yes
 *   closed      no       no       no            no
 */
export function registrationRefusal(config: AimeatConfig, via: RegistrationVia): string | null {
  const mode = config.registrationMode;
  if (mode === 'closed') return 'This node does not accept new accounts.';
  if (via === 'provisioning') return null;  // the operator configured the connection; only `closed` refuses
  if (mode === 'invite' && via !== 'invitation') {
    return 'This node creates new accounts by invitation only. Ask a member of this node to send you an invitation.';
  }
  if (mode === 'oauth' && via === 'direct') {
    return 'This node creates new accounts by signing in with an approved identity provider, or by invitation. Registering with a username and password is not available here.';
  }
  return null;
}

/**
 * The welcome bonus, written once for every door that creates an account.
 *
 * Three doors mint accounts: this file's provisionOwner (OAuth, invitation, SCIM), POST /v1/ghii and
 * POST /v1/ghii/register-web. All three had the same eight lines pasted in, so the amount, the
 * condition and the transaction's shape lived in three places and a change to the rule would have
 * reached one of them. What differs between the doors is only WHEN the account exists; the credit
 * itself is one decision, and it is this one.
 *
 * `now` is the account's creation timestamp, passed in so the bonus carries the same instant as the
 * GHII record rather than a few milliseconds later.
 */
export async function creditWelcomeBonus(
  storage: Storage,
  config: AimeatConfig,
  ghii: string,
  now: string,
): Promise<void> {
  if (config.welcomeBonus <= 0) return;
  await storage.addTransaction({
    id: `tx-${randomUUID()}`,
    gaii: ghii,
    type: 'welcome_bonus',
    amount: config.welcomeBonus,
    timestamp: now,
  });
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
 * Whether an account created now becomes the node's operator: it is the first real owner, or no
 * operator exists anywhere (the self-heal registration and sign-in already apply). The one answer
 * every account-creating route asks. POST /v1/ghii/register-web and POST /v1/owners asked "first
 * owner only", so who became operator depended on the route (feature-list audit 19).
 */
export async function createdAccountIsOperator(storage: Storage): Promise<boolean> {
  const allOwners = await storage.listOwners();
  const realOwners = allOwners.filter(o => o.name !== 'anonymous');
  return realOwners.length === 0 || !allOwners.some(isOperatorAccount);
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

  // The operator's registration gate, before any row exists (feature-list audit 89).
  const hookRefusal = await ownerRegistrationRefusal(storage, config, { name: username, displayName, via: opts.via });
  if (hookRefusal) throw new RegistrationHookRefusedError(hookRefusal);

  const keyPair = await generateKeyPair();

  // First real owner becomes operator (self-heal: also promote if no operator exists anywhere) —
  // EXCEPT over SCIM (BR-04 R13's flip side): a directory sync is nobody's decision to run this
  // node, so the first Entra-provisioned user on a fresh node must not be crowned its operator.
  const roles: string[] = ['owner'];
  if (opts.via !== 'provisioning' && await createdAccountIsOperator(storage)) roles.push('operator');

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
    // An app roster invitation sent to this address becomes a membership (services/app-member-invites.ts).
    await applyAppInvitesForVerifiedEmail(storage, config.nodeId, emailHashOf(verified), ghii)
      .catch(err => { logger.warn('provisionOwner: app invitations are best-effort', { error: String(err) }); });
  }

  await creditWelcomeBonus(storage, config, ghii, now);

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

  announceOwnerRegistered(storage, config, owner, opts.via);

  return { owner, ghii: ghiiRecord };
}
