/**
 * @file src/commerce/platform-fee-writers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A once-per-node step over the `commerce.platform-fee.*` records written before the prefix
 *   was service-owned: a record that an account or an agent wrote into its own memory is marked "not
 *   counted", and the operator dashboard's money fee total leaves it out (sumPlatformFees). Nothing is
 *   deleted.
 *
 *   WHY. Until 2026-10-27 the prefix was writable through the memory routes by the account holder in
 *   person and by any agent in its own namespace, and the dashboard summed every record under it
 *   (secaudit2026oct26, routes/admin.ts:dashboard:any-namespace-platform-fee-records). Round 8 made the
 *   prefix service-owned and left out records in an agent's or an app's namespace; a record a person
 *   wrote into their own namespace before that kept counting, because the record does not name its
 *   writer.
 *
 *   POSITIVE EVIDENCE ONLY. commerce/platform-fee.ts recordMoneyPlatformFee is the one writer, and since
 *   2026-07-14 it has written the same record: into a person's namespace, visibility 'owner', the tags
 *   ['commerce'], no TTL, no AI provenance, and the value { fee, currency, mode, handler, sellerGhii,
 *   buyerGhii, trackingCode, at } with a positive fee, mode 'receivable' or 'connect' and the key's own
 *   tracking code. It writes straight to storage, so it leaves no row in the memory write tally, while
 *   every memory route records its writer there (services/data-map/write-tally-buffer.ts). A record is
 *   marked when one of these shows another writer: its namespace is not a person's, its metadata or its
 *   value is not what the node writes, or the tally names a principal whose last write is not older
 *   than the record's last change.
 *
 *   WHAT IS NOT ASKED. A record in an operator's namespace (an operator account, or the configured fee
 *   account) counts as before: it is the operator's own figure, and a question about it protects nobody
 *   from anybody. Every other record whose writer the evidence cannot name goes to the Security page as
 *   one incident with one entry per record: "uncount" (do not count it) or "keep" (count it), with one
 *   press, POST /v1/admin/security/incidents/:id/resolve, or the MCP tool aimeat_admin_incident_resolve
 *   and its CLI twin (services/incident-decisions.ts).
 *
 *   THE MARK. `notCounted: { at, reason, by }` on the record's value, written on its version with its
 *   metadata kept. The prefix is service-owned, so no memory route writes it again; the owner in person
 *   may still delete their own record. A record the node writes later at the same key replaces the
 *   value and counts.
 * @structure PLATFORM_FEE_WRITERS_STEP_KEY · PLATFORM_FEE_INCIDENT_TYPE · markPlatformFeeWritersOnce ·
 *   uncountPlatformFeeRecord
 * @usage await markPlatformFeeWritersOnce(storage, config);   // server-bootstrap/once-only-keep-steps.ts
 * @version-history
 *   v1.0.0 -- 2026-10-29 -- Initial (secaudit2026oct26 round 8c, routes/admin.ts:dashboard:any-namespace-platform-fee-records).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { listAllMemoryPages } from '../storage/memory-pages.js';
import { isValidGHII, localAccountName } from '../utils/gaii.js';
import { isOperatorAccount } from '../utils/operator-account.js';
import { logger } from '../utils/logger.js';
import { claimOnceOnlyStep } from '../services/once-only-step.js';
import { recordSecurityIncident, type IncidentEntry } from '../services/security-incident.js';
import { updateMemoryRecord, UNCHANGED } from '../services/record-cas.js';
import { flushWriteTallyBuffer } from '../services/data-map/write-tally-buffer.js';

/** The record under `system@<nodeId>` that says the step has run. */
export const PLATFORM_FEE_WRITERS_STEP_KEY = 'migrations.secaudit2026oct26.platform-fee-writers';

/** The incident's type, which services/incident-decisions.ts dispatches on. */
export const PLATFORM_FEE_INCIDENT_TYPE = 'platform_fee_records';

const PREFIX = 'commerce.platform-fee.';

/** The value fields recordMoneyPlatformFee writes, and nothing else. */
const NODE_FIELDS = ['at', 'buyerGhii', 'currency', 'fee', 'handler', 'mode', 'sellerGhii', 'trackingCode'];

/** How many records the incident lists as entries; the rest stay as they are. */
const ENTRY_ROWS = 500;

/** How much later than the tally's last write a record may have changed and still be that write. */
const TALLY_SLACK_MS = 60_000;

export interface PlatformFeeMark { at: string; reason: string; by: string }

/** Why the node did not write this record, or null when nothing shows that. */
function notTheNodesRecord(rec: MemoryRecord): string | null {
  if (!isValidGHII(rec.ownerGaii)) return 'it is in an agent\'s or an app\'s namespace, and the node writes fee records only into a person\'s';
  const tags = Array.isArray(rec.tags) ? rec.tags : [];
  if (rec.visibility !== 'owner' || tags.length !== 1 || tags[0] !== 'commerce' || rec.ttlHours != null || rec.aiProvenanceId) {
    return 'its visibility, tags, lifetime or AI provenance differ from what the node writes';
  }
  const v = rec.value as Record<string, unknown> | null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'its value is not a fee record';
  const keys = Object.keys(v).filter(k => k !== 'notCounted').sort();
  if (keys.join(',') !== NODE_FIELDS.join(',')) return 'its fields differ from what the node writes';
  const fee = v.fee;
  if (typeof fee !== 'number' || !Number.isFinite(fee) || fee <= 0) return 'its fee is not a positive amount';
  if (v.mode !== 'receivable' && v.mode !== 'connect') return 'its mode is not one the node writes';
  if (typeof v.currency !== 'string' || typeof v.handler !== 'string' || typeof v.sellerGhii !== 'string'
    || typeof v.buyerGhii !== 'string' || typeof v.at !== 'string' || !Number.isFinite(Date.parse(v.at))) {
    return 'its fields have values the node does not write';
  }
  if (v.trackingCode !== rec.key.slice(PREFIX.length)) return 'its tracking code is not the one in its key';
  return null;
}

/** The principal whose write through a memory route is the record's current value, or null. */
async function routeWriter(storage: Storage, rec: MemoryRecord): Promise<string | null> {
  const rows = (await storage.listMemoryWriteTally({ ownerGaii: rec.ownerGaii, key: rec.key })).filter(r => r.writeCount > 0);
  const latest = rows.reduce<typeof rows[number] | null>((a, r) => (!a || r.lastAt > a.lastAt ? r : a), null);
  if (!latest) return null;
  const changed = Date.parse(rec.updatedAt);
  const wrote = Date.parse(latest.lastAt);
  if (!Number.isFinite(changed) || !Number.isFinite(wrote) || changed > wrote + TALLY_SLACK_MS) return null;
  return latest.writerPrincipal;
}

/** Write the mark onto the record's value, keeping its metadata. False when it is gone or marked already. */
async function mark(storage: Storage, ownerGaii: string, key: string, m: PlatformFeeMark): Promise<boolean> {
  const done = await updateMemoryRecord(storage, ownerGaii, key, (rec) => {
    const v = rec?.value as Record<string, unknown> | null | undefined;
    if (!rec || !v || typeof v !== 'object' || Array.isArray(v) || v.notCounted) return UNCHANGED;
    return { value: { ...v, notCounted: m } };
  });
  return done !== null;
}

/** The operators' namespaces: every operator account, and the configured fee account. */
function operatorTest(storage: Storage, config: Pick<AimeatConfig, 'nodeId' | 'operatorFeeAccount'>): (ghii: string) => Promise<boolean> {
  const seen = new Map<string, boolean>();
  const feeAccount = config.operatorFeeAccount ? `${config.operatorFeeAccount}@${config.nodeId}` : null;
  return async (ghii) => {
    if (ghii === feeAccount) return true;
    if (!seen.has(ghii)) seen.set(ghii, isOperatorAccount(await storage.getOwner(localAccountName(ghii))));
    return seen.get(ghii)!;
  };
}

interface Outcome { marked: Array<{ owner: string; key: string; reason: string }>; asked: string[]; operators: number; kept: number }

/**
 * Mark the fee records another writer wrote, and name the ones nothing decides in one Security page
 * incident. Throws when a write fails, and then leaves no record, so the next start tries again.
 * @returns what the step did, or null on a node that ran it before
 */
export async function markPlatformFeeWritersOnce(storage: Storage, config: AimeatConfig): Promise<Outcome | null> {
  const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, PLATFORM_FEE_WRITERS_STEP_KEY);
  if (!claim) return null;
  try {
    await flushWriteTallyBuffer();
    const isOperator = operatorTest(storage, config);
    const out: Outcome = { marked: [], asked: [], operators: 0, kept: 0 };
    const undecided: MemoryRecord[] = [];
    const { items } = await listAllMemoryPages(storage, { prefix: PREFIX });
    const now = new Date().toISOString();
    for (const rec of items) {
      if (!rec.key.startsWith(PREFIX)) continue;
      const value = rec.value as { notCounted?: unknown } | null;
      if (value && typeof value === 'object' && value.notCounted) continue;
      const writer = await routeWriter(storage, rec);
      const reason = writer ? `${writer} wrote it through a memory route` : notTheNodesRecord(rec);
      if (reason) {
        if (await mark(storage, rec.ownerGaii, rec.key, { at: now, reason, by: 'node' })) out.marked.push({ owner: rec.ownerGaii, key: rec.key, reason });
        else out.kept += 1;
        continue;
      }
      if (await isOperator(rec.ownerGaii)) { out.operators += 1; continue; }
      undecided.push(rec);
    }
    if (undecided.length) {
      const entries = undecided.slice(0, ENTRY_ROWS).map(entryOf);
      out.asked = entries.map(e => e.id);
      await recordSecurityIncident(storage, config, {
        type: PLATFORM_FEE_INCIDENT_TYPE,
        code: 'PLATFORM_FEE_WRITER_UNKNOWN',
        actorGhii: `system@${config.nodeId}`,
        actorName: 'node',
        source: 'boot',
        detail: `${undecided.length} money platform-fee record(s) outside an operator's account look like the ones a sale writes, but nothing shows `
          + 'whether a sale or the account itself wrote them: before 27 October 2026 an account could write such a record into its own memory, '
          + 'and the dashboard counted it in the operator\'s money fees. They are counted as before until you decide. For each one: '
          + '"uncount" leaves it out of the dashboard\'s total, "keep" counts it. Nothing is deleted.',
        params: { count: String(undecided.length) },
        entries,
      });
    }
    await claim.finish({ at: now, marked: out.marked, asked: out.asked, operators: out.operators });
    if (out.marked.length) logger.info(`${out.marked.length} platform-fee record(s) another writer wrote are left out of the dashboard's money fees`);
    if (out.asked.length) logger.warn(`${out.asked.length} platform-fee record(s) need the operator's decision; see the Security page`);
    return out;
  } catch (err) {
    await claim.release();
    throw err;
  }
}

/** One undecided record as an entry of the incident (services/incident-entries.ts). */
function entryOf(rec: MemoryRecord): IncidentEntry {
  const v = rec.value as { fee: number; currency: string; sellerGhii: string; buyerGhii: string };
  const amount = `${(v.fee / 1_000_000).toFixed(2)} ${v.currency}`;
  return {
    id: `${rec.ownerGaii}/${rec.key}`, kind: 'platform_fee', where: rec.key, action: 'uncount', status: 'open',
    what: `the fee record ${rec.key} in ${rec.ownerGaii}'s memory: ${amount}, seller ${v.sellerGhii}, buyer ${v.buyerGhii}`,
    params: { owner: rec.ownerGaii, key: rec.key, amount, seller: v.sellerGhii, buyer: v.buyerGhii },
  };
}

/** The offered action of one entry (services/incident-entries.ts EntryActor): leave the record out of the total. */
export async function uncountPlatformFeeRecord(storage: Storage, _config: AimeatConfig, entry: IncidentEntry): Promise<string> {
  const owner = String(entry.params?.owner ?? '');
  const ok = owner && await mark(storage, owner, entry.where, { at: new Date().toISOString(), reason: 'the operator decided not to count it', by: 'operator' });
  return ok ? `the fee record ${entry.where} is left out of the dashboard's money fees` : `the fee record ${entry.where} was gone or left out already`;
}
