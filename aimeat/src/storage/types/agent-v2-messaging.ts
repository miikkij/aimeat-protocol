/**
 * @file src/storage/types/agent-v2-messaging.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agent v2 messaging: one message shape that carries mixed content between principals,
 *   and one delivery target an absent principal can register so it hears about it.
 *
 *   WHY A SIXTH MESSAGE KIND, WHEN THIS NODE ALREADY HAS FIVE. The five that exist each answer a
 *   different question and none of them answers this one:
 *     · agent messages    an agent and ITS OWN owner, in one dashboard thread
 *     · direct messages   a person and another person, across nodes, behind a consent gate
 *     · notifications     something happened, told to the owner behind the session that noticed
 *     · web push          getting a notification onto that owner's phone
 *     · boards            posted once, read by whoever may read the board
 *   What is missing is a turn between two PRINCIPALS about one piece of work: my agent and your
 *   agent, or an editor and an agent, carrying text and a file and a structured payload in the same
 *   turn, grouped by what the turn is about rather than by who is in the room. Nothing above can be
 *   bent into it: the first is owner-bound, the second is human-bound, the third is one-directional
 *   and self-targeted, the fourth is a transport, the fifth is broadcast.
 *
 *   THE SHAPE IS NOT OURS AND THAT IS THE POINT. `role` + `parts` + `messageId` + `contextId` +
 *   `taskId` is the A2A message, and the delivery target below is A2A's PushNotificationConfig
 *   field for field. Inventing a near-miss would mean a translation layer at the border and a
 *   permanent argument about which side is right. All five of the above stay exactly as they are.
 *
 * @structure MessagePart · AgentV2MessageRecord · AgentV2PushConfigRecord
 * @usage import type { AgentV2MessageRecord } from '../interface.js';
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V4).
 */

/**
 * One piece of a turn. A message carries an ordered list of them, so a single turn can say
 * something, attach a file and hand over a structured payload without three round trips.
 *
 *   text  what a person or a model would read.
 *   file  a pointer, never bytes. `uri` addresses something already stored (this node's storage,
 *         or anywhere else); the record stays small and the file keeps one home.
 *   data  a structured payload a machine reads: a form's answers, a plan, a result.
 */
export type MessagePart =
  | { kind: 'text'; text: string; metadata?: Record<string, unknown> }
  | { kind: 'file'; file: { name?: string; mimeType?: string; uri: string }; metadata?: Record<string, unknown> }
  | { kind: 'data'; data: Record<string, unknown>; metadata?: Record<string, unknown> };

/** One turn between two principals. */
export interface AgentV2MessageRecord {
  /** Server-assigned. The address of this turn. */
  messageId: string;
  /**
   * Who is speaking, in the counterpart's terms rather than ours: `user` is whoever is asking,
   * `agent` is whoever is answering. It is NOT a principal type — an agent asking another agent
   * sends `user`, and that is the correct reading of the turn.
   */
  role: 'user' | 'agent';
  parts: MessagePart[];
  /**
   * What the turn is about. Every message in one exchange carries the same one, and it is the only
   * thing needed to read the exchange back. Client-chosen or server-assigned on the first turn.
   */
  contextId: string;
  /** The task this turn belongs to, once there is one. Null until V5 gives it one. */
  taskId: string | null;
  /** Sender and recipient, as resolved principal identities (GHII / GAII / GEAI). Never raw input. */
  from: string;
  to: string;
  /**
   * The account both sides sit under, bare name. Every read is fenced on THIS, so a message is
   * reachable by the owner whose principals sent and received it and by nobody else. A turn between
   * two owners' principals is not what this is for; that is what direct messages are.
   */
  owner: string;
  createdAt: string;
  /** Anything the sender wants carried along. Never read by the node. */
  metadata: Record<string, unknown> | null;
}

/**
 * Where to reach a principal that is not connected — A2A's PushNotificationConfig, field for field.
 *
 * THE CREDENTIALS ARE WRITE-ONLY. `authCredentials` is a secret this node SENDS OUTWARD on the
 * owner's behalf. It is stored and used and never returned by any read: a read answers with the
 * schemes so a person can see what is configured, and the secret itself leaves only in an
 * Authorization header to the URL that was registered for it.
 */
export interface AgentV2PushConfigRecord {
  /** Server-assigned config id. A principal may register more than one target. */
  id: string;
  /** The principal these deliveries are FOR. Its messages go to this URL. */
  principal: string;
  /**
   * One task's deliveries only, or null for every one of that principal's.
   *
   * A2A binds a push config to a TASK; V4 bound it to a principal, which is the more useful default
   * and stays the default. Both fit here: a config with a task is used only for turns filed against
   * that task, and one without is used for all of them.
   */
  taskId: string | null;
  /** The account it belongs to, bare name. The fence on every read, write and delete. */
  owner: string;
  /** The webhook. http(s) only, and every delivery goes through safeFetch. */
  url: string;
  /**
   * An opaque string the node echoes back inside every delivery. It is the receiver's way to know
   * the POST came from a configuration it made, and it is returned on read because that is the
   * point of it.
   */
  token: string | null;
  /** e.g. ['Bearer']. Returned on read. */
  authSchemes: string[];
  /** The secret itself. Never returned. */
  authCredentials: string | null;
  createdAt: string;
  updatedAt: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  /** Consecutive failures. Reset by a success. */
  failCount: number;
  /** Set when the node stopped trying. A person re-registers to clear it. */
  disabledAt: string | null;
}
