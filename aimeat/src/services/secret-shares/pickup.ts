/**
 * @file src/services/secret-shares/pickup.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Picking a secret share up: decide who is asking (a named person, an organism member,
 *   their agent, or a code holder), decide what they may receive under the share's protection, count
 *   one pickup atomically, and hand over the content, or copy it into the picker's vault.
 *
 *   THE PROTECTION DECIDES WHAT AN AGENT RECEIVES (Jouni, 2026-11-14).
 *   - open: anyone allowed receives the content, agents included.
 *   - sealed: an agent never receives the content. It may put it into its owner's vault (to: vault),
 *     where it is used through {{secret:NAME}} and never read back. A person signed in, or a code
 *     holder, receives it. A code holder with no sign-in is whoever holds the code: the node cannot
 *     tell a person from a script there, and the maker chose that when they chose a code alone.
 *   - e2e: only a recipient's own registered device opens it. The node hands over the envelope and
 *     that person's wrapped keys (or the code salt), and refuses every agent and every vault copy.
 *
 *   EVERY CHECK BEFORE THE COUNT. The vault name, size and address are checked, and the code
 *   compared, before claimSecretSharePickup spends a pickup; a pickup is spent only on a call that
 *   then succeeds.
 *
 *   GUESSING A CODE DOES NOT PAY. Wrong codes are counted per share and per address, 10 in 15
 *   minutes each, and past that the route answers 429 until the window ends.
 * @structure PickupResult · verifyShareCode · pickupShare
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-holvi-salaisuuksien-talletus-jako-ja-nouto-ihmisille-ja-agen).
 */
import type { SecretShareRecord } from '../../storage/types/secret-shares.js';
import type { CallerContext } from '../caller-context.js';
import { decrypt, getEncryptionKey } from '../encryption.js';
import { emitChange } from '../event-bus.js';
import { windowCounter } from '../ephemeral-claims.js';
import { normalizeSecretHost, putOwnerSecret, SECRET_MAX_BYTES, SECRET_NAME_RE, type SecretSummary } from '../owner-secrets.js';
import { hmacMatches, normalizeCode, refuse, SHARE_ID_RE, type ShareRefusal } from './rules.js';
import { scopeRefusal, shareRolesOf } from './access.js';
import { record } from './events.js';
import { tellMaker } from './notices.js';
import { shareView, publicCard, type ShareView, type ShareCard } from './view.js';
import type { ShareDeps, ShareResult } from './rules.js';

const CODE_WINDOW_MS = 15 * 60 * 1000;
const CODE_TRIES = 10;
const codeTries = windowCounter('secret-share-code');

export interface PickupResult {
  share: ShareView | ShareCard;
  /** to: reveal under open or sealed. */
  content?: { format: string; text?: string; content_base64?: string; file_name: string | null; content_type: string | null };
  /** to: vault. */
  vault?: SecretSummary;
  /** e2e: what the recipient's browser opens. */
  envelope?: string;
  wrapped_keys?: Array<{ key_id: string; wrapped: string }>;
  code_salt?: string | null;
}

const notFound = (): ShareRefusal => refuse(404, 'NOT_FOUND', 'No such secret share, or it is not yours to pick up.');
const gone = (s: SecretShareRecord): ShareRefusal => refuse(410, 'NOT_AVAILABLE',
  s.status === 'revoked' ? 'Its maker withdrew this share.' : s.status === 'waiting' ? 'This request has not been filled yet.' : 'This share has ended: its pickups or its time ran out.');

/**
 * The one verifier of a pickup code: the route's credential strategy (auth/credential-strategies.ts
 * 'secret-share-code') and pickupShare both call it. Counts a wrong code per share and per address.
 */
export async function verifyShareCode(
  deps: ShareDeps, id: string, offered: string, address: string, caller: CallerContext | null,
): Promise<{ ok: true; share: SecretShareRecord } | ShareRefusal> {
  if (!SHARE_ID_RE.test(id) || !offered) return notFound();
  const share = await deps.storage.getSecretShare(id);
  const key = getEncryptionKey(deps.config);
  if (!share || !key || !share.recipients.code || !share.codeHash) return notFound();
  const now = Date.now();
  const perShare = await codeTries.read(`share:${id}`);
  const perAddress = address ? await codeTries.read(`addr:${address}`) : null;
  const over = (c: { count: number; expiresAt: number } | null) => !!c && c.expiresAt > now && c.count >= CODE_TRIES;
  if (over(perShare) || over(perAddress)) return refuse(429, 'TOO_MANY_TRIES', 'Too many wrong codes. Wait 15 minutes and try again.');
  const value = share.protectionLevel === 'e2e' ? offered.toLowerCase() : normalizeCode(offered);
  if (!hmacMatches(key, 'code', id, value, share.codeHash)) {
    await codeTries.bump(`share:${id}`, { windowMs: CODE_WINDOW_MS });
    if (address) await codeTries.bump(`addr:${address}`, { windowMs: CODE_WINDOW_MS });
    await record(deps.storage, id, 'refused', caller, { reason: 'wrong_code' });
    return refuse(403, 'WRONG_CODE', 'That code does not open this share.');
  }
  return { ok: true, share };
}

/** A vault name from the share's name: letters, digits, underscore and hyphen, 64 at most. */
function vaultNameOf(name: string): string {
  const n = name.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
  return n || 'SECRET';
}

export async function pickupShare(
  deps: ShareDeps, caller: CallerContext | null, id: string, body: Record<string, unknown>, address = '',
): Promise<ShareResult<PickupResult>> {
  if (!SHARE_ID_RE.test(id)) return notFound();
  const share = await deps.storage.getSecretShare(id);
  if (!share) return notFound();
  const key = getEncryptionKey(deps.config);
  if (!key) return refuse(503, 'SECRET_STORE_UNAVAILABLE', 'This node has no encryption key configured.');
  const to = body.to === 'vault' ? 'vault' : 'reveal';

  // WHO. A caller with a role first; a code second.
  const members = await deps.storage.listSecretShareMembers(id);
  const roles = caller ? await shareRolesOf(deps.storage, caller, share, members) : null;
  if (caller && roles && (roles.pickup || roles.manage)) {
    const denied = scopeRefusal(caller); if (denied) return denied;
  }
  let via: 'named' | 'organism' | 'code' | null = roles?.via ?? null;
  const offered = typeof body.code === 'string' ? body.code : typeof body.code_verifier === 'string' ? body.code_verifier : '';
  if (!via && share.recipients.code && offered) {
    const verified = await verifyShareCode(deps, id, offered, address, caller);
    if (!verified.ok) return verified;
    if (share.codeLogin && !caller) return refuse(401, 'SIGN_IN_REQUIRED', 'The maker asked that this code is used signed in. Sign in and enter the code again.');
    if (caller) { const denied = scopeRefusal(caller); if (denied) return denied; }
    via = 'code';
  }
  if (!via) {
    // A named person's agent, where the maker did not allow agents, is told why.
    if (caller && roles?.agent && members.some(m => m.role === 'pickup' && m.ghii === caller.ownerGhii)) {
      return refuse(403, 'AGENTS_NOT_ALLOWED', 'The maker of this share did not allow agents to pick it up. Its person can pick it up signed in.');
    }
    if (share.recipients.code && !offered) return refuse(401, 'CODE_REQUIRED', 'This share opens with its pickup code.');
    if (roles?.manage) return refuse(403, 'NOT_A_RECIPIENT', 'You manage this share but did not name yourself as one who picks it up.');
    return notFound();
  }
  if (share.status !== 'ready') return gone(share);

  // WHAT. The protection decides; every check before the count.
  // An agent, an app grant or an ecosystem app: anything that is not the account holder in person.
  const isAgent = !!caller && !caller.isPerson;
  let vaultName = '';
  let vaultHost: string | null = null;
  if (share.protectionLevel === 'e2e') {
    if (to === 'vault') return refuse(400, 'E2E_NO_VAULT', 'An end-to-end share opens only on its recipient\'s own device, so the node cannot copy it into a vault. Open it on your device and store it yourself.');
    if (isAgent) return refuse(403, 'E2E_PERSON_ONLY', 'An end-to-end share opens only on its recipient\'s own device. An agent cannot open it.');
    if (via !== 'code' && !(share.e2eKeys ?? []).some(k => k.ghii === caller!.ownerGhii)) {
      return refuse(409, 'NO_DEVICE_KEY', 'This share was sealed for other devices than yours. Ask its maker to share it again to a device you have registered on the Vault page.');
    }
  } else if (to === 'vault') {
    if (!caller) return refuse(401, 'SIGN_IN_REQUIRED', 'Copying into a vault needs an account. Sign in, or reveal it instead.');
    if (share.secretFormat === 'file' || share.sizeBytes > SECRET_MAX_BYTES) {
      return refuse(400, 'TOO_LARGE_FOR_VAULT', `The vault holds values up to ${SECRET_MAX_BYTES} bytes that are sent in a request header, and this secret is a file or larger. Reveal it instead.`);
    }
    vaultName = typeof body.name === 'string' && body.name ? body.name : vaultNameOf(share.name);
    if (!SECRET_NAME_RE.test(vaultName)) return refuse(400, 'INVALID_SECRET_NAME', 'name is the vault name: letters, digits, underscore and hyphen, 1 to 64 characters.');
    if (body.host !== undefined && body.host !== null && body.host !== '') {
      vaultHost = normalizeSecretHost(body.host);
      if (!vaultHost) return refuse(400, 'INVALID_SECRET_HOST', 'host is the address the secret may be sent to, such as api.elevenlabs.io: no https://, no path.');
    }
  } else if (share.protectionLevel === 'sealed' && isAgent) {
    return refuse(403, 'SEALED', 'This share is sealed: an agent may put it into its owner\'s vault (to: vault) and use it from there, but never receive its content. Its person can reveal it signed in.');
  }

  // THE COUNT.
  const claimed = await deps.storage.claimSecretSharePickup(id, new Date().toISOString());
  if (!claimed || !claimed.ciphertext) return gone((await deps.storage.getSecretShare(id)) ?? share);
  // A code holder, signed in or not, is shown the card: the other recipients and the note are the
  // business of the people the share names.
  const out: PickupResult = { share: caller && via !== 'code' ? shareView(claimed, roles ?? { manage: false, pickup: true, deposit: false }, null) : publicCard(claimed) };
  if (share.protectionLevel === 'e2e') {
    out.envelope = claimed.ciphertext;
    // The content key wrapped for the code (entry ghii 'code') or for this person's devices.
    const holder = via === 'code' ? 'code' : caller!.ownerGhii;
    out.wrapped_keys = (claimed.e2eKeys ?? []).filter(k => k.ghii === holder).map(k => ({ key_id: k.keyId, wrapped: k.wrapped }));
    out.code_salt = via === 'code' ? claimed.codeSalt : null;
  } else {
    const plain = decrypt(claimed.ciphertext, key);
    if (to === 'vault') {
      const put = await putOwnerSecret(deps.storage, deps.config, caller!.ownerGhii, vaultName, plain, { host: vaultHost, by: caller!.principal });
      if (!put.ok) return put;
      out.vault = put.data;
      emitChange('secrets', caller!.ownerGhii);
    } else {
      out.content = share.secretFormat === 'file'
        ? { format: 'file', content_base64: plain, file_name: claimed.fileName, content_type: claimed.fileType }
        : { format: claimed.secretFormat, text: plain, file_name: null, content_type: null };
    }
  }
  await record(deps.storage, id, 'picked_up', caller, { to: share.protectionLevel === 'e2e' ? 'device' : to, via, ...(vaultName ? { vault_name: vaultName } : {}) });
  if (claimed.maxPickups !== null && claimed.pickups >= claimed.maxPickups) {
    if (await deps.storage.closeSecretShare(id, 'ended', new Date().toISOString(), null)) {
      await record(deps.storage, id, 'ended', null, { reason: 'pickups' });
    }
  }
  const base = deps.config.baseUrl.replace(/\/$/, '');
  await tellMaker(deps, claimed, 'picked_up', caller?.principal ?? 'code', `${base}/v1/secret-pickup?share=${id}`);
  emitChange('secret-shares', claimed.ownerGhii);
  return { ok: true, data: out };
}
