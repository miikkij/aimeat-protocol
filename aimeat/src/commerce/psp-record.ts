/**
 * @file src/commerce/psp-record.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The seller's payment-settings record (`commerce.psp`): read it, write it whole, and
 *   set the one invoice choice a seller makes for items delivered at once.
 *
 *   The record holds the Stripe credentials, the x402 payout address and the invoice choice side by
 *   side, so every write MERGES: one rail's settings never delete the other's. readPsp and writePsp
 *   moved here unchanged from routes/commerce.ts so that the REST route and the MCP tool
 *   aimeat_commerce_invoice_set write the invoice choice through one function.
 * @structure PspRecord · readPsp(storage, ownerGhii) · writePsp(storage, ownerGhii, next, encKey) ·
 *   setInvoiceAcceptImmediate(storage, config, ownerGhii, accept)
 * @usage import { readPsp, writePsp, setInvoiceAcceptImmediate } from '../commerce/psp-record.js';
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial: readPsp and writePsp moved from routes/commerce.ts;
 *     setInvoiceAcceptImmediate for PUT /v1/commerce/payout/invoice and aimeat_commerce_invoice_set.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { sealPspRecord, PSP_RECORD_KEY } from './psp-secrets.js';
import { getEncryptionKey } from '../services/encryption.js';

export type PspRecord = { provider?: string; secretKey?: unknown; webhookSecret?: unknown; payTo?: string; address?: string; x402?: { address?: string; payTo?: string }; invoiceImmediate?: boolean };

/** Read the seller's payment settings record (private, owner-scoped). */
export async function readPsp(storage: Storage, ownerGhii: string): Promise<PspRecord> {
  const rec = await storage.getMemory(ownerGhii, PSP_RECORD_KEY);
  return (rec?.value as PspRecord | undefined) ?? {};
}

/**
 * Write the seller's payment settings record. Callers pass the WHOLE next record (they merged what
 * they keep), and the version/createdAt of the existing one carry forward — a rail setting must not
 * reset the record's history just because the other rail was edited.
 */
export async function writePsp(storage: Storage, ownerGhii: string, next: PspRecord, encKey: Buffer | null): Promise<void> {
  const existing = await storage.getMemory(ownerGhii, PSP_RECORD_KEY);
  const now = new Date().toISOString();
  // Every write seals the secrets it carries, including a plain one read back from a record that
  // predates encryption: a record this door touched never leaves it holding a secret in the clear.
  // A node with no encryption key cannot seal; the door that SETS a secret refuses on such a node,
  // so the only plain value that can pass here is one that was already stored.
  const sealed = encKey ? sealPspRecord(encKey, next as Record<string, unknown>).record : next;
  await storage.setMemory({
    key: PSP_RECORD_KEY, ownerGaii: ownerGhii, value: sealed, visibility: 'private', tags: ['commerce'], ttlHours: null,
    version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
  });
}

/**
 * Whether this seller gives invoice credit for what is delivered as soon as a checkout completes (a
 * tool call, a package grant, a pay token, a pacing pack). Off by default: the invoice rail captures
 * nothing, and such a line cannot be withheld afterwards (QA audit S8-03). Merges into the record, so
 * the other rails' settings survive. Answers the value now stored.
 */
export async function setInvoiceAcceptImmediate(storage: Storage, config: AimeatConfig, ownerGhii: string, accept: boolean): Promise<boolean> {
  await writePsp(storage, ownerGhii, { ...(await readPsp(storage, ownerGhii)), invoiceImmediate: accept }, getEncryptionKey(config));
  return accept;
}
