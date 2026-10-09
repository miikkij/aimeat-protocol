/**
 * @file src/services/docsign/records.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AIMEAT document signing: a signing request names a document by its SHA-256 and the
 *   people or agents who sign it (1 to 10); each signs as the identity they are, with a passkey, a
 *   registered key or their authenticated session; the node seals every signature. Anyone who holds
 *   the document can look up who signed it by its hash, without an account.
 *
 *   ONE IMPLEMENTATION. The REST routes (routes/docsign.ts) and the MCP tools (mcp/docsign.ts) call
 *   these functions with the caller; nothing about who may do what is decided outside this file.
 *
 *   WHO MAY DO WHAT.
 *   - Create: a party, or an agent or app acting for a person who is a party (an assistant prepares
 *     the request; the person signs). Parties are identities of this node that exist.
 *   - Read a request: its parties, its creator, and a person whose agent is a party.
 *   - Sign: only as yourself, and only as a listed party. A person signs with a passkey from an app
 *     or with their session on the node's own pages; an app can never use the session method,
 *     because a press inside an app is not proof the person pressed it. An agent signs as itself.
 *   - Look up by hash: anyone. It shows the signatures given, never who has yet to sign.
 *
 *   STORAGE. Records sit in the reserved `sys:docsign` namespace, which no principal-writable path
 *   reaches (services/attestation.ts gives the reasoning). One key per request, one index key per
 *   document hash and one per party. A per-request lock serialises the read-modify-write of two
 *   parties signing at once: a node is one process, so an in-process lock is the whole answer.
 * @structure DocSignRecord · DocSignature · DocsignError · createRequest · getRequest ·
 *   listRequests · lookupByHash · beginPasskeySignature · signRequest · cancelRequest ·
 *   verifyRecordSignatures · publicView
 * @usage const rec = await createRequest(ctx, caller, { title, document, parties });
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (wish-virallisen-dokumentin-allekirjoitus-ja-allekirjoituksen-tark).
 */
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { CallerContext } from '../caller-context.js';
import { verify as verifyEd25519 } from '../../auth/keypair.js';
import { beginSigning, finishSigning } from '../passkeys.js';
import { notify } from '../notify.js';
import { logger } from '../../utils/logger.js';
import {
  canonicalJson, intentChallenge, keyMessage, evidenceHash, sealStatement, verifySeal, sha256Hex,
  type SignIntent, type SealedStatement, type Seal, type SignMethod, type Assurance,
} from './statement.js';

const NS = 'sys:docsign';
const reqKey = (id: string) => `docsign.req.${id}`;
const hashKey = (sha: string) => `docsign.hash.${sha}`;
const partyKey = (identity: string) => `docsign.party.${sha256Hex(identity).slice(0, 40)}`;
const MAX_PARTIES = 10;
const MAX_INDEX = 2000;
const INTENT_TTL_MS = 5 * 60_000;

export interface DocsignCtx { storage: Storage; config: AimeatConfig }

export interface PasskeyEvidence {
  credentialId: string;
  /** COSE public key, base64url: the key the assertion verifies with, carried for offline checks. */
  publicKey: string;
  origin: string;
  intent: SignIntent;
  /** The WebAuthn assertion as the browser returned it (id, rawId, type, response). */
  assertion: Record<string, unknown>;
}

export interface KeyEvidence { publicKey: string; signature: string; message: string }

export interface DocSignature {
  statement: SealedStatement;
  seal: Seal;
  passkey?: PasskeyEvidence;
  key?: KeyEvidence;
}

export interface DocSignRecord {
  v: 1;
  id: string;
  state: 'open' | 'complete' | 'cancelled';
  title: string;
  message: string | null;
  document: { sha256: string; name: string; size: number; mediaType: string | null };
  parties: { identity: string; name: string | null }[];
  signatures: Record<string, DocSignature>;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
}

export class DocsignError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) { super(message); }
}

// ── storage ──

async function readJson<T>(storage: Storage, key: string): Promise<T | null> {
  const rec = await storage.getMemory(NS, key);
  return rec ? (rec.value as unknown as T) : null;
}

async function writeJson(storage: Storage, key: string, value: unknown, tags: string[]): Promise<void> {
  const existing = await storage.getMemory(NS, key);
  const now = new Date().toISOString();
  await storage.setMemory({
    key, ownerGaii: NS, value: value as Record<string, unknown>, visibility: 'private', tags, ttlHours: null,
    version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
  });
}

async function addToIndex(storage: Storage, key: string, id: string): Promise<void> {
  const idx = (await readJson<{ ids: string[] }>(storage, key)) ?? { ids: [] };
  if (idx.ids.includes(id)) return;
  idx.ids = [id, ...idx.ids].slice(0, MAX_INDEX);
  await writeJson(storage, key, idx, ['docsign-index']);
}

const locks = new Map<string, Promise<void>>();
/** Run `fn` after every earlier call for the same request has finished. */
async function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  let release!: () => void;
  const mine = prev.then(() => new Promise<void>((r) => { release = r; }));
  locks.set(id, mine);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(id) === mine) locks.delete(id);
  }
}

// ── identities ──

async function displayNameOf(storage: Storage, identity: string): Promise<string | null> {
  if (identity.includes('#')) {
    const agent = await storage.getAgent(identity);
    return agent ? (agent as { displayName?: string; name?: string }).displayName ?? identity.split('@')[0]! : null;
  }
  const ghii = await storage.getGHII(identity);
  return ghii ? (ghii.displayName || ghii.username) : null;
}

async function assuranceOf(storage: Storage, caller: CallerContext, userVerified: boolean | null): Promise<Assurance> {
  const kind = caller.kind === 'agent' ? 'agent' : caller.kind === 'ecosystem' ? 'ecosystem' : 'person';
  const ghii = kind === 'person' ? await storage.getGHII(caller.principal) : null;
  return { verificationLevel: ghii?.verificationLevel ?? 0, userVerified, principalKind: kind };
}

function local(config: AimeatConfig, identity: string): boolean {
  return identity.endsWith(`@${config.nodeId}`);
}

/** A person's agents are theirs: `x#alice@node` belongs to `alice@node`. */
function ownsAgent(ghii: string, identity: string): boolean {
  return identity.includes('#') && identity.slice(identity.indexOf('#') + 1) === ghii;
}

function canRead(rec: DocSignRecord, caller: CallerContext): boolean {
  const ids = rec.parties.map((p) => p.identity);
  return ids.includes(caller.principal) || rec.createdBy === caller.principal
    || ids.includes(caller.ownerGhii) || (caller.inPerson && ids.some((p) => ownsAgent(caller.ownerGhii, p)));
}

function refuseVisitor(caller: CallerContext): void {
  if (caller.visitor || caller.kind === 'anonymous') {
    throw new DocsignError('FORBIDDEN', 403, 'Sign in on this node to create or sign a request.');
  }
}

// ── requests ──

export interface CreateInput {
  title: string;
  message?: string | null;
  document: { sha256: string; name: string; size: number; mediaType?: string | null };
  parties: string[];
}

export async function createRequest(ctx: DocsignCtx, caller: CallerContext, input: CreateInput): Promise<DocSignRecord> {
  refuseVisitor(caller);
  const sha = input.document.sha256.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new DocsignError('INVALID_INPUT', 400, 'document.sha256 must be the 64-character hex SHA-256 of the file.');
  const parties = [...new Set(input.parties.map((p) => p.trim()).filter(Boolean))];
  if (parties.length < 1 || parties.length > MAX_PARTIES) throw new DocsignError('INVALID_INPUT', 400, `A request names 1 to ${MAX_PARTIES} parties.`);
  if (!parties.includes(caller.principal) && !parties.includes(caller.ownerGhii)) {
    throw new DocsignError('NOT_A_PARTY', 403, 'You can create a request only when you, or the person you act for, are one of the parties.');
  }
  const named: { identity: string; name: string | null }[] = [];
  for (const p of parties) {
    if (!local(ctx.config, p)) throw new DocsignError('INVALID_INPUT', 400, `${p} is not an identity on this node. Parties are people (name@${ctx.config.nodeId}) or agents (agent#name@${ctx.config.nodeId}) here.`);
    const name = await displayNameOf(ctx.storage, p);
    if (name === null) throw new DocsignError('PARTY_NOT_FOUND', 404, `No one is registered as ${p}.`);
    named.push({ identity: p, name });
  }
  const rec: DocSignRecord = {
    v: 1, id: `ds-${randomUUID()}`, state: 'open',
    title: input.title.trim().slice(0, 200) || input.document.name,
    message: input.message?.trim().slice(0, 2000) || null,
    document: { sha256: sha, name: input.document.name.trim().slice(0, 255), size: Math.max(0, Math.floor(input.document.size)), mediaType: input.document.mediaType ?? null },
    parties: named, signatures: {}, createdBy: caller.principal, createdAt: new Date().toISOString(),
    completedAt: null, cancelledAt: null,
  };
  await writeJson(ctx.storage, reqKey(rec.id), rec, ['docsign']);
  await addToIndex(ctx.storage, hashKey(sha), rec.id);
  for (const p of parties) await addToIndex(ctx.storage, partyKey(p), rec.id);
  if (caller.principal !== caller.ownerGhii) await addToIndex(ctx.storage, partyKey(caller.principal), rec.id);
  await tellParties(ctx, rec, caller.principal);
  return rec;
}

/** Each person who has to sign, other than the one who asked, gets a notification. */
async function tellParties(ctx: DocsignCtx, rec: DocSignRecord, from: string): Promise<void> {
  const fromName = (await displayNameOf(ctx.storage, from)) ?? from;
  for (const p of rec.parties) {
    if (p.identity === from || p.identity.includes('#')) continue;
    try {
      await notify(ctx.storage, p.identity, {
        type: 'docsign_request',
        title: `${fromName} asks you to sign: ${rec.title}`,
        body: `Document ${rec.document.name}. Open the signing request, or ask your AI to show it to you. (${rec.id})`,
        ...(ctx.config.docsignAppUrl ? { link: `${ctx.config.docsignAppUrl}/?request=${encodeURIComponent(rec.id)}` } : {}),
        i18n: { key: 'docsign_request', vars: { from: fromName, title: rec.title, document: rec.document.name } },
      });
    } catch (err) {
      logger.warn('docsign: a party could not be notified', { request: rec.id, error: String(err) });
    }
  }
}

async function load(ctx: DocsignCtx, id: string): Promise<DocSignRecord> {
  if (!/^ds-[0-9a-f-]{36}$/.test(id)) throw new DocsignError('NOT_FOUND', 404, 'No such signing request.');
  const rec = await readJson<DocSignRecord>(ctx.storage, reqKey(id));
  if (!rec) throw new DocsignError('NOT_FOUND', 404, 'No such signing request.');
  return rec;
}

export async function getRequest(ctx: DocsignCtx, caller: CallerContext, id: string): Promise<DocSignRecord> {
  const rec = await load(ctx, id);
  // Answered as absent, so an id is not a way to learn that a request exists.
  if (!canRead(rec, caller)) throw new DocsignError('NOT_FOUND', 404, 'No such signing request.');
  return rec;
}

export async function listRequests(
  ctx: DocsignCtx, caller: CallerContext, opts: { state?: 'open' | 'complete' | 'cancelled' | 'waiting-for-me'; limit?: number } = {},
): Promise<DocSignRecord[]> {
  const keys = new Set([partyKey(caller.principal), partyKey(caller.ownerGhii)]);
  const ids = new Set<string>();
  for (const k of keys) for (const id of (await readJson<{ ids: string[] }>(ctx.storage, k))?.ids ?? []) ids.add(id);
  const out: DocSignRecord[] = [];
  for (const id of ids) {
    const rec = await readJson<DocSignRecord>(ctx.storage, reqKey(id));
    if (!rec || !canRead(rec, caller)) continue;
    if (opts.state === 'waiting-for-me') {
      if (rec.state !== 'open' || rec.signatures[caller.principal] || !rec.parties.some((p) => p.identity === caller.principal)) continue;
    } else if (opts.state && rec.state !== opts.state) continue;
    out.push(rec);
  }
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out.slice(0, Math.min(opts.limit ?? 50, 200));
}

export async function cancelRequest(ctx: DocsignCtx, caller: CallerContext, id: string): Promise<DocSignRecord> {
  return withLock(id, async () => {
    const rec = await getRequest(ctx, caller, id);
    if (rec.createdBy !== caller.principal && !(rec.createdBy.includes('#') && ownsAgent(caller.principal, rec.createdBy))) {
      throw new DocsignError('FORBIDDEN', 403, 'Only whoever created the request can cancel it.');
    }
    if (rec.state !== 'open') throw new DocsignError('NOT_OPEN', 409, `The request is ${rec.state}.`);
    rec.state = 'cancelled';
    rec.cancelledAt = new Date().toISOString();
    await writeJson(ctx.storage, reqKey(id), rec, ['docsign']);
    return rec;
  });
}

// ── signing ──

const pendingIntents = new Map<string, { intent: SignIntent; expires: number }>();

function partyCheck(rec: DocSignRecord, caller: CallerContext): void {
  if (rec.state !== 'open') throw new DocsignError('NOT_OPEN', 409, `The request is ${rec.state}; nothing can be signed.`);
  if (!rec.parties.some((p) => p.identity === caller.principal)) {
    throw new DocsignError('NOT_A_PARTY', 403, `You sign as ${caller.principal}, which is not a party to this request. A person signs for themselves; an agent signs as itself.`);
  }
  if (rec.signatures[caller.principal]) throw new DocsignError('ALREADY_SIGNED', 409, 'You have already signed this request.');
}

/** Start a passkey signature: the options for navigator.credentials.get(), bound to this document and signer. */
export async function beginPasskeySignature(ctx: DocsignCtx, caller: CallerContext, id: string): Promise<{ ceremony_id: string; options: unknown; intent: SignIntent }> {
  refuseVisitor(caller);
  const rec = await getRequest(ctx, caller, id);
  partyCheck(rec, caller);
  if (caller.principal.includes('#') || caller.kind === 'agent' || caller.kind === 'ecosystem') {
    throw new DocsignError('METHOD_NOT_ALLOWED', 400, 'A passkey belongs to a person. An agent signs with its key or its session.');
  }
  const intent: SignIntent = { type: 'aimeat-docsign-intent/v1', request: rec.id, document: rec.document.sha256, signer: caller.principal, nonce: randomBytes(16).toString('hex') };
  const begun = await beginSigning(ctx.config, ctx.storage, caller.owner, intentChallenge(intent));
  if (!begun.ok) throw new DocsignError(begun.code, begun.status, begun.message);
  const now = Date.now();
  for (const [k, v] of pendingIntents) if (v.expires < now) pendingIntents.delete(k);
  pendingIntents.set(begun.data.ceremony_id, { intent, expires: now + INTENT_TTL_MS });
  return { ...begun.data, intent };
}

export interface SignInput {
  method: SignMethod;
  /** passkey: the ceremony beginPasskeySignature returned, and the browser's answer. */
  ceremony_id?: string;
  response?: Record<string, unknown>;
  /** key: base64 Ed25519 signature over keyMessage(request, sha256, signer). */
  signature?: string;
}

export async function signRequest(ctx: DocsignCtx, caller: CallerContext, id: string, input: SignInput): Promise<DocSignRecord> {
  refuseVisitor(caller);
  return withLock(id, async () => {
    const rec = await getRequest(ctx, caller, id);
    partyCheck(rec, caller);
    let passkey: PasskeyEvidence | undefined;
    let key: KeyEvidence | undefined;
    let userVerified: boolean | null = null;

    if (input.method === 'passkey') {
      const pending = input.ceremony_id ? pendingIntents.get(input.ceremony_id) : undefined;
      if (input.ceremony_id) pendingIntents.delete(input.ceremony_id);
      if (!pending || pending.intent.request !== rec.id || pending.intent.signer !== caller.principal) {
        throw new DocsignError('PASSKEY_CHALLENGE_EXPIRED', 400, 'That signing ceremony is not open any more. Start again.');
      }
      const done = await finishSigning(ctx.config, ctx.storage, { ceremonyId: input.ceremony_id!, owner: caller.owner, response: (input.response ?? {}) as never });
      if (!done.ok) throw new DocsignError(done.code, done.status, done.message);
      userVerified = true;
      passkey = {
        credentialId: done.data.passkey.id, publicKey: done.data.passkey.publicKey, origin: done.data.origin,
        intent: pending.intent, assertion: input.response ?? {},
      };
    } else if (input.method === 'key') {
      const publicKey = await registeredKey(ctx.storage, caller.principal);
      if (!publicKey) throw new DocsignError('NO_KEY', 409, 'You have no registered signing key on this node. Use a passkey or your session.');
      const message = keyMessage(rec.id, rec.document.sha256, caller.principal);
      if (!input.signature || !(await verifyEd25519(publicKey, message, input.signature))) {
        throw new DocsignError('BAD_SIGNATURE', 422, `The signature does not verify. Sign the exact string "${message}" with your registered Ed25519 key.`);
      }
      key = { publicKey, signature: input.signature, message };
    } else if (input.method === 'session') {
      // A press inside an app is not proof that the person pressed it: an app signs with a passkey.
      if (caller.kind === 'app') throw new DocsignError('METHOD_NOT_ALLOWED', 400, 'From an app, a person signs with a passkey.');
      if (caller.kind === 'owner' && !caller.inPerson) throw new DocsignError('METHOD_NOT_ALLOWED', 400, 'Sign in person, or use a passkey.');
    } else {
      throw new DocsignError('INVALID_INPUT', 400, 'method is passkey, key or session.');
    }

    const nodeKey = await ctx.storage.getNodeKey();
    if (!nodeKey) throw new DocsignError('NODE_KEY_MISSING', 503, 'This node has no signing key yet.');
    const evidence = passkey ?? key ?? null;
    const statement: SealedStatement = {
      type: 'aimeat-docsign/v1', node: ctx.config.nodeId, request: rec.id, title: rec.title,
      document: { sha256: rec.document.sha256, name: rec.document.name, size: rec.document.size },
      signer: caller.principal, signerName: rec.parties.find((p) => p.identity === caller.principal)?.name ?? null,
      signedAt: new Date().toISOString(), method: input.method,
      assurance: await assuranceOf(ctx.storage, caller, userVerified),
      evidence: evidenceHash(evidence),
    };
    const seal = await sealStatement(statement, nodeKey);
    rec.signatures[caller.principal] = { statement, seal, ...(passkey ? { passkey } : {}), ...(key ? { key } : {}) };
    if (rec.parties.every((p) => rec.signatures[p.identity])) {
      rec.state = 'complete';
      rec.completedAt = statement.signedAt;
    }
    await writeJson(ctx.storage, reqKey(rec.id), rec, ['docsign']);
    return rec;
  });
}

async function registeredKey(storage: Storage, identity: string): Promise<string | null> {
  if (identity.includes('#')) return (await storage.getAgent(identity))?.publicKey ?? null;
  const ghii = await storage.getGHII(identity);
  return ghii ? (await storage.getOwner(ghii.username))?.publicKey ?? null : null;
}

// ── verification ──

export interface SignatureCheck {
  signer: string;
  signerName: string | null;
  signedAt: string;
  method: SignMethod;
  assurance: Assurance;
  /** The statement names this request and this document. */
  consistent: boolean;
  /** The node's seal verifies, with this node's current key. */
  sealValid: boolean;
  sealByThisNode: boolean;
  /** The signer's own evidence verifies (passkey assertion or key signature); null for session. */
  evidenceValid: boolean | null;
  valid: boolean;
}

export async function verifyRecordSignatures(ctx: DocsignCtx, rec: DocSignRecord): Promise<SignatureCheck[]> {
  const nodeKey = await ctx.storage.getNodeKey();
  const out: SignatureCheck[] = [];
  for (const [signer, sig] of Object.entries(rec.signatures)) {
    const st = sig.statement;
    const consistent = st.request === rec.id && st.document.sha256 === rec.document.sha256 && st.signer === signer
      && st.evidence === evidenceHash(sig.passkey ?? sig.key ?? null);
    const sealValid = await verifySeal(st, sig.seal);
    const sealByThisNode = !!nodeKey && sig.seal.publicKey === nodeKey.publicKey;
    let evidenceValid: boolean | null = null;
    if (sig.key) {
      evidenceValid = sig.key.message === keyMessage(rec.id, rec.document.sha256, signer)
        // eslint-disable-next-line aimeat/no-silent-catch -- a stored key or signature that will not decode is evidence that does not verify: false is the answer
        && await verifyEd25519(sig.key.publicKey, sig.key.message, sig.key.signature).catch(() => false);
    } else if (sig.passkey) {
      evidenceValid = await verifyPasskeyEvidence(ctx.config, rec, signer, sig.passkey);
    }
    out.push({
      signer, signerName: st.signerName, signedAt: st.signedAt, method: st.method, assurance: st.assurance,
      consistent, sealValid, sealByThisNode, evidenceValid,
      valid: consistent && sealValid && sealByThisNode && evidenceValid !== false,
    });
  }
  return out;
}

async function verifyPasskeyEvidence(config: AimeatConfig, rec: DocSignRecord, signer: string, ev: PasskeyEvidence): Promise<boolean> {
  if (ev.intent.request !== rec.id || ev.intent.document !== rec.document.sha256 || ev.intent.signer !== signer) return false;
  try {
    const v = await verifyAuthenticationResponse({
      response: ev.assertion as never,
      expectedChallenge: Buffer.from(intentChallenge(ev.intent)).toString('base64url'),
      expectedOrigin: ev.origin,
      expectedRPID: config.passkeyRpId,
      credential: { id: ev.credentialId, publicKey: new Uint8Array(Buffer.from(ev.publicKey, 'base64url')), counter: 0 },
      requireUserVerification: true,
    });
    return v.verified;
  } catch {
    // eslint-disable-next-line aimeat/no-silent-catch -- the library throws for an assertion that does not verify (wrong challenge, origin, signature); false is that answer
    return false;
  }
}

// ── public lookup ──

export interface PublicSignature {
  signer: string;
  signerName: string | null;
  signedAt: string;
  method: SignMethod;
  assurance: Assurance;
  valid: boolean;
}

export interface PublicRequestView {
  id: string;
  title: string;
  state: DocSignRecord['state'];
  document: { sha256: string; name: string; size: number };
  createdAt: string;
  completedAt: string | null;
  partiesTotal: number;
  signatures: PublicSignature[];
}

export async function publicView(ctx: DocsignCtx, rec: DocSignRecord): Promise<PublicRequestView> {
  const checks = await verifyRecordSignatures(ctx, rec);
  return {
    id: rec.id, title: rec.title, state: rec.state,
    document: { sha256: rec.document.sha256, name: rec.document.name, size: rec.document.size },
    createdAt: rec.createdAt, completedAt: rec.completedAt, partiesTotal: rec.parties.length,
    signatures: checks.map((c) => ({ signer: c.signer, signerName: c.signerName, signedAt: c.signedAt, method: c.method, assurance: c.assurance, valid: c.valid })),
  };
}

/** Every AIMEAT signing request for a document, by its hash. Cancelled requests and requests nobody has signed are left out. */
export async function lookupByHash(ctx: DocsignCtx, sha256: string): Promise<PublicRequestView[]> {
  const sha = sha256.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new DocsignError('INVALID_INPUT', 400, 'sha256 must be 64 hex characters.');
  const ids = (await readJson<{ ids: string[] }>(ctx.storage, hashKey(sha)))?.ids ?? [];
  const out: PublicRequestView[] = [];
  for (const id of ids.slice(0, 50)) {
    const rec = await readJson<DocSignRecord>(ctx.storage, reqKey(id));
    if (!rec || rec.state === 'cancelled' || !Object.keys(rec.signatures).length) continue;
    out.push(await publicView(ctx, rec));
  }
  return out;
}

/** The public lookup with what a third party needs to check the seals without this node: the node's key. */
export async function lookupWithNodeKey(ctx: DocsignCtx, sha256: string): Promise<{
  sha256: string; requests: PublicRequestView[]; node: { id: string; public_key: string | null; key_url: string };
}> {
  const requests = await lookupByHash(ctx, sha256);
  const nodeKey = await ctx.storage.getNodeKey();
  return {
    sha256: sha256.toLowerCase(), requests,
    node: { id: ctx.config.nodeId, public_key: nodeKey?.publicKey ?? null, key_url: `${ctx.config.baseUrl}/.well-known/aimeat` },
  };
}

/** The SHA-256 of a file, as the request and the lookup name it. */
export const documentHash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

export { canonicalJson };
