/**
 * @file src/services/attestation.ts
 * @description Dual-signed attestations (TINKI phase 1): an append-only record two to four
 *   principals co-sign with their REGISTERED Ed25519 keys — the trade-deed primitive ("both
 *   agents signed this exact payload"), generic for any co-signed fact (a deed, a contract
 *   acceptance, a handover receipt). The payload is canonicalized (sorted keys) and hashed
 *   (sha256); each party signs `aimeat-attest:{id}:{payloadHash}` client-side with the same key
 *   their auth already uses; the node verifies against the key it has on record. When every party
 *   has signed, the record completes and nothing can be added or changed.
 *
 *   Immutability without a schema change: records live under the reserved `sys:attest` namespace,
 *   which no principal-writable path can ever reach (resolveIdentity yields `owner@node`,
 *   `agent#owner@node` or `eco:app#owner@node`; extensions write `ext:{name}` — none collide with
 *   `sys:`). Only this service writes there, and it refuses everything after completion.
 * @structure AttestationRecord · canonicalJson · createAttestation · signAttestation ·
 *   getAttestation · verifyAttestation
 * @usage import { createAttestation, signAttestation } from '../services/attestation.js';
 * @version-history
 *   v1.0.0 — 2026-08-06 — Initial dual-sign service (TINKI phase 1)
 */
import { createHash, randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { verify } from '../auth/keypair.js';
import { parseGAII } from '../utils/gaii.js';
import { CommerceError } from '../commerce/errors.js';

/** Reserved server-only namespace — see the header for why no principal can write here. */
const ATTEST_NAMESPACE = 'sys:attest';
const attestKey = (id: string) => `attestation.${id}`;

export interface AttestationRecord {
  id: string;
  state: 'open' | 'complete';
  /** The co-signed fact, exactly as created (the canonical form is what the hash covers). */
  payload: unknown;
  /** sha256 hex over the canonical (sorted-keys) JSON of the payload. */
  payloadHash: string;
  /** 2-4 principal identities (GHII or GAII) that must all sign. */
  parties: string[];
  signatures: Record<string, { signature: string; signedAt: string }>;
  reference?: string;
  createdBy: string;
  createdAt: string;
  completedAt?: string;
}

/** Deterministic JSON: object keys sorted at every depth, arrays kept in order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/** The exact string a party signs. */
export const attestMessage = (id: string, payloadHash: string): string => `aimeat-attest:${id}:${payloadHash}`;

/** The registered verification key for a party identity, or null when the party is unknown. */
async function publicKeyFor(storage: Storage, identity: string): Promise<string | null> {
  if (identity.includes('#')) {
    const agent = await storage.getAgent(identity);
    return agent?.publicKey ?? null;
  }
  const parsed = parseGAII(identity);
  const owner = parsed?.owner ?? identity.split('@')[0];
  if (!owner) return null;
  const rec = await storage.getOwner(owner);
  return rec?.publicKey ?? null;
}

async function putAttestation(storage: Storage, att: AttestationRecord): Promise<void> {
  const existing = await storage.getMemory(ATTEST_NAMESPACE, attestKey(att.id));
  const now = new Date().toISOString();
  await storage.setMemory({
    key: attestKey(att.id), ownerGaii: ATTEST_NAMESPACE, value: att as unknown as Record<string, unknown>,
    visibility: 'public', tags: ['attestation'], ttlHours: null,
    version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
  });
}

export async function createAttestation(storage: Storage, _config: AimeatConfig, args: {
  payload: unknown;
  parties: string[];
  reference?: string;
  creatorIdentity: string;
}): Promise<AttestationRecord> {
  const parties = [...new Set(args.parties)];
  if (parties.length < 2 || parties.length > 4) {
    throw new CommerceError('INVALID_PARTIES', 422, 'An attestation needs 2-4 distinct parties');
  }
  if (!parties.includes(args.creatorIdentity)) {
    throw new CommerceError('CREATOR_NOT_PARTY', 403, 'The creator must be one of the parties');
  }
  const canonical = canonicalJson(args.payload ?? null);
  if (canonical.length > 64 * 1024) {
    throw new CommerceError('PAYLOAD_TOO_LARGE', 422, 'Attestation payload over 64 KB — store the bulk elsewhere and attest its hash');
  }
  for (const party of parties) {
    if (!(await publicKeyFor(storage, party))) {
      throw new CommerceError('PARTY_NOT_FOUND', 404, `No registered signing key for party: ${party}`);
    }
  }
  const att: AttestationRecord = {
    id: `att-${randomUUID()}`,
    state: 'open',
    payload: args.payload ?? null,
    payloadHash: createHash('sha256').update(canonical).digest('hex'),
    parties,
    signatures: {},
    reference: args.reference,
    createdBy: args.creatorIdentity,
    createdAt: new Date().toISOString(),
  };
  await putAttestation(storage, att);
  return att;
}

export async function getAttestation(storage: Storage, id: string): Promise<AttestationRecord> {
  const rec = await storage.getMemory(ATTEST_NAMESPACE, attestKey(id));
  if (!rec) throw new CommerceError('ATTESTATION_NOT_FOUND', 404, `No attestation ${id}`);
  return rec.value as unknown as AttestationRecord;
}

export async function signAttestation(storage: Storage, _config: AimeatConfig, args: {
  id: string;
  signerIdentity: string;
  signature: string;
}): Promise<AttestationRecord> {
  const att = await getAttestation(storage, args.id);
  if (att.state === 'complete') {
    throw new CommerceError('ATTESTATION_COMPLETE', 409, 'This attestation is complete — nothing can be added');
  }
  if (!att.parties.includes(args.signerIdentity)) {
    throw new CommerceError('NOT_A_PARTY', 403, 'Only a listed party may sign');
  }
  if (att.signatures[args.signerIdentity]) {
    throw new CommerceError('ALREADY_SIGNED', 409, 'This party has already signed');
  }
  const publicKey = await publicKeyFor(storage, args.signerIdentity);
  if (!publicKey) {
    throw new CommerceError('PARTY_NOT_FOUND', 404, `No registered signing key for ${args.signerIdentity}`);
  }
  const ok = await verify(publicKey, attestMessage(att.id, att.payloadHash), args.signature);
  if (!ok) {
    throw new CommerceError('BAD_SIGNATURE', 422,
      `Signature does not verify — sign the exact string "${attestMessage(att.id, att.payloadHash)}" with your registered Ed25519 key`);
  }
  att.signatures[args.signerIdentity] = { signature: args.signature, signedAt: new Date().toISOString() };
  if (att.parties.every((p) => att.signatures[p])) {
    att.state = 'complete';
    att.completedAt = new Date().toISOString();
  }
  await putAttestation(storage, att);
  return att;
}

/** Recompute the hash and re-verify every signature — the public "is this deed real" answer. */
export async function verifyAttestation(storage: Storage, att: AttestationRecord): Promise<boolean> {
  const canonical = canonicalJson(att.payload ?? null);
  const hash = createHash('sha256').update(canonical).digest('hex');
  if (hash !== att.payloadHash) return false;
  for (const party of att.parties) {
    const sig = att.signatures[party];
    if (!sig) return att.state === 'open' ? true : false;
    const publicKey = await publicKeyFor(storage, party);
    if (!publicKey || !(await verify(publicKey, attestMessage(att.id, att.payloadHash), sig.signature))) return false;
  }
  return true;
}
