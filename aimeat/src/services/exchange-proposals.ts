/**
 * @file src/services/exchange-proposals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Contract RENEGOTIATION for EXCHANGE (TARGET-045). A live contract (metered entitlement) can be
 *   renegotiated instead of blindly revoked + re-accepted: either party PROPOSES new terms (a new per-call
 *   price and/or a new budget cap + a note — e.g. "the upstream API got pricier"), a message is delivered to
 *   the counterparty (Profile > Messages), and when the counterparty ACCEPTS, the old contract is archived to
 *   history (with its final spend + period) and a fresh one takes effect at the agreed terms. Mutual consent
 *   is the authority: whoever proposes, the OTHER party's acceptance makes the new price legitimate (so a
 *   consumer-proposed price only binds once the provider accepts, and vice-versa). Memory-backed (no new
 *   table), stored under a system namespace, surfaced to the two parties by the authorised routes.
 * @structure ContractProposal · newProposalId · putProposal · getProposal · listProposalsForOwner ·
 *   supersedeWithProposal (archive old + mint new at the agreed terms)
 * @usage
 *   const p = await putProposal(storage, {...});
 *   const ent = await supersedeWithProposal(storage, proposal, existingEntitlement);
 * @version-history
 *   v1.1.0 — 2026-07-27 — Supersede reads the CONTRACT, not whatever currently authorises the call: a
 *     provider's grant is not terms to renegotiate.
 *   v1.0.0 — 2026-07-21 — Initial renegotiation: propose / accept (supersede + archive) / decline / withdraw.
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import {
  archiveEntitlement, createEntitlement, readContractForCall,
  type EntitlementUnit, type MeteredEntitlement,
} from './metered-entitlements.js';

const NS = 'exchange-proposal';
const keyOf = (id: string): string => `xprop.${id}`;

export const ownerOfGaii = (gaii: string): string => gaii.split('@')[0].split('#').pop() ?? gaii;

/** A proposed change to a live contract, pending the counterparty's decision. */
export interface ContractProposal {
  proposalId: string;
  /** The contract being renegotiated — its metered coordinate + parties. */
  consumerGaii: string;
  providerGhii: string;
  ext: string;
  action: string;
  capabilityLabel: string;
  /** Who initiated the change, and who must accept it. */
  proposedByRole: 'provider' | 'consumer';
  proposerGhii: string;
  proposerOwner: string;
  counterpartyGhii: string;
  counterpartyOwner: string;
  /** Proposed new terms — `null` means "leave unchanged". */
  newPricePerCall: number | null;
  newCapUnits: number | null;
  note: string;
  /** A snapshot of the current terms (for the diff shown to the counterparty + the history). */
  currentTerms: { unit: EntitlementUnit; pricePerCall: number; pricingModel: string; capUnits: number | null };
  status: 'pending' | 'accepted' | 'declined' | 'withdrawn';
  createdAt: string;
  resolvedAt: string | null;
}

export function newProposalId(): string { return `prop-${randomUUID().slice(0, 12)}`; }

export async function putProposal(storage: Storage, p: ContractProposal): Promise<ContractProposal> {
  const now = new Date().toISOString();
  await storage.setMemory({
    key: keyOf(p.proposalId), ownerGaii: NS, value: p,
    visibility: 'private', tags: ['exchange-proposal'], ttlHours: null, version: 1,
    createdAt: p.createdAt || now, updatedAt: now,
  });
  return p;
}

export async function getProposal(storage: Storage, id: string): Promise<ContractProposal | null> {
  const rec = await storage.getMemory(NS, keyOf(id));
  return rec ? (rec.value as ContractProposal) : null;
}

/** Every proposal an owner is party to (as proposer OR counterparty, either role), newest first. */
export async function listProposalsForOwner(storage: Storage, owner: string): Promise<ContractProposal[]> {
  const { items } = await storage.listAllMemory({ prefix: 'xprop.', limit: 5000 });
  return items.map(r => r.value as ContractProposal)
    .filter(v => v && v.proposalId && (v.proposerOwner === owner || v.counterpartyOwner === owner))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * Apply an accepted proposal: archive the live entitlement to history (superseded), then mint a fresh one at
 * the agreed terms under the SAME coordinate. Price change → the contract moves to a straightforward per-call
 * model at the new price (plan renegotiation is a separate re-accept); an unchanged field keeps its value.
 * The new contract starts a fresh meter (spend 0) — the old totals live on in the archived history entry.
 * Returns the new entitlement, or null if the live contract vanished.
 */
export async function supersedeWithProposal(
  storage: Storage, proposal: ContractProposal,
): Promise<MeteredEntitlement | null> {
  const existing = await readContractForCall(storage, proposal.consumerGaii, proposal.ext, proposal.action);
  if (!existing) return null;
  await archiveEntitlement(storage, existing, 'superseded', proposal.proposalId);
  const newPrice = proposal.newPricePerCall ?? existing.pricePerCall;
  const priceChanged = proposal.newPricePerCall != null && proposal.newPricePerCall !== existing.pricePerCall;
  const newCap = proposal.newCapUnits != null ? proposal.newCapUnits : existing.budget.capUnits;
  return createEntitlement(storage, {
    consumerGaii: existing.consumerGaii, appId: existing.appId, providerGhii: existing.providerGhii,
    ext: existing.ext, action: existing.action, capabilityLabel: existing.capabilityLabel,
    unit: existing.unit, pricePerCall: newPrice, currency: existing.currency,
    // A price change resets to a clean per-call model; otherwise keep the existing pricing state.
    pricing: priceChanged ? { model: 'per_call' } : existing.pricing,
    capUnits: newCap, rakePercent: existing.rakePercent, contractRef: `proposal:${proposal.proposalId}`,
    surface: existing.surface, escrowParty: existing.escrowParty, createdBy: proposal.counterpartyOwner,
    // Renegotiating a price does not renegotiate the brake: pacing carries across unchanged.
    tollMorsels: existing.tollMorsels ?? null,
    carrySpend: null,   // renegotiation = a fresh meter; the old spend is preserved in the archive
  });
}
