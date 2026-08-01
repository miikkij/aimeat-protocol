/**
 * @file src/services/exchange-work.ts
 * @description AGENT WORK records for EXCHANGE (TARGET-045 Gap 2) — the async third sellable surface
 *   (DATA / SERVICES / AGENT WORK). A consumer holding a metered contract for a provider agent's TASK TYPE
 *   STARTS a work item (input); the provider agent DELIVERS (output); the per-task price is metered ON
 *   DELIVERY — charge the consumer, credit the provider its cut, route the platform rake, decrement the
 *   budget — through the SAME G1 entitlement + G2 settlement as a synchronous call (settlement-rail ⊥
 *   pricing-model). Unlike data/app-tool calls (synchronous), the charge fires when the agent delivers, not
 *   on a request. Memory-backed under a system namespace; surfaced to the two parties by the authorised routes.
 * @structure AgentWork · newWorkId · putWork · getWork · listWorkByConsumer / ByProvider
 * @usage
 *   const w = await putWork(storage, { workId: newWorkId(), offeringId, consumerGaii, ... });
 *   // on delivery the exchange route settles via settleMeteredCoordinate against the consumer.
 * @version-history
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 8b: AgentWork carries `aiProvenanceId`, set at delivery, so
 *     the buyer can find out how the answer they paid for was made.
 *   v1.0.0 — 2026-07-21 — Initial agent-work records (start → deliver → settle on delivery); metered per task.
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import type { EntitlementUnit } from './metered-entitlements.js';

const NS = 'exchange-work';
const keyOf = (id: string): string => `xwork.${id}`;

/** One unit of agent work under a contract: started by the consumer, delivered + settled by the provider. */
export interface AgentWork {
  workId: string;
  offeringId: string;
  consumerGaii: string;
  consumerOwner: string;
  providerGhii: string;
  providerOwner: string;
  agentGaii: string;
  taskType: string;
  ext: string;           // metered coordinate — `agentwork:{owner}/{agent}`
  action: string;        // metered coordinate — the task type
  input: unknown;
  output: unknown;
  note: string;
  state: 'open' | 'delivered' | 'cancelled';
  unit: EntitlementUnit;
  currency: string | null;
  chargedUnits: number;  // amount settled on delivery, in `unit` (0 until delivered)
  /**
   * TARGET-058: the provenance record describing the DELIVERED OUTPUT — how much of the answer the
   * buyer paid for a model wrote. Set at delivery, absent until then, and absent means UNSTATED
   * rather than "a person wrote it". Stored on the work value itself, which is a plain JSON memory
   * record, so no column and no migration.
   */
  aiProvenanceId?: string;
  createdAt: string;
  deliveredAt: string | null;
}

export function newWorkId(): string { return `work-${randomUUID().slice(0, 12)}`; }

export async function putWork(storage: Storage, w: AgentWork): Promise<AgentWork> {
  const now = new Date().toISOString();
  await storage.setMemory({
    key: keyOf(w.workId), ownerGaii: NS, value: w, visibility: 'private', tags: ['exchange-work'],
    ttlHours: null, version: 1, createdAt: w.createdAt || now, updatedAt: now,
  });
  return w;
}

export async function getWork(storage: Storage, id: string): Promise<AgentWork | null> {
  const rec = await storage.getMemory(NS, keyOf(id));
  return rec ? (rec.value as AgentWork) : null;
}

export async function listWorkByConsumer(storage: Storage, owner: string): Promise<AgentWork[]> {
  const { items } = await storage.listAllMemory({ prefix: 'xwork.', limit: 5000 });
  return items.map(r => r.value as AgentWork).filter(v => v && v.workId && v.consumerOwner === owner)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function listWorkByProvider(storage: Storage, owner: string): Promise<AgentWork[]> {
  const { items } = await storage.listAllMemory({ prefix: 'xwork.', limit: 5000 });
  return items.map(r => r.value as AgentWork).filter(v => v && v.workId && v.providerOwner === owner)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
