/**
 * @file src/services/kyc/identify.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The identify link: a firm asks its customer to give their verified identity, and the
 *   customer gives it from their own account, once, with consent.
 *
 *   FLOW. Staff create a link for a card (createLink). The customer opens it signed in to their own
 *   account (describeLink): the page names the firm and exactly what it will receive. If the account
 *   has no strong verification yet, the customer verifies first with their bank ID (the existing
 *   /v1/ghii/verify/ftn/authorize flow). Then they give it (acceptLink): the card gets a version
 *   `identified` with the level, method, issuer and time, and the verified name; the customer's own
 *   disclosures list (services/account/verification-history.ts) records whom they gave it to. A link
 *   works once and for 14 days.
 *
 *   The token is stored only as its sha256, so a stored record cannot be turned back into a link.
 * @structure createLink · describeLink · acceptLink
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { CallerContext } from '../caller-context.js';
import { systemGhiiFor } from '../compliance/register.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { readVerifiedName } from '../verified-name.js';
import { eidasLevelOf, latestStrongVerification, recordDisclosure } from '../account/verification-history.js';
import { KycError, kycContext, requireCards, type KycContext, type KycDeps } from './access.js';
import { readHead, readSettings } from './store.js';
import { writeIdentity } from './cards.js';
import type { CustomerVersion } from './contract.js';

const DAYS = 14;
const hashOf = (token: string): string => createHash('sha256').update(token).digest('hex').slice(0, 40);
const linkKey = (token: string): string => `kyc.link.${hashOf(token)}`;

interface LinkRecord { org: string; card: string; createdBy: string; createdAt: string; expiresAt: string; usedAt?: string; usedBy?: string }
const parseLink = (v: unknown): LinkRecord | null => (v && typeof v === 'object' && typeof (v as LinkRecord).org === 'string' ? v as LinkRecord : null);

/** What the customer gives: shown on the page before they agree, and recorded in their disclosures. */
// Everything the card receives (acceptLink), the account address included: the page lists exactly this.
export const SHARED = ['verified name', 'verification level', 'verification method and issuer', 'time of verification', 'account address'] as const;

export async function createLink(deps: KycDeps, caller: CallerContext, org: string, card: string): Promise<{ token: string; path: string; expiresAt: string }> {
  const ctx = await kycContext(deps, caller, org);
  requireCards(ctx);
  const head = await readHead(deps.storage, deps.config.nodeId, org, card);
  if (!head) throw new KycError(404, 'CUSTOMER_NOT_FOUND', 'No such customer card in this organism.');
  if (head.kind !== 'person') throw new KycError(409, 'NOT_A_PERSON', 'The identify link is for a person; an entity is identified from the trade register and its representatives.');
  if (head.status === 'ended') throw new KycError(409, 'CUSTOMER_ENDED', 'The relationship has ended.');
  const token = randomBytes(24).toString('base64url');
  const now = new Date();
  const rec: LinkRecord = { org, card, createdBy: ctx.by, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + DAYS * 86_400_000).toISOString() };
  await deps.storage.createMemoryIfAbsent({
    key: linkKey(token), ownerGaii: systemGhiiFor(deps.config.nodeId), value: rec, visibility: 'private', tags: ['kyc'],
    ttlHours: DAYS * 24 + 24, version: 1, createdAt: rec.createdAt, updatedAt: rec.createdAt,
  });
  // The page the customer opens (Settings & Controls, signed in); it calls GET and POST /v1/kyc/links/{token}.
  return { token, path: `/v1/profile?tab=identify&token=${token}`, expiresAt: rec.expiresAt };
}

async function readLink(deps: KycDeps, token: string): Promise<LinkRecord> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new KycError(404, 'LINK_NOT_FOUND', 'This link is not valid.');
  const rec = parseLink((await deps.storage.getMemory(systemGhiiFor(deps.config.nodeId), linkKey(token)))?.value);
  if (!rec) throw new KycError(404, 'LINK_NOT_FOUND', 'This link is not valid.');
  if (rec.usedAt) throw new KycError(410, 'LINK_USED', 'This link has been used.');
  if (Date.parse(rec.expiresAt) < Date.now()) throw new KycError(410, 'LINK_EXPIRED', 'This link has expired. Ask the firm for a new one.');
  return rec;
}

function requirePerson(caller: CallerContext): void {
  if (caller.visitor || !caller.isPerson) throw new KycError(403, 'IN_PERSON_ONLY', 'Open the link signed in to your own account, in person.');
}

export interface LinkView {
  organism: { id: string; name: string };
  shared: readonly string[];
  verification: { level: string; method: string; at: string } | null;
  verifyPath: string | null;
}

export async function describeLink(deps: KycDeps, caller: CallerContext, token: string): Promise<LinkView> {
  requirePerson(caller);
  const rec = await readLink(deps, token);
  const organism = await deps.storage.getOrganism(rec.org);
  if (!organism) throw new KycError(404, 'LINK_NOT_FOUND', 'This link is not valid.');
  const strong = await latestStrongVerification(deps.storage, caller.ownerGhii);
  return {
    organism: { id: organism.id, name: organism.name },
    shared: SHARED,
    verification: strong ? { level: eidasLevelOf(strong.method), method: strong.method, at: strong.at } : null,
    // After the bank the person comes back to this same link (routes/verification.ts FTN_RETURN).
    verifyPath: strong ? null : `/v1/ghii/verify/ftn/authorize?return_to=${encodeURIComponent(`/v1/profile?tab=identify&token=${token}`)}`,
  };
}

export async function acceptLink(deps: KycDeps, caller: CallerContext, token: string): Promise<{ organism: string; given: readonly string[] }> {
  requirePerson(caller);
  const rec = await readLink(deps, token);
  const strong = await latestStrongVerification(deps.storage, caller.ownerGhii);
  if (!strong) throw new KycError(409, 'NOT_VERIFIED', 'Verify your identity with your bank ID first, then give it.');
  const name = await readVerifiedName(deps.storage, caller.ownerGhii);
  const organism = await deps.storage.getOrganism(rec.org);
  if (!organism) throw new KycError(404, 'LINK_NOT_FOUND', 'This link is not valid.');
  // Spend the link first: a second press, or a second tab, cannot give twice.
  await updateRecord(deps.storage, systemGhiiFor(deps.config.nodeId), linkKey(token), parseLink, (cur) => {
    if (!cur || cur.usedAt) throw new KycError(410, 'LINK_USED', 'This link has been used.');
    return { ...cur, usedAt: new Date().toISOString(), usedBy: caller.ownerGhii };
  }, { tag: 'kyc', tags: ['kyc'] }).catch((e) => { if (e instanceof KycError) throw e; return UNCHANGED; });
  // The firm's own context, as the node acting on the firm's link: the version names the customer as its writer.
  const ctx: KycContext = {
    org: rec.org, organism, settings: await readSettings(deps.storage, deps.config.nodeId, rec.org), role: 'staff', agent: false, by: caller.ownerGhii,
  };
  const identity: CustomerVersion['identity'] = {
    level: eidasLevelOf(strong.method), method: strong.method === 'eudiw' ? 'eudiw' : 'ftn', issuer: strong.issuer,
    verifiedAt: strong.at, faceToFace: false, ghii: caller.ownerGhii, evidence: name ? `Verified name: ${name.name}` : undefined,
  };
  await writeIdentity(deps, ctx, rec.card, identity!, 'The customer gave their own verified identity through the identify link.');
  await recordDisclosure(deps.storage, caller.ownerGhii, { at: new Date().toISOString(), organism: rec.org, organismName: organism.name, card: rec.card, what: [...SHARED] });
  return { organism: organism.name, given: SHARED };
}
