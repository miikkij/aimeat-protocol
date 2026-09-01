/**
 * @file src/services/a2a-foreign-handler.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The A2A surface a FOREIGN agent gets: hire this agent against something it has
 *   published, pay for it, and read the answer. Nothing else.
 *
 *   THIS IS A DIFFERENT HANDLER FROM THE SAME-ACCOUNT ONE, on purpose. The local handler projects
 *   V5 tasks, which are work between principals of one account; a stranger has no account here and
 *   must not touch that store at all. Sharing a class between them would mean one `if (foreign)`
 *   after another inside methods whose whole job is deciding what a caller may do — which is how a
 *   fence ends up with a hole in it. Two handlers, two surfaces, one route choosing between them.
 *
 *   WHAT A STRANGER CAN DO: message/send against a published offering, GetTask on its own work,
 *   CancelTask on its own work while it is still open. That is the list. Every other A2A method
 *   answers "not for you" rather than half-working.
 *
 *   THE MONEY IS THE EXISTING RAIL. First call: the work is quoted and the task comes back
 *   `input-required` (`auth-required` on the wire) carrying x402 payment requirements built from
 *   the offering's own price and the seller's own payout address. Second call, with the payment in
 *   `X-PAYMENT`: the facilitator verifies and settles, and only then is the work created. No
 *   settlement is invented here — `x402PaymentHandler` is the same one the checkout path uses.
 *
 *   AND THE OPERATOR TAKES THE SAME CUT it takes from a local sale. The fee is a property of the
 *   transaction, not of the buyer's account; the checkout session is where the local path happens
 *   to book it, not what makes it legitimate. Both roads read `commerceFeePercent(config)` and both
 *   compute it with `percentFee`, because a lower rate here would make "have no account on this
 *   node" the cheapest way to buy.
 *
 *   IT NEVER LEARNS A GAII. The task it holds is its own work id; the provider is named by the
 *   offering, which is public. `contextId` is the work id, `status.message` is the state, and the
 *   agent behind it stays an address on a card.
 *
 * @structure ForeignA2AHandler
 * @usage new ForeignA2AHandler(storage, config, agent, peer, card, payment)
 * @version-history
 *   v1.1.0 — 2026-09-01 — The platform fee is a real number at the same rate as every other sale,
 *     booked on the SELLER's side through `bookSessionlessSale`. v1.0.0 passed `fee: 0` and named
 *     it a gap; leaving it would have made "have no account here" the cheapest way to buy.
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V6a foreign path).
 */
import { TaskState, Role, type AgentCard, type Message, type Task,
  type SendMessageRequest, type GetTaskRequest, type CancelTaskRequest,
  type TaskPushNotificationConfig, type GetTaskPushNotificationConfigRequest,
  type ListTaskPushNotificationConfigsRequest, type ListTaskPushNotificationConfigsResponse,
  type DeleteTaskPushNotificationConfigRequest, type ListTasksRequest, type ListTasksResponse,
  type GetExtendedAgentCardRequest, type StreamResponse, type SubscribeToTaskRequest,
} from '@a2a-js/sdk';
import type { A2ARequestHandler, ServerCallContext } from '@a2a-js/sdk/server';
import {
  JsonRpcTaskNotFoundError, JsonRpcRequestMalformedError, JsonRpcUnsupportedOperationError,
  JsonRpcTaskNotCancelableError, JsonRpcTransportError,
} from '@a2a-js/sdk/errors';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord } from '../storage/interface.js';
import { fromA2APart } from './a2a-projection.js';
import { findSellableOffering, priceForForeignCaller, A2A_X402_EXTENSION } from './a2a-offering.js';
import type { ForeignPeer } from './a2a-foreign.js';
import { newWorkId, putWork, getWork, type AgentWork } from './exchange-work.js';
import { getPaymentHandler } from '../commerce/payment-handlers.js';
import { X402_HANDLER_ID } from '../commerce/x402-handler.js';
import { decodeXPayment } from '../commerce/x402-facilitator.js';
import { bookSessionlessSale } from '../commerce/session-service.js';
import { commerceFeePercent } from './marketplace-fee.js';
import { percentFee } from '../commerce/money.js';
import { notify } from './notify.js';
import { logger } from '../utils/logger.js';

/**
 * The refusals this door has that A2A does not name, in the -32000..-32099 range JSON-RPC leaves to
 * the server. A2A itself uses -32001..-32009, so these sit clear of it.
 *
 * THEY ARE CODES RATHER THAN A FIELD ON `data` because the SDK drops `data` for anything outside its
 * own semantic set: a machine-readable reason survives the wire only as the code. And they are
 * separate codes rather than one, because the three answers call for different next moves — give
 * up, name a different offering, come back later.
 */
export const A2A_FOREIGN_CODE = {
  /** Nothing is published for hire here. There is no id that would work. */
  NOTHING_FOR_SALE: -32040,
  /** Something is, but not what you named — or you named nothing and there are several. */
  OFFERING_NOT_NAMED: -32041,
  /** For sale, but this node cannot take your money right now. Not your fault, and not permanent. */
  PAYMENT_UNAVAILABLE: -32042,
  /** For principals of this account only. */
  NOT_FOR_STRANGERS: -32043,
} as const;

/** Which refusal an offering lookup or a price produced, as a wire code. */
function codeFor(reason: string): number {
  switch (reason) {
    case 'NO_OFFERING': return A2A_FOREIGN_CODE.NOTHING_FOR_SALE;
    case 'NO_SUCH_OFFERING':
    case 'OFFERING_REQUIRED': return A2A_FOREIGN_CODE.OFFERING_NOT_NAMED;
    default: return A2A_FOREIGN_CODE.PAYMENT_UNAVAILABLE;
  }
}

/**
 * A refusal that keeps its code on the wire.
 *
 * `new Error()` with a `code` property does NOT: the SDK's serialiser reads its own error classes
 * and turns everything else into -32603, which it did here until this was measured. The transport
 * error is the SDK's own envelope for a code outside its semantic set, so it is the way through.
 */
function rpcError(code: number, message: string): Error {
  return new JsonRpcTransportError({ jsonrpc: '2.0', id: null, error: { code, message } });
}

const forbidden = (message: string) => rpcError(A2A_FOREIGN_CODE.NOT_FOR_STRANGERS, message);

/** What the route hands in about payment, read off the request. */
export interface ForeignPayment {
  /** The raw X-PAYMENT header, if the caller sent one. */
  header?: string;
}

/** A foreign caller's work, as an A2A Task. Built here rather than shared with the local one. */
function workAsTask(work: AgentWork, quoted?: Record<string, unknown> | null): Task {
  const state = work.state === 'delivered'
    ? TaskState.TASK_STATE_COMPLETED
    : work.state === 'cancelled'
      ? TaskState.TASK_STATE_CANCELED
      : quoted
        ? TaskState.TASK_STATE_AUTH_REQUIRED
        : TaskState.TASK_STATE_WORKING;

  const line = work.state === 'delivered' ? 'Delivered.'
    : work.state === 'cancelled' ? 'Cancelled.'
      : quoted ? 'Payment required before this starts.'
        : 'Accepted and waiting for the agent.';

  const statusMessage: Message = {
    messageId: `${work.workId}:status`,
    contextId: work.workId,
    taskId: work.workId,
    role: Role.ROLE_AGENT,
    parts: [{ content: { $case: 'text', value: line }, metadata: undefined, filename: '', mediaType: 'text/plain' }],
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
  };

  return {
    id: work.workId,
    contextId: work.workId,
    status: { state, message: statusMessage, timestamp: work.deliveredAt ?? work.createdAt },
    artifacts: work.output
      ? [{
        artifactId: `${work.workId}:result`, name: 'result', description: '',
        parts: [{ content: { $case: 'data', value: work.output }, metadata: undefined, filename: '', mediaType: 'application/json' }],
        metadata: undefined, extensions: [],
      }]
      : [],
    history: [],
    // The quote travels where an x402 client looks for it, and nowhere near a field A2A defined for
    // something else.
    metadata: quoted ? { offeringId: work.offeringId, ...quoted } : { offeringId: work.offeringId },
  };
}

export class ForeignA2AHandler implements A2ARequestHandler {
  constructor(
    private readonly storage: Storage,
    private readonly config: AimeatConfig,
    private readonly agent: AgentRecord,
    private readonly peer: ForeignPeer,
    private readonly card: AgentCard,
    private readonly payment: ForeignPayment,
  ) {}

  async getAgentCard(): Promise<AgentCard> { return this.card; }

  async getAuthenticatedExtendedAgentCard(_p: GetExtendedAgentCardRequest, _c: ServerCallContext): Promise<AgentCard> {
    // A stranger gets the public card and no more. The extended card is for principals of the
    // account, and there is nothing in it a buyer needs in order to buy.
    return this.card;
  }

  /** Work this caller owns, or nothing. The fence on every read a stranger makes. */
  private async ownWork(workId: string): Promise<AgentWork> {
    const work = await getWork(this.storage, workId);
    if (!work || work.consumerGaii !== this.peer.gaii) {
      // Same answer for "not yours" and "not there": otherwise this is an oracle for other
      // people's work ids.
      throw new JsonRpcTaskNotFoundError({ message: 'No such task of yours.' });
    }
    return work;
  }

  async sendMessage(params: SendMessageRequest, _ctx: ServerCallContext): Promise<Message | Task> {
    const message = params.message;
    if (!message || message.parts.length === 0) {
      throw new JsonRpcRequestMalformedError({ message: 'A message with at least one part is required.' });
    }

    // A follow-up on existing work: the payment retry, or a nudge. Either way it is not new work.
    if (message.taskId) {
      const existing = await this.ownWork(message.taskId);
      return this.continueWork(existing, message);
    }

    const meta = (message.metadata ?? {}) as Record<string, unknown>;
    const asked = typeof meta.offeringId === 'string' ? meta.offeringId
      : typeof meta.skillId === 'string' ? meta.skillId : null;

    const found = await findSellableOffering(this.storage, this.agent, asked);
    if (!found.ok) {
      // What IS published goes in the message rather than in `data`, because `data` does not
      // survive the SDK's serialiser for a non-semantic error and a list nobody receives is worse
      // than no list: a client would have to guess ids.
      const list = found.available.length > 0 ? ` Published here: ${found.available.join('; ')}.` : '';
      throw rpcError(codeFor(found.code), `${found.message}${list}`);
    }
    const offering = found.offering;

    const parts = [];
    for (const p of message.parts) {
      const converted = fromA2APart(p);
      if (!converted) {
        throw new JsonRpcRequestMalformedError({
          message: 'This node holds a file part as a URL, not as inline bytes. Store the file and send a url part.',
        });
      }
      parts.push(converted);
    }

    const resource = `${this.config.baseUrl}/v1/a2a/${encodeURIComponent(this.agent.owner)}/${encodeURIComponent(this.agent.name)}`;
    const priced = await priceForForeignCaller(this.storage, this.config, offering, resource);
    if (!priced.ok) throw rpcError(codeFor(priced.code), priced.message);

    // The work exists from here on, unpaid and unstarted, so the caller has something to pay
    // AGAINST and something to poll. It is `open` with a quote on it; the provider is not told
    // about it until the money is in.
    const now = new Date().toISOString();
    const surface = offering.surface as { kind: 'agent-work'; agentName: string; taskType: string };
    const work: AgentWork = {
      workId: newWorkId(),
      offeringId: offering.offeringId,
      // The stranger's own identity, written down as it gave it. Not resolved into anything local:
      // it has no account here and inventing one would be the decision this path avoids.
      consumerGaii: this.peer.gaii,
      consumerOwner: '',
      providerGhii: offering.providerGhii,
      providerOwner: offering.providerOwner,
      agentGaii: `${surface.agentName}#${offering.providerOwner}@${this.config.nodeId}`,
      taskType: surface.taskType,
      ext: offering.ext,
      action: offering.action,
      input: { parts, from: this.peer.gaii },
      output: null,
      note: `A2A: ${this.peer.displayName}`,
      state: 'open',
      unit: offering.unit,
      currency: priced.price.currency,
      chargedUnits: 0,
      createdAt: now,
      deliveredAt: null,
    };
    await putWork(this.storage, work);

    return this.continueWork(work, message);
  }

  /**
   * Take one step on existing work: settle if the payment is here, otherwise quote.
   *
   * The quote is re-read every time rather than remembered, so a price that changed between the
   * quote and the payment is caught by the facilitator rather than honoured from a stale record.
   */
  private async continueWork(work: AgentWork, _message: Message): Promise<Task> {
    if (work.state !== 'open') return workAsTask(work);
    if (work.chargedUnits > 0) return workAsTask(work);

    const resource = `${this.config.baseUrl}/v1/a2a/${encodeURIComponent(this.agent.owner)}/${encodeURIComponent(this.agent.name)}`;
    const found = await findSellableOffering(this.storage, this.agent, work.offeringId);
    if (!found.ok) {
      throw rpcError(A2A_FOREIGN_CODE.NOTHING_FOR_SALE,
        'The offering this work was quoted against is no longer listed, so there is nothing left to pay for.');
    }
    const priced = await priceForForeignCaller(this.storage, this.config, found.offering, resource);
    if (!priced.ok) throw rpcError(codeFor(priced.code), priced.message);

    if (!this.payment.header) {
      // The x402 turn: what to pay, where, and on which network. The caller pays and sends the same
      // message again with the payment on it.
      return workAsTask(work, {
        x402Version: 1,
        accepts: [priced.price.requirements],
        extension: A2A_X402_EXTENSION,
      });
    }

    const handler = getPaymentHandler(X402_HANDLER_ID);
    if (!handler) {
      throw rpcError(A2A_FOREIGN_CODE.PAYMENT_UNAVAILABLE, 'This node cannot take that payment right now.');
    }

    const proof = decodeXPayment(this.payment.header);
    if (!proof) {
      return workAsTask(work, {
        x402Version: 1,
        accepts: [priced.price.requirements],
        extension: A2A_X402_EXTENSION,
        error: 'That X-PAYMENT header is not a base64 exact-scheme payment payload.',
      });
    }

    // The seller's own payout credentials, loaded the same way the checkout path loads them. The
    // handler charges onto the SELLER's rail; this node never holds the money.
    const psp = await this.storage.getMemory(work.providerGhii, 'commerce.psp');

    // THE PLATFORM FEE, AT THE SAME RATE AS EVERY OTHER SALE. Computed before the collect because
    // the handler contract takes it — it is booked separately rather than deducted at the rail, on
    // this road exactly as on the checkout one, so what the buyer signs for is the gross either way.
    const fee = percentFee(priced.price.amount, commerceFeePercent(this.config));

    try {
      // VERIFY AND SETTLE THROUGH THE EXISTING HANDLER. Nothing about the money is decided here:
      // the facilitator says whether the payment is real and moves it, exactly as it does for a
      // checkout session. `resource` is the string the buyer was quoted at and signed against.
      const receipt = await handler.collect(
        { storage: this.storage, config: this.config },
        {
          buyerGhii: this.peer.gaii,
          amount: priced.price.amount,
          currency: priced.price.currency,
          reference: work.workId,
          fee,
          instrument: proof,
          seller: { ghii: work.providerGhii, owner: work.providerOwner, psp: psp?.value },
          resource: priced.price.requirements.resource as string,
          description: priced.price.requirements.description as string,
        },
      );

      const trackingCode = receipt?.trackingCode ?? `x402_${work.workId}`;

      // THE SELLER'S SIDE OF THE SALE, through the same two calls the checkout path makes: the
      // operator's fee as a receivable under the operator's own GHII, and then whoever the seller
      // owes a share of what is left. Booked against the SELLER because that is where a fee on a
      // transaction belongs; nothing here creates an account for the buyer, and nothing here is a
      // second fee mechanism — it is `bookSessionlessSale`, which lives beside the checkout leg.
      const booked = await bookSessionlessSale(this.storage, this.config, {
        gross: priced.price.amount, currency: priced.price.currency,
        sellerGhii: work.providerGhii, buyerRef: this.peer.gaii,
        ext: work.ext, action: work.action,
        trackingCode, handler: X402_HANDLER_ID,
        reference: `a2a:${work.workId}:${work.ext}:${work.action}`,
      });

      const paid: AgentWork = {
        ...work,
        chargedUnits: priced.price.amount,
        note: `${work.note} · paid ${trackingCode}`,
      };
      await putWork(this.storage, paid);

      // NOW the provider hears about it. Telling them before the money arrived would be asking them
      // to start work a stranger had not paid for.
      await notify(this.storage, work.providerGhii, {
        type: 'a2a_foreign_work_paid',
        title: 'A paid task arrived from outside',
        body: `${this.peer.displayName} paid for "${work.taskType}" from your agent ${this.agent.name}. It is waiting in your work inbox.`,
        link: '/v1/profile#exchange',
      }).catch(err => logger.warn('a2a: could not notify the provider', { error: String(err) }));

      logger.info('a2a: foreign work paid and opened', {
        workId: paid.workId, peer: this.peer.gaii, offering: paid.offeringId,
        amount: paid.chargedUnits, fee: booked.fee, net: booked.net,
      });
      return workAsTask(paid);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('a2a: a foreign payment did not settle', { workId: work.workId, peer: this.peer.gaii, error: message });
      // Still quoted, still unpaid, still nothing done. The caller may pay again.
      return workAsTask(work, {
        x402Version: 1,
        accepts: [priced.price.requirements],
        extension: A2A_X402_EXTENSION,
        error: message,
      });
    }
  }

  async getTask(params: GetTaskRequest, _ctx: ServerCallContext): Promise<Task> {
    const work = await this.ownWork(params.id);
    return workAsTask(work);
  }

  async cancelTask(params: CancelTaskRequest, _ctx: ServerCallContext): Promise<Task> {
    const work = await this.ownWork(params.id);
    if (work.state !== 'open') {
      throw new JsonRpcTaskNotCancelableError({ message: `This work is ${work.state} and does not change now.` });
    }
    if (work.chargedUnits > 0) {
      // Paid work is the provider's to finish or refund; a buyer cancelling it unilaterally would
      // be taking the money back through a door that has no refund behind it.
      throw new JsonRpcTaskNotCancelableError({
        message: 'This work is paid for. Ask the provider to settle or refund it.',
      });
    }
    const cancelled: AgentWork = { ...work, state: 'cancelled' };
    await putWork(this.storage, cancelled);
    return workAsTask(cancelled);
  }

  async listTasks(_p: ListTasksRequest, _c: ServerCallContext): Promise<ListTasksResponse> {
    // Deliberately empty rather than refused: a client that lists is not doing anything wrong, and
    // a stranger has no roster here — it holds the ids of the work it created.
    return { tasks: [], nextPageToken: '', pageSize: 0, totalSize: 0 };
  }

  // eslint-disable-next-line require-yield
  async *sendMessageStream(_p: SendMessageRequest, _c: ServerCallContext): AsyncGenerator<StreamResponse, void, undefined> {
    throw new JsonRpcUnsupportedOperationError({ message: 'This agent does not stream. Poll GetTask.' });
  }

  // eslint-disable-next-line require-yield
  async *resubscribe(_p: SubscribeToTaskRequest, _c: ServerCallContext): AsyncGenerator<StreamResponse, void, undefined> {
    throw new JsonRpcUnsupportedOperationError({ message: 'This agent does not stream. Poll GetTask.' });
  }

  async createTaskPushNotificationConfig(_p: TaskPushNotificationConfig, _c: ServerCallContext): Promise<TaskPushNotificationConfig> {
    // A delivery target is a URL this node would call on somebody's behalf, and setting one up for
    // a party with no account here is a decision nobody has made.
    throw forbidden('Push notification targets are for principals of this account. Poll GetTask.');
  }

  async getTaskPushNotificationConfig(_p: GetTaskPushNotificationConfigRequest, _c: ServerCallContext): Promise<TaskPushNotificationConfig> {
    throw forbidden('Push notification targets are for principals of this account.');
  }

  async listTaskPushNotificationConfigs(_p: ListTaskPushNotificationConfigsRequest, _c: ServerCallContext): Promise<ListTaskPushNotificationConfigsResponse> {
    return { configs: [], nextPageToken: '' };
  }

  async deleteTaskPushNotificationConfig(_p: DeleteTaskPushNotificationConfigRequest, _c: ServerCallContext): Promise<void> {
    throw forbidden('Push notification targets are for principals of this account.');
  }
}
