/**
 * @file src/services/exchange-work.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AGENT WORK records for EXCHANGE (TARGET-045 Gap 2) — the async third sellable surface
 *   (DATA / SERVICES / AGENT WORK). A consumer holding a metered contract for a provider agent's TASK TYPE
 *   STARTS a work item (input); the provider agent DELIVERS (output); the per-task price is metered ON
 *   DELIVERY — charge the consumer, credit the provider its cut, route the platform rake, decrement the
 *   budget — through the SAME G1 entitlement + G2 settlement as a synchronous call (settlement-rail ⊥
 *   pricing-model). Unlike data/app-tool calls (synchronous), the charge fires when the agent delivers, not
 *   on a request. Memory-backed under a system namespace; surfaced to the two parties by the authorised routes.
 * @structure AgentWork · newWorkId · putWork · getWork · listWorkByConsumer / ByProvider · workView / workViews
 * @usage
 *   const w = await putWork(storage, { workId: newWorkId(), offeringId, consumerGaii, ... });
 *   // on delivery the exchange route settles via settleMeteredCoordinate against the consumer.
 *   res.json(success(nodeId, { work: await workView(storage, config, w) }));
 * @version-history
 *   v1.2.0 — 2026-10-08 — workView / workViews: the one wire shape of a work item, used by the REST
 *     routes and the MCP tools. It carries ai_provenance_id and the record itself, because the
 *     record is private and the buyer could not resolve a bare id.
 *   v1.1.1 — 2026-09-29 — Says why the work reads pass no classification reader (TARGET-082 V4): the
 *     records are the node's own ledger of what two parties exchanged. No behaviour change.
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 8b: AgentWork carries `aiProvenanceId`, set at delivery, so
 *     the buyer can find out how the answer they paid for was made.
 *   v1.0.0 — 2026-07-21 — Initial agent-work records (start → deliver → settle on delivery); metered per task.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { EntitlementUnit } from './metered-entitlements.js';
import { loadServedProvenanceMany, provenanceItemBlock, type AiProvenanceItemBlock } from './ai-provenance-marks.js';

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

// CLASSIFICATION (TARGET-082 V4, decided 2026-09-29). The reads below are the node's own ledger and
// pass no classification reader. A work record lives in the node's own namespace (`exchange-work`),
// and its input and output are values the two parties handed each other under a contract, through
// the start and deliver calls, not copies of a stored record. No label can be set on this namespace
// (setLabel admits only the owner of a scope, and this scope has none), so show() would decide every
// record by the node's default label alone: a default that hides content from AI would hide an
// agent's own work from it, with nobody able to correct it. The parties' own records are checked
// where they read them, before a value is passed in; the callers fence each record to its two
// parties (consumerOwner, providerOwner, consumerGaii).

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

/**
 * The wire shape of one work item, for POST /v1/exchange/work*, GET /v1/exchange/work and the
 * aimeat_exchange_work* MCP tools. One shape, so the REST route and the MCP tool cannot disagree
 * about a field again (the REST copy had no ai_provenance_id).
 *
 * `ai_provenance` carries the record itself. The record is private, because the delivery is: GET
 * /v1/provenance/:id answers 404 to everyone but its owner, so a bare id told the buyer that a
 * record existed and gave them no way to read it. Whoever may read the work item may know how its
 * answer was made, which is the same contract loadServedProvenance() states.
 */
export type WorkView = Record<string, unknown>;

function workViewOf(w: AgentWork, prov: AiProvenanceItemBlock | Record<string, never>): WorkView {
  return {
    work_id: w.workId, offering_id: w.offeringId, consumer: w.consumerGaii, provider: w.providerGhii,
    agent: w.agentGaii, task_type: w.taskType, ext: w.ext, action: w.action, input: w.input, output: w.output,
    note: w.note, state: w.state, unit: w.unit, currency: w.currency, charged_units: w.chargedUnits,
    // Absent until delivery, and absent is UNSTATED, never a claim that a person wrote it.
    ...(w.aiProvenanceId ? { ai_provenance_id: w.aiProvenanceId } : {}),
    ...prov,
    created_at: w.createdAt, delivered_at: w.deliveredAt,
  };
}

/** The views of a page of work items, with their records read in one query. */
export async function workViews(storage: Storage, config: AimeatConfig, works: readonly AgentWork[]): Promise<WorkView[]> {
  const byId = await loadServedProvenanceMany(storage, config, works.map(w => w.aiProvenanceId));
  return works.map(w => workViewOf(w, provenanceItemBlock(w.aiProvenanceId ? byId.get(w.aiProvenanceId) : undefined)));
}

/** The view of one work item. */
export async function workView(storage: Storage, config: AimeatConfig, w: AgentWork): Promise<WorkView> {
  return (await workViews(storage, config, [w]))[0];
}
