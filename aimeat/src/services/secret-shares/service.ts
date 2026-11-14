/**
 * @file src/services/secret-shares/service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Secret shares as ONE implementation: make a share or a request, fill a request,
 *   list, read one, revoke. Pickup is in pickup.ts. Every REST route and MCP tool calls these, so the
 *   rules, the refusals and the events are written once.
 *
 *   REFUSE BEFORE YOU WRITE. Terms and content are normalized, the people resolved, the organism
 *   membership and the encryption key checked, all before the first storage write.
 *
 *   WHAT A CALLER IS GIVEN BACK. A view (view.ts): never the ciphertext, never a code or token hash.
 *   The pickup code and the deposit token are returned once, to the maker, in the answer that made
 *   them, and are stored only as an HMAC.
 * @structure ShareDeps · ShareResult · shareMaxBytes · createShare · verifyDepositToken · depositShare ·
 *   sweepExpired · listShares · getShare · revokeShare · shareCard · depositCard
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-holvi-salaisuuksien-talletus-jako-ja-nouto-ihmisille-ja-agen).
 */
import type { AimeatConfig } from '../../config.js';
import type { SecretShareMember, SecretShareRecord } from '../../storage/types/secret-shares.js';
import type { CallerContext } from '../caller-context.js';
import { encrypt, getEncryptionKey } from '../encryption.js';
import { emitChange } from '../event-bus.js';
import {
  newDepositToken, newPickupCode, newShareId, normalizeCode, normalizeContent, normalizeTerms, refuse,
  requestDeadline, secretHmac, hmacMatches, DEFAULT_SHARE_MAX_BYTES, SHARE_MAX_BYTES_CEILING, MAX_E2E_KEYS,
  SHARE_ID_RE, type ShareRefusal, type ShareContent, type ShareDeps, type ShareResult,
} from './rules.js';
import { scopeRefusal, shareRolesOf } from './access.js';
import { recipeFor, runCheck } from './check.js';
import { record } from './events.js';
import { shareView, publicCard, type ShareView, type ShareCard } from './view.js';
import { tellRecipients, tellDepositors, tellMaker } from './notices.js';

export type { ShareDeps, ShareResult };

/** The node's share size limit, bounded by the ceiling whatever the setting says. */
export function shareMaxBytes(config: AimeatConfig): number {
  const n = Number((config as { secretShareMaxBytes?: number }).secretShareMaxBytes ?? DEFAULT_SHARE_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? Math.min(n, SHARE_MAX_BYTES_CEILING) : DEFAULT_SHARE_MAX_BYTES;
}

const noKey = (): ShareRefusal => refuse(503, 'SECRET_STORE_UNAVAILABLE',
  'This node has no encryption key configured, so a secret cannot be stored. Nothing was written.');
const notFound = (): ShareRefusal => refuse(404, 'NOT_FOUND', 'No such secret share, or it is not yours to see.');

/** Account names and GHIIs to local GHIIs that exist. A person on another node cannot sign in here. */
async function resolvePeople(deps: ShareDeps, people: string[]): Promise<{ ok: true; ghiis: string[] } | ShareRefusal> {
  const out: string[] = [];
  for (const p of people) {
    const ghii = p.includes('@') ? p.toLowerCase() : `${p.toLowerCase()}@${deps.config.nodeId}`;
    if (!ghii.endsWith(`@${deps.config.nodeId}`) || !(await deps.storage.getGHII(ghii))) {
      return refuse(400, 'UNKNOWN_PERSON', `${p} has no account on this node. Name an account here, or let them pick it up with a code (recipients.code).`);
    }
    if (!out.includes(ghii)) out.push(ghii);
  }
  return { ok: true, ghiis: out };
}

/** The E2E envelope and keys a browser sends, checked for shape only: the node cannot read them. */
function e2eFill(body: Record<string, unknown>, maxBytes: number): { ok: true; envelope: string; keys: SecretShareRecord['e2eKeys']; salt: string | null } | ShareRefusal {
  const envelope = typeof body.envelope === 'string' ? body.envelope : '';
  if (!envelope || !/^[A-Za-z0-9_\-.:]+$/.test(envelope)) return refuse(400, 'INVALID_ENVELOPE', 'An end-to-end share sends `envelope`, the content as the browser encrypted it.');
  if (envelope.length > Math.ceil(maxBytes * 1.4) + 256) return refuse(413, 'SECRET_TOO_LARGE', `That content is larger than this node takes (${maxBytes} bytes).`);
  const raw = Array.isArray(body.e2e_keys) ? body.e2e_keys : [];
  if (raw.length > MAX_E2E_KEYS) return refuse(400, 'INVALID_E2E_KEYS', `At most ${MAX_E2E_KEYS} recipient device keys.`);
  // One entry per recipient device ({ ghii, key_id, wrapped }), and for a code the entry with ghii 'code'.
  const keys = raw.filter((k): k is { ghii: string; key_id: string; wrapped: string } => !!k && typeof k === 'object'
    && typeof (k as Record<string, unknown>).ghii === 'string' && typeof (k as Record<string, unknown>).key_id === 'string'
    && typeof (k as Record<string, unknown>).wrapped === 'string' && ((k as Record<string, unknown>).wrapped as string).length < 4096)
    .map(k => ({ ghii: k.ghii.toLowerCase(), keyId: k.key_id, wrapped: k.wrapped }));
  const salt = typeof body.code_salt === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(body.code_salt) ? body.code_salt : null;
  if (!keys.length && !salt) return refuse(400, 'INVALID_E2E_KEYS', 'An end-to-end share carries a wrapped key for at least one recipient device (e2e_keys) or a code salt (code_salt).');
  return { ok: true, envelope, keys, salt };
}

/** Seal content (open, sealed) and run the check when the node knows the service. */
async function sealContent(config: AimeatConfig, key: Buffer, name: string, content: ShareContent, service: string | null) {
  const ciphertext = encrypt(content.text, key);
  const checking = (config as { secretShareCheck?: boolean }).secretShareCheck !== false;
  const recipe = checking && content.format === 'text' ? recipeFor({ service, name, secret: content.text }) : null;
  const check = recipe ? await runCheck(recipe, content.text) : null;
  return { ciphertext, check };
}

export interface CreatedShare { share: ShareView; code?: string; deposit_token?: string; deposit_url?: string; pickup_url: string }

/**
 * Make a share (with content) or a request (kind 'request', no content; `depositors` names who is
 * asked). The maker sets the terms. For an e2e share the content arrives already encrypted.
 */
export async function createShare(deps: ShareDeps, caller: CallerContext, body: Record<string, unknown>): Promise<ShareResult<CreatedShare>> {
  const denied = scopeRefusal(caller); if (denied) return denied;
  if (body.kind !== undefined && body.kind !== 'share' && body.kind !== 'request') {
    return refuse(400, 'INVALID_KIND', 'kind is share (you give the content now) or request (someone else fills it).');
  }
  if (body.format !== undefined && !['text', 'pairs', 'file'].includes(String(body.format))) {
    return refuse(400, 'INVALID_FORMAT', 'format is text (a key, a password, a token), pairs (NAME=value lines, such as an .env file) or file.');
  }
  const kind = body.kind === 'request' ? 'request' : 'share';
  const maker = caller.ownerGhii;
  // A request with no recipients goes to its maker, and to the maker's agents unless it is end-to-end.
  const input = { ...body };
  if (kind === 'request' && (!input.recipients || typeof input.recipients !== 'object')) {
    input.recipients = { people: [maker], agents: input.protection !== 'e2e' };
  }
  const t = normalizeTerms(input); if (!t.ok) return t;
  const terms = t.terms;
  const people = await resolvePeople(deps, terms.recipients.people); if (!people.ok) return people;
  if (terms.protection === 'e2e') {
    // The depositor's browser encrypts to the recipients' devices; it cannot encrypt to a code it never sees.
    if (kind === 'request' && terms.recipients.code) {
      return refuse(400, 'E2E_REQUEST_NO_CODE', 'An end-to-end request is filled by a browser that encrypts for its recipients\' devices, so it cannot also open with a code. Name the people who pick it up.');
    }
    for (const g of people.ghiis) {
      if (!(await deps.storage.listVaultDeviceKeys(g)).length) {
        return refuse(409, 'NO_DEVICE_KEY', `${g} has not registered a browser for end-to-end secrets on the Vault page, so nothing could open this share. Choose sealed, or ask them to register first.`);
      }
    }
  }
  const depositorsIn = kind === 'request' && Array.isArray(body.depositors) ? body.depositors.filter((d): d is string => typeof d === 'string') : [];
  const depositors = await resolvePeople(deps, depositorsIn); if (!depositors.ok) return depositors;
  if (terms.organismId) {
    const m = await deps.storage.getMembership(terms.organismId, caller.owner);
    if (!m || m.status !== 'active') return refuse(403, 'NOT_A_MEMBER', 'A share sits in an organism\'s vault only when its maker is an active member of that organism.');
  }
  const key = getEncryptionKey(deps.config); if (!key) return noKey();
  const maxBytes = shareMaxBytes(deps.config);
  const id = newShareId();
  const now = new Date().toISOString();
  const service = typeof body.service === 'string' ? body.service : null;

  let fill: Pick<SecretShareRecord, 'ciphertext' | 'sizeBytes' | 'secretFormat' | 'fileName' | 'fileType' | 'check' | 'e2eKeys' | 'codeSalt'>
    = { ciphertext: null, sizeBytes: 0, secretFormat: (body.format === 'pairs' || body.format === 'file') ? body.format : 'text', fileName: null, fileType: null, check: null, e2eKeys: null, codeSalt: null };
  if (kind === 'share') {
    if (terms.protection === 'e2e') {
      const e = e2eFill(body, maxBytes); if (!e.ok) return e;
      fill = { ...fill, ciphertext: e.envelope, sizeBytes: Number(body.size_bytes) > 0 ? Math.min(Number(body.size_bytes), maxBytes) : 0, e2eKeys: e.keys, codeSalt: e.salt,
        fileName: typeof body.file_name === 'string' ? body.file_name.slice(0, 200) : null };
    } else {
      const c = normalizeContent(body, maxBytes); if (!c.ok) return c;
      const sealed = await sealContent(deps.config, key, terms.name, c.content, service);
      fill = { ...fill, ciphertext: sealed.ciphertext, sizeBytes: c.content.sizeBytes, secretFormat: c.content.format,
        fileName: c.content.fileName, fileType: c.content.contentType, check: sealed.check };
    }
  }

  // The code: made here for open and sealed; for e2e the browser made it and sends a verifier.
  let code: string | undefined;
  let codeHash: string | null = null;
  if (terms.recipients.code) {
    if (terms.protection === 'e2e') {
      const v = typeof body.code_verifier === 'string' && /^[0-9a-f]{64}$/.test(body.code_verifier) ? body.code_verifier : '';
      if (!v) return refuse(400, 'INVALID_CODE_VERIFIER', 'An end-to-end share with a code sends code_verifier, made by the browser from the code.');
      codeHash = secretHmac(key, 'code', id, v);
    } else {
      code = newPickupCode();
      codeHash = secretHmac(key, 'code', id, normalizeCode(code));
    }
  }
  let depositToken: string | undefined;
  let requestExpiresAt: string | null = null;
  if (kind === 'request') {
    const d = requestDeadline(body); if (!d.ok) return d;
    requestExpiresAt = d.at;
    depositToken = newDepositToken();
  }

  const share: SecretShareRecord = {
    id, ownerGhii: maker, createdBy: caller.principal, organismId: terms.organismId, kind,
    name: terms.name, note: terms.note, ...fill, protectionLevel: terms.protection,
    recipients: { ...terms.recipients, people: people.ghiis }, codeHash, codeLogin: terms.codeLogin,
    retention: terms.retention, maxPickups: terms.maxPickups, expiresAt: terms.expiresAt, pickups: 0,
    status: kind === 'request' ? 'waiting' : 'ready',
    depositTokenHash: depositToken ? secretHmac(key, 'deposit', id, depositToken) : null,
    requestExpiresAt, depositedAt: kind === 'share' ? now : null, depositedBy: kind === 'share' ? caller.principal : null,
    createdAt: now, updatedAt: now, revokedAt: null, revokedBy: null,
  };
  const members: SecretShareMember[] = [
    ...people.ghiis.map(g => ({ shareId: id, ghii: g, role: 'pickup' as const })),
    ...depositors.ghiis.map(g => ({ shareId: id, ghii: g, role: 'deposit' as const })),
  ];
  await deps.storage.createSecretShare(share, members);
  await record(deps.storage, id, kind === 'request' ? 'requested' : 'created', caller, { protection: share.protectionLevel, retention: share.retention });
  if (share.check) await record(deps.storage, id, 'checked', caller, { service: share.check.service, ok: String(share.check.ok) });

  const base = deps.config.baseUrl.replace(/\/$/, '');
  const pickupUrl = `${base}/v1/secret-pickup?share=${id}`;
  const depositUrl = depositToken ? `${base}/v1/secret-deposit?share=${id}#t=${depositToken}` : undefined;
  if (kind === 'share') await tellRecipients(deps, share, people.ghiis, pickupUrl);
  else await tellDepositors(deps, share, depositors.ghiis, `${base}/v1/secret-deposit?share=${id}`);
  emitChange('secret-shares', maker);
  for (const g of [...people.ghiis, ...depositors.ghiis]) if (g !== maker) emitChange('secret-shares', g);
  return {
    ok: true,
    data: {
      share: shareView(share, { manage: true, pickup: people.ghiis.includes(maker), deposit: false }, null),
      ...(code ? { code } : {}), ...(depositToken ? { deposit_token: depositToken, deposit_url: depositUrl } : {}),
      pickup_url: pickupUrl,
    },
  };
}

/**
 * The one verifier of a request's deposit token: the route's credential strategy
 * (auth/credential-strategies.ts 'secret-share-deposit'), depositShare and depositCard call it.
 */
export async function verifyDepositToken(deps: ShareDeps, id: string, token: string): Promise<SecretShareRecord | null> {
  if (!SHARE_ID_RE.test(id) || !token) return null;
  const share = await deps.storage.getSecretShare(id);
  const key = getEncryptionKey(deps.config);
  if (!share || share.kind !== 'request' || !key || !share.depositTokenHash) return null;
  return hmacMatches(key, 'deposit', id, token, share.depositTokenHash) ? share : null;
}

/**
 * Fill a waiting request: as a named depositor signed in, or with the deposit token from the link
 * (caller may then be null). The maker's terms stay as they are.
 */
export async function depositShare(deps: ShareDeps, caller: CallerContext | null, id: string, body: Record<string, unknown>): Promise<ShareResult<{ share: ShareCard }>> {
  if (!SHARE_ID_RE.test(id)) return notFound();
  const share = await deps.storage.getSecretShare(id);
  if (!share || share.kind !== 'request') return notFound();
  const key = getEncryptionKey(deps.config); if (!key) return noKey();
  const members = await deps.storage.listSecretShareMembers(id);
  const token = typeof body.token === 'string' ? body.token : '';
  let allowed = !!(await verifyDepositToken(deps, id, token));
  if (!allowed && caller) {
    const denied = scopeRefusal(caller); if (denied) return denied;
    // A named depositor is told the request is filled, rather than that it does not exist.
    allowed = members.some(m => m.role === 'deposit' && m.ghii === caller.ownerGhii);
  }
  if (!allowed) return notFound();
  if (share.status !== 'waiting') return refuse(409, 'NOT_WAITING', 'This request has already been filled, or it ended or was withdrawn.');
  if (share.requestExpiresAt && share.requestExpiresAt <= new Date().toISOString()) {
    await deps.storage.closeSecretShare(id, 'ended', new Date().toISOString(), null);
    return refuse(410, 'REQUEST_ENDED', 'The time to fill this request ended. Ask its maker for a new one.');
  }
  const maxBytes = shareMaxBytes(deps.config);
  const depositedBy = caller?.principal ?? 'link';
  const now = new Date().toISOString();
  let ok: boolean;
  if (share.protectionLevel === 'e2e') {
    const e = e2eFill(body, maxBytes); if (!e.ok) return e;
    ok = await deps.storage.depositSecretShare(id, {
      ciphertext: e.envelope, sizeBytes: Number(body.size_bytes) > 0 ? Math.min(Number(body.size_bytes), maxBytes) : 0,
      secretFormat: (body.format === 'pairs' || body.format === 'file') ? body.format : 'text',
      fileName: typeof body.file_name === 'string' ? body.file_name.slice(0, 200) : null, fileType: null,
      check: null, e2eKeys: e.keys, codeSalt: e.salt, depositedAt: now, depositedBy,
    });
  } else {
    const c = normalizeContent(body, maxBytes); if (!c.ok) return c;
    const sealed = await sealContent(deps.config, key, share.name, c.content, typeof body.service === 'string' ? body.service : null);
    ok = await deps.storage.depositSecretShare(id, {
      ciphertext: sealed.ciphertext, sizeBytes: c.content.sizeBytes, secretFormat: c.content.format, fileName: c.content.fileName,
      fileType: c.content.contentType, check: sealed.check, e2eKeys: null, codeSalt: null, depositedAt: now, depositedBy,
    });
  }
  if (!ok) return refuse(409, 'NOT_WAITING', 'This request has already been filled, or it ended or was withdrawn.');
  const filled = (await deps.storage.getSecretShare(id))!;
  const actor = caller ?? null;
  await record(deps.storage, id, 'deposited', actor, { format: filled.secretFormat });
  if (filled.check) await record(deps.storage, id, 'checked', actor, { service: filled.check.service, ok: String(filled.check.ok) });
  const base = deps.config.baseUrl.replace(/\/$/, '');
  await tellMaker(deps, filled, 'deposited', depositedBy, `${base}/v1/secret-pickup?share=${id}`);
  await tellRecipients(deps, filled, filled.recipients.people.filter(p => p !== filled.ownerGhii), `${base}/v1/secret-pickup?share=${id}`);
  emitChange('secret-shares', filled.ownerGhii);
  return { ok: true, data: { share: publicCard(filled, true) } };
}

export interface ShareLists { made: ShareView[]; for_me: ShareView[]; to_fill: ShareView[]; organisms: ShareView[] }

let lastSweep = 0;
/** End the shares and requests whose time ran out, at most once a minute per process. */
export async function sweepExpired(deps: ShareDeps, force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastSweep < 60_000) return;
  lastSweep = now;
  const ids = await deps.storage.endExpiredSecretShares(new Date(now).toISOString());
  for (const id of ids) await record(deps.storage, id, 'ended', null, { reason: 'time' });
}

/** Everything the caller made, may pick up, is asked to fill, or manages in an organism's vault. */
export async function listShares(deps: ShareDeps, caller: CallerContext): Promise<ShareResult<ShareLists>> {
  const denied = scopeRefusal(caller); if (denied) return denied;
  await sweepExpired(deps);
  const owner = caller.ownerGhii;
  const memberships = (await deps.storage.listMembershipsByGhii(caller.owner)).filter(m => m.status === 'active');
  const [made, named, asked, inOrgs] = await Promise.all([
    deps.storage.listSecretSharesByOwner(owner),
    deps.storage.listSecretSharesForMember(owner, 'pickup'),
    deps.storage.listSecretSharesForMember(owner, 'deposit'),
    memberships.length ? deps.storage.listSecretSharesByOrganisms(memberships.map(m => m.organismId)) : Promise.resolve([]),
  ]);
  const view = async (s: SecretShareRecord) => {
    const roles = await shareRolesOf(deps.storage, caller, s, await deps.storage.listSecretShareMembers(s.id));
    return shareView(s, roles, null);
  };
  const madeIds = new Set(made.map(s => s.id));
  const forMe = [...named, ...inOrgs.filter(s => s.recipients.organism)]
    .filter((s, i, a) => s.status === 'ready' && !madeIds.has(s.id) && a.findIndex(x => x.id === s.id) === i);
  const adminOrgs = new Set(memberships.filter(m => m.role === 'creator' || m.role === 'admin').map(m => m.organismId));
  const orgManaged = inOrgs.filter(s => s.organismId && adminOrgs.has(s.organismId) && !madeIds.has(s.id));
  return {
    ok: true,
    data: {
      made: await Promise.all(made.map(view)),
      for_me: await Promise.all(forMe.map(view)),
      to_fill: await Promise.all(asked.filter(s => s.status === 'waiting').map(view)),
      organisms: await Promise.all(orgManaged.map(view)),
    },
  };
}

/** One share with its events, for a caller who may manage it, pick it up or fill it. */
export async function getShare(deps: ShareDeps, caller: CallerContext, id: string): Promise<ShareResult<ShareView>> {
  const denied = scopeRefusal(caller); if (denied) return denied;
  if (!SHARE_ID_RE.test(id)) return notFound();
  await sweepExpired(deps);
  const share = await deps.storage.getSecretShare(id);
  if (!share) return notFound();
  const members = await deps.storage.listSecretShareMembers(id);
  const roles = await shareRolesOf(deps.storage, caller, share, members);
  // A named person sees the share whatever their agents may do with it.
  const namedPerson = members.some(m => m.ghii === caller.ownerGhii);
  if (!roles.manage && !roles.pickup && !roles.deposit && !namedPerson) return notFound();
  const events = await deps.storage.listSecretShareEvents(id, 200);
  // Someone who does not manage the share sees its life (made, filled, ended, revoked) and their own
  // acts; other people's pickups and refused codes are the maker's to read.
  const visible = roles.manage ? events
    : events.filter(e => e.onBehalfOf === caller.ownerGhii || (e.kind !== 'picked_up' && e.kind !== 'refused'));
  return { ok: true, data: shareView(share, roles, visible) };
}

/** The maker or an organism admin withdraws a share. Content gone, pickups stop; copies taken stay. */
export async function revokeShare(deps: ShareDeps, caller: CallerContext, id: string): Promise<ShareResult<ShareView>> {
  const denied = scopeRefusal(caller); if (denied) return denied;
  if (!SHARE_ID_RE.test(id)) return notFound();
  const share = await deps.storage.getSecretShare(id);
  if (!share) return notFound();
  const roles = await shareRolesOf(deps.storage, caller, share, await deps.storage.listSecretShareMembers(id));
  if (!roles.manage) return share.recipients.people.includes(caller.ownerGhii) ? refuse(403, 'NOT_MAKER', 'Only the share\'s maker, or an admin of its organism, can revoke it.') : notFound();
  const at = new Date().toISOString();
  const closed = await deps.storage.closeSecretShare(id, 'revoked', at, caller.principal);
  if (closed) await record(deps.storage, id, 'revoked', caller, {});
  const after = (await deps.storage.getSecretShare(id))!;
  emitChange('secret-shares', share.ownerGhii);
  return { ok: true, data: shareView(after, roles, await deps.storage.listSecretShareEvents(id, 200)) };
}

/**
 * What the pickup page and the deposit page show before anyone signs in: the name, the maker, the
 * kind, whether a code and a sign-in are needed. Never the note (it may describe the secret), never
 * content. The deposit page reads the note with its token through depositCard.
 */
export async function shareCard(deps: ShareDeps, id: string): Promise<ShareResult<ShareCard>> {
  if (!SHARE_ID_RE.test(id)) return notFound();
  const share = await deps.storage.getSecretShare(id);
  return share ? { ok: true, data: publicCard(share) } : notFound();
}

/** The deposit page with its token: the card plus the maker's note and the recipients' device keys for e2e. */
/** What the depositor reads of the requester's terms: who may pick it up, how long. */
export interface DepositTerms {
  note: string;
  recipients: { people: string[]; agents: boolean; organism: boolean; code: boolean; code_login: boolean };
  retention: string; max_pickups: number | null;
  device_keys: Array<{ ghii: string; key_id: string; public_key: string }>;
}

export async function depositCard(deps: ShareDeps, id: string, token: string): Promise<ShareResult<ShareCard & DepositTerms>> {
  const share = await verifyDepositToken(deps, id, token);
  if (!share) return notFound();
  const device_keys = share.protectionLevel === 'e2e'
    ? (await Promise.all(share.recipients.people.map(async g => (await deps.storage.listVaultDeviceKeys(g)).map(k => ({ ghii: g, key_id: k.keyId, public_key: k.publicKey }))))).flat()
    : [];
  const r = share.recipients;
  return {
    ok: true,
    data: {
      ...publicCard(share), note: share.note, device_keys,
      recipients: { people: r.people, agents: r.agents, organism: r.organism, code: r.code, code_login: share.codeLogin },
      retention: share.retention, max_pickups: share.maxPickups,
    },
  };
}
