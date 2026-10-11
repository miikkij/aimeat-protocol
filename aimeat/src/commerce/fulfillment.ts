/**
 * @file src/commerce/fulfillment.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The commerce TASK fulfillment: create the agent TASK for one settled checkout line
 *   item. Extracted from session-service.ts (TARGET-034 phase B) so the app-tool resolver's
 *   task-path fulfillment — tools without a callable binding — reuses the exact same record shape
 *   and realtime push as the default offer-ask path, instead of growing a second task factory.
 * @structure createFulfillmentTask
 * @usage
 *   const taskId = await createFulfillmentTask(storage, session, item);            // seller agent
 *   const taskId = await createFulfillmentTask(storage, session, item, assignee);  // explicit target
 * @version-history
 *   v1.0.1 — 2026-10-11 — The order text names money only: no session is in morsels, which are
 *     pacing, never a currency (decision-morseli-on-tahdistus-ei-hinta-tarjouksen-kaksi-arvoa). A free
 *     item says it had no money price.
 *   v1.0.0 — 2026-07-14 — Extracted from session-service.ts; optional assignee override +
 *     app-tool wording (TARGET-034 phase B)
 */
import { randomUUID } from 'node:crypto';
import type { Storage, AgentTaskRecord } from '../storage/interface.js';
import type { CheckoutSessionRecord, CheckoutLineItem } from './types.js';
import { emitDelivery } from '../services/event-bus.js';

/**
 * Create the fulfillment TASK for one line item. `assigneeGaii` overrides the default assignee
 * (`item.agent`, the seller agent of an offer item) — the app-tool task path targets the
 * manifest-declared agent, or the seller owner's GHII when the manifest names none (the task then
 * lands in the owner's own task space instead of a specific agent queue).
 */
export async function createFulfillmentTask(
  storage: Storage,
  session: CheckoutSessionRecord,
  item: CheckoutLineItem,
  assigneeGaii?: string,
): Promise<string> {
  const target = assigneeGaii ?? item.agent;
  const isTool = item.kind === 'app-tool';
  const now = new Date().toISOString();
  const record: AgentTaskRecord = {
    id: randomUUID(),
    agentGaii: target,
    ownerGaii: session.sellerGhii,
    title: `Order: ${item.title}${item.quantity > 1 ? ` ×${item.quantity}` : ''}`,
    description: [
      `Commerce order from checkout session ${session.id}.`,
      // A session is always in money (a morsel is pacing, never a currency), and a free item says so.
      item.unitPrice > 0
        ? `Buyer: ${session.buyerIdentity} (paid ${item.unitPrice * item.quantity} ${session.currency} micro-units).`
        : `Buyer: ${session.buyerIdentity} (free: no money price).`,
      session.note ? `Buyer note: ${session.note}` : '',
      isTool
        ? `Run the tool "${item.offerId}" of app ${item.app ?? ''} and deliver the result to the buyer.`
        : `Deliver the offer "${item.title}" (${item.offerId})${item.quantity > 1 ? ` ×${item.quantity}` : ''}.`,
      isTool && item.input ? `Tool input: ${JSON.stringify(item.input)}` : '',
    ].filter(Boolean).join('\n'),
    scope: [
      { name: 'kind', value: 'commerce-order', type: 'text' },
      { name: isTool ? 'app_tool' : 'offer_id', value: item.offerId, type: 'text' },
      ...(isTool && item.app ? [{ name: 'app', value: item.app, type: 'text' as const }] : []),
      { name: 'commerce_session', value: session.id, type: 'text' },
      { name: 'buyer', value: session.buyerIdentity, type: 'text' },
    ],
    rules: [],
    verification: {
      userExpects: isTool
        ? `The result of tool ${item.offerId} (app ${item.app ?? ''}) reaches the buyer ${session.buyerIdentity}`
        : `The deliverable of offer ${item.offerId} reaches the buyer ${session.buyerIdentity}`,
      technicalChecks: [],
    },
    resources: {},
    todos: [],
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  };
  const created = await storage.createAgentTask(record);
  // Realtime push to the assignee (tunnel replays from backlog when offline; no-op otherwise).
  emitDelivery({ target, kind: 'task_assigned', id: record.id, payload: created });
  return record.id;
}
