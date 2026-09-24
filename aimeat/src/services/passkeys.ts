/**
 * @file src/services/passkeys.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Passkeys (WebAuthn): the four ceremonies, and the short-lived challenges that hold
 *   them together. A sign-in method of its OWN — username plus the device's own check — rather than
 *   a second factor bolted onto the password. The password and two-step sign-in stay beside it for
 *   whoever has no device to register.
 *
 *   THE CRYPTOGRAPHY IS NOT OURS. @simplewebauthn/server (MIT) parses the CBOR, reads the COSE key
 *   and checks the signature. Rolling that by hand is how WebAuthn implementations get broken, and
 *   a verification that is wrong in the permissive direction accepts a forged assertion silently.
 *   What lives here is everything around it: which challenge, whose credential, what the answer is.
 *
 *   THE CHALLENGE STORE IS IN MEMORY, on purpose and with a limit. A challenge is a random value
 *   that must be used once, within a minute, by the browser it was handed to. Putting it in the
 *   database would make every sign-in two extra writes for a value whose whole life is 60 seconds.
 *
 *   AND IT STAYS IN MEMORY, because a node is one process. This platform does not grow by putting
 *   replicas behind one address; it grows by there being more nodes, each its own, federated. A
 *   ceremony therefore begins and ends in the same process by construction, and there is no shared
 *   store to add later. Same reasoning as the rate limiter (middleware/rate-limit.ts), whose note
 *   about a shared store is about a deployment shape this platform does not have.
 *
 *   THE RELYING PARTY ID IS THE HOST, and a passkey is bound to it forever. Changing this node's
 *   domain makes every registered key unusable, which is why config derives it from baseUrl rather
 *   than letting it drift as a setting somebody edits.
 *
 *   A PASSKEY IS TWO FACTORS ONLY WHEN THE DEVICE CHECKED THE PERSON. The device holds the key
 *   (something the person has); a PIN, a fingerprint or a face on the device is the second factor,
 *   and the user-verification (UV) flag in its answer says that check happened. An account whose
 *   owner armed two-step sign-in asked for two factors, so for that account a passkey answer without
 *   UV is refused, at sign-in and when a device is added. Every other account keeps presence alone.
 *
 * @structure
 *   - twoStepArmed: does this account ask for two factors (the password door's own test)
 *   - beginRegistration / finishRegistration: add a device to an account that is already signed in
 *   - beginLogin / finishLogin: sign in with a device, by username or discoverable
 *   - PasskeyCeremony: what a caller gets back, and the refusal shape both doors render
 * @usage const r = await beginLogin(config, storage, 'alice');
 * @version-history
 *   v1.2.0 — 2026-09-24 — An account that armed two-step sign-in requires user verification: its
 *     sign-in and registration options ask for it, and finishLogin and finishRegistration refuse an
 *     answer without it (PASSKEY_USER_NOT_VERIFIED). A key with no PIN had entered such an account
 *     with one factor (audit A3-2). Other accounts are unchanged.
 *   v1.1.0 — 2026-09-14 — finishLogin refuses a missing or deactivated account BEFORE it marks the
 *     device as used, and returns the account record it read. The counter and "last used" were
 *     stored between the signature check and the account check, so a refused sign-in showed on the
 *     owner's own device list as one that happened. Invariant 14.
 *   v1.0.0 — 2026-09-04 — Initial.
 */
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { AimeatConfig } from '../config.js';
import type { Storage, GHIIRecord } from '../storage/interface.js';
import type { PasskeyRecord } from '../storage/types/passkeys.js';
import { logger } from '../utils/logger.js';

/** A ceremony lives one minute. Long enough for a fingerprint, short enough not to be a store. */
const CHALLENGE_TTL_MS = 60_000;
/** A ceiling, so an unauthenticated door cannot be used to fill this process's memory. */
const MAX_PENDING = 5000;

interface PendingCeremony {
  challenge: string;
  expiresAt: number;
  /** Set for a registration, and for a login where the person named themselves. */
  owner?: string;
}

const pending = new Map<string, PendingCeremony>();

/** Drop what has expired. Called on every write, so the map cannot outgrow its own traffic. */
function sweep(): void {
  const now = Date.now();
  for (const [id, c] of pending) if (c.expiresAt <= now) pending.delete(id);
}

function remember(challenge: string, owner?: string): string {
  sweep();
  if (pending.size >= MAX_PENDING) {
    // Full means somebody is hammering the door. Refuse the NEW one rather than evicting a
    // ceremony a real person is halfway through.
    throw new Error('PASSKEY_BUSY');
  }
  const id = crypto.randomUUID();
  pending.set(id, { challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS, owner });
  return id;
}

/** Take the ceremony, whether it succeeds or not: a challenge is used once either way. */
function take(id: string): PendingCeremony | null {
  sweep();
  const c = pending.get(id);
  if (!c) return null;
  pending.delete(id);
  return c.expiresAt > Date.now() ? c : null;
}

export type PasskeyResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

/** Every origin a ceremony may legitimately come from. The node's own always counts. */
function expectedOrigins(config: AimeatConfig): string[] {
  const own = config.baseUrl.replace(/\/+$/, '');
  return [own, ...config.passkeyExtraOrigins];
}

function disabled(config: AimeatConfig): PasskeyResult<never> | null {
  if (config.passkeyEnabled) return null;
  return { ok: false, status: 503, code: 'FEATURE_DISABLED', message: 'Passkeys are not enabled on this node.' };
}

/**
 * Does this account ask for two factors? The same test the password door applies before it asks for
 * a code (routes/ghii/register-login.ts): a confirmed setup with a secret behind it. A setup that was
 * started and never confirmed does not count there, so it does not count here.
 */
export function twoStepArmed(account: Pick<GHIIRecord, 'totpEnabled' | 'totpSecret'> | null | undefined): boolean {
  return !!account && account.totpEnabled === true && !!account.totpSecret;
}

/** The refusal for an answer without user verification, on an account that needs it. */
function userNotVerified(status: number, whatToDo: string): PasskeyResult<never> {
  return {
    ok: false, status, code: 'PASSKEY_USER_NOT_VERIFIED',
    message: `This device did not check that it is you with a PIN, a fingerprint or your face. Your account uses two-step sign-in, so a passkey must do that. ${whatToDo}`,
  };
}

// ── Registering a device on an account that is already signed in ──

export interface BeginRegistrationData {
  ceremony_id: string;
  /** Handed to navigator.credentials.create() as-is. */
  options: Awaited<ReturnType<typeof generateRegistrationOptions>>;
}

/**
 * Options for adding a device. `excludeCredentials` carries what this account already has, so the
 * browser says "you already registered this one" instead of quietly making a second key for the
 * same device — which would leave the person with a list they cannot tell apart.
 */
export async function beginRegistration(
  config: AimeatConfig, storage: Storage, owner: string, displayName: string,
): Promise<PasskeyResult<BeginRegistrationData>> {
  const off = disabled(config); if (off) return off;

  const existing = await storage.listPasskeysByOwner(owner);
  // On an account with two-step sign-in armed, a passkey signs in only when the device checked the
  // person (finishLogin), so the device is asked to do that from the first ceremony on.
  const userVerification = twoStepArmed(await storage.getGHIIByOwner(owner)) ? 'required' : 'preferred';
  let options: Awaited<ReturnType<typeof generateRegistrationOptions>>;
  try {
    options = await generateRegistrationOptions({
      rpName: config.passkeyRpName,
      rpID: config.passkeyRpId,
      userName: owner,
      userDisplayName: displayName || owner,
      // The account name is stable and is what the device shows in its own list, so the user handle
      // is derived from it rather than random: a person who deletes every key and starts again gets
      // one entry on their phone, not a growing pile of identical ones.
      userID: new TextEncoder().encode(owner),
      attestationType: 'none',
      excludeCredentials: existing.map(p => ({ id: p.id, transports: p.transports })),
      authenticatorSelection: {
        // Discoverable, so signing in can start from the device rather than from a typed username.
        residentKey: 'preferred',
        userVerification,
      },
    });
  } catch (err) {
    logger.warn('passkey: could not build registration options', { error: String(err) });
    return { ok: false, status: 500, code: 'INTERNAL', message: 'This one is on us — the passkey setup could not start.' };
  }

  try {
    return { ok: true, data: { ceremony_id: remember(options.challenge, owner), options } };
  } catch {
    return { ok: false, status: 503, code: 'PASSKEY_BUSY', message: 'Too many sign-ins in flight right now. Try again in a moment.' };
  }
}

/** Store the credential the device just made. The label is the person's to change afterwards. */
export async function finishRegistration(
  config: AimeatConfig, storage: Storage,
  args: { ceremonyId: string; owner: string; ghii: string; label: string; response: unknown },
): Promise<PasskeyResult<{ passkey: PasskeyRecord }>> {
  const off = disabled(config); if (off) return off;

  const ceremony = take(args.ceremonyId);
  if (!ceremony || ceremony.owner !== args.owner) {
    return { ok: false, status: 400, code: 'PASSKEY_CHALLENGE_EXPIRED', message: 'That took too long. Start again.' };
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      response: args.response as any,
      expectedChallenge: ceremony.challenge,
      expectedOrigin: expectedOrigins(config),
      expectedRPID: config.passkeyRpId,
      // Decided below, per account, with a refusal that says what to do.
      requireUserVerification: false,
    });
  } catch (err) {
    return { ok: false, status: 400, code: 'PASSKEY_INVALID', message: `That device's answer did not check out: ${String((err as Error).message ?? err)}` };
  }

  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, status: 400, code: 'PASSKEY_INVALID', message: 'That device\'s answer did not check out.' };
  }

  const info = verification.registrationInfo;
  // A device that did not check the person could never sign in to an account with two-step
  // sign-in armed, so it is refused here, where the person can still act on it, not stored as a
  // way in that is always refused.
  if (!info.userVerified && twoStepArmed(await storage.getGHIIByOwner(args.owner))) {
    return userNotVerified(400, 'Set a PIN on this device, or add one that checks your fingerprint or face.');
  }
  // REFUSE BEFORE YOU WRITE: a credential id is unique across the node, and one that already exists
  // belongs to whoever registered it first. Writing first and checking after would let a second
  // account claim a device that is already somebody's way in.
  if (await storage.getPasskey(info.credential.id)) {
    return { ok: false, status: 409, code: 'PASSKEY_EXISTS', message: 'That device is already registered here.' };
  }

  const record: PasskeyRecord = {
    id: info.credential.id,
    ghii: args.ghii,
    owner: args.owner,
    publicKey: Buffer.from(info.credential.publicKey).toString('base64url'),
    counter: info.credential.counter,
    transports: info.credential.transports ?? [],
    label: (args.label || '').slice(0, 80) || 'Passkey',
    aaguid: info.aaguid ?? '',
    backedUp: info.credentialBackedUp,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };
  await storage.createPasskey(record);
  return { ok: true, data: { passkey: record } };
}

// ── Signing in with a device ──

export interface BeginLoginData {
  ceremony_id: string;
  options: Awaited<ReturnType<typeof generateAuthenticationOptions>>;
}

/**
 * Options for signing in.
 *
 * WITH a username the browser is told which credentials to offer, which is what an older
 * authenticator needs. WITHOUT one the ceremony is discoverable: the device offers whatever it
 * holds for this domain and the answer names the account. The second is the better experience and
 * the one the sign-in button uses.
 *
 * A username that does not exist is answered the SAME WAY as one that does — an empty allow-list,
 * a real challenge — because this door takes no credential and would otherwise tell anyone who
 * types a name whether an account by that name is here.
 *
 * A named account that has passkeys AND two-step sign-in armed is asked for user verification, so
 * the browser asks for the PIN or the fingerprint before the touch, not after a refusal. That tells
 * whoever types the name one more fact, on an account whose device list the allow-list already
 * names. A name with no passkeys is not asked, so it still answers like a name that does not exist.
 * The discoverable flow cannot know the account yet; finishLogin enforces the rule for both.
 */
export async function beginLogin(
  config: AimeatConfig, storage: Storage, username?: string,
): Promise<PasskeyResult<BeginLoginData>> {
  const off = disabled(config); if (off) return off;

  let allow: { id: string; transports?: string[] }[] = [];
  let userVerification: 'required' | 'preferred' = 'preferred';
  const named = (username ?? '').trim().toLowerCase();
  if (named) {
    const keys = await storage.listPasskeysByOwner(named);
    allow = keys.map(p => ({ id: p.id, transports: p.transports }));
    if (keys.length && twoStepArmed(await storage.getGHIIByOwner(named))) userVerification = 'required';
  }

  const options = await generateAuthenticationOptions({
    rpID: config.passkeyRpId,
    allowCredentials: allow,
    userVerification,
  });

  try {
    return { ok: true, data: { ceremony_id: remember(options.challenge, named || undefined), options } };
  } catch {
    return { ok: false, status: 503, code: 'PASSKEY_BUSY', message: 'Too many sign-ins in flight right now. Try again in a moment.' };
  }
}

export interface FinishLoginData {
  passkey: PasskeyRecord;
  /** The account the device answered for, read here so the route does not read it a second time. */
  ghiiRecord: GHIIRecord;
}

/**
 * Check the device's answer and say whose account it is. Minting the session is the login route's
 * job, so a passkey sign-in and a password sign-in end in exactly the same place.
 *
 * The counter is compared by the library and the new value is stored here. An authenticator that
 * always reports 0 is not counting, which is normal and not a refusal.
 */
export async function finishLogin(
  config: AimeatConfig, storage: Storage,
  args: { ceremonyId: string; response: { id?: string } & Record<string, unknown> },
): Promise<PasskeyResult<FinishLoginData>> {
  const off = disabled(config); if (off) return off;

  const ceremony = take(args.ceremonyId);
  if (!ceremony) {
    return { ok: false, status: 400, code: 'PASSKEY_CHALLENGE_EXPIRED', message: 'That took too long. Start again.' };
  }

  const credentialId = typeof args.response?.id === 'string' ? args.response.id : '';
  const stored = credentialId ? await storage.getPasskey(credentialId) : null;
  if (!stored) {
    return { ok: false, status: 401, code: 'PASSKEY_UNKNOWN', message: 'That device is not registered here. Sign in with your password, then add it under Account security.' };
  }
  // A ceremony started under a name must finish under the same account, or naming one person and
  // answering as another would be a way in.
  if (ceremony.owner && ceremony.owner !== stored.owner) {
    return { ok: false, status: 401, code: 'PASSKEY_UNKNOWN', message: 'That device is not registered here. Sign in with your password, then add it under Account security.' };
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      response: args.response as any,
      expectedChallenge: ceremony.challenge,
      expectedOrigin: expectedOrigins(config),
      expectedRPID: config.passkeyRpId,
      credential: {
        id: stored.id,
        publicKey: new Uint8Array(Buffer.from(stored.publicKey, 'base64url')),
        counter: stored.counter,
        transports: stored.transports,
      },
      // NOT asked of the library, on purpose. It checks the flag BEFORE the signature, so a forged
      // answer without the flag would learn whether this account has two-step sign-in armed. The
      // rule is applied below, once the signature has proved the answer came from the device.
      requireUserVerification: false,
    });
  } catch (err) {
    return { ok: false, status: 401, code: 'PASSKEY_INVALID', message: `That device's answer did not check out: ${String((err as Error).message ?? err)}` };
  }

  if (!verification.verified) {
    return { ok: false, status: 401, code: 'PASSKEY_INVALID', message: 'That device\'s answer did not check out.' };
  }

  // REFUSE BEFORE THE WRITE. The device's answer is good, but the account behind it may be gone or
  // deactivated, and the mark this makes is the device's "last used" — the line an owner reads on
  // their own device list to tell a sign-in they do not recognise from one they do. Writing it for
  // a sign-in that is then refused says the device signed in when it did not. Asked HERE and not
  // before the signature, for the same reason the password door refuses a deactivated account after
  // the password: answering earlier would tell anyone who types a username what state it is in.
  // Invariant 14. Found by the AI triage of 2026-09-13.
  const ghiiRecord = await storage.getGHIIByOwner(stored.owner);
  if (!ghiiRecord) {
    return { ok: false, status: 401, code: 'PASSKEY_UNKNOWN', message: 'That device is not registered here. Sign in with your password, then add it under Account security.' };
  }
  const owner = await storage.getOwner(stored.owner);
  if (owner?.disabledAt) {
    return { ok: false, status: 403, code: 'ACCOUNT_DISABLED', message: 'This account has been deactivated' };
  }

  // TWO FACTORS WHERE THE OWNER ASKED FOR TWO. This door completes a login with no code step, so on
  // an account with two-step sign-in armed the device's own check of the person is the second
  // factor. Without the UV flag the answer proves possession only, which is one. Refused before the
  // write, like the two refusals above.
  if (!verification.authenticationInfo.userVerified && twoStepArmed(ghiiRecord)) {
    return userNotVerified(401, 'Use a device that does, or sign in with your password and your code.');
  }

  const usedAt = new Date().toISOString();
  await storage.touchPasskey(stored.id, verification.authenticationInfo.newCounter, usedAt);
  return {
    ok: true,
    data: { passkey: { ...stored, counter: verification.authenticationInfo.newCounter, lastUsedAt: usedAt }, ghiiRecord },
  };
}

/** TEST SEAM: forget every pending ceremony. Never called by the server. */
export function _resetPasskeyCeremonies(): void {
  pending.clear();
}
