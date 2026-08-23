/**
 * @file src/storage/types/direct-messages.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Human↔human direct messaging record types: the mailbox copy, its attachments, the
 *   interactive question/answer payload, group conversations, delivery telemetry and the
 *   first-contact consent row.
 *
 *   Pure extraction from ./agents-messaging.ts, which crossed the 800-line limit. Nothing here
 *   changed in the move, and agents-messaging re-exports the whole block, so every existing import
 *   still resolves — the same shape the Capability Layer was split out in.
 * @structure One interface per record, in the order a message meets them: attachment → interactive
 *   payload → message → conversation → delivery log → contact consent.
 * @usage import type { DirectMessageRecord } from '../storage/interface.js';
 * @version-history
 *   v1.0.0 — 2026-08-23 — Extracted from agents-messaging.ts (max-file-lines), when
 *     ConversationRecord.remote pushed that file over the limit.
 */
// ── Direct Messages (human↔human GHII messaging + federation) ──

/**
 * A media object referenced by a direct message — inline in the markdown body via cid:{id}
 * or appended as a plain attachment. Every referenced storage object is one entry here: the
 * single source of truth for the duplication / grant / quota / ownership lifecycle.
 */
export interface DirectMessageAttachment {
  /** Short id used by cid:{id} inline references in the markdown body. */
  id: string;
  /** true = embedded in the body via cid:; false = appended attachment. */
  inline: boolean;
  /** Storage key at the origin (sender's node). */
  storageKey: string;
  /** Owner (sender) GHII that holds the original bytes. */
  ownerGhii: string;
  /** Node hosting the original bytes. */
  originNodeId: string;
  /** How the recipient accesses it. duplicate = the norm; reference = transient (pending/awaiting quota). */
  mode: 'reference' | 'duplicate';
  /** Recipient-side storage key, set once the attachment has been duplicated locally. */
  localKey?: string;
  /** Set when a held (reference) attachment was never duplicated within the retry TTL and was dropped. */
  expired?: boolean;
  mime: string;
  size: number;
  /** Original filename / caption. */
  name?: string;
  kind: 'image' | 'audio' | 'video' | 'file';
  /** Playing length of audio/video, measured when it was recorded. Lets the thread show a duration
   *  before the bytes are fetched. */
  durationSeconds?: number;
  /**
   * Text of a spoken attachment.
   *
   * `by: 'sender'` arrived with the message and is identical in both mailbox copies. `by: 'recipient'`
   * was produced locally with the reader's own key and lives ONLY in their copy — updateMessageAttachments
   * is keyed by owner, so there is no path for it to reach the other party.
   */
  transcript?: {
    text: string;
    by: 'sender' | 'recipient';
    model?: string;
    lang?: string;
    seconds?: number;
    /** ISO timestamp of when the transcription ran. */
    at: string;
  };
}

/** One option in an interactive question. `id` is stable; `label` is the human-facing text. */
export interface InteractiveOption {
  id: string;
  label: string;
}

/** A single structured question carried by an interactive message (mirrors the AskUserQuestion shape). */
export interface InteractiveQuestion {
  id: string;
  /** Short chip label (≈ ≤12 chars). */
  header: string;
  /** The full question text. */
  prompt: string;
  options: InteractiveOption[];
  /** true → the human may pick multiple options (checkboxes); false → single-select (radio). */
  multiSelect?: boolean;
  /** true (default) → also offer a freeform "Other" answer. */
  allowOther?: boolean;
  /** true → the human must answer before the reply can be sent (UI-gated). */
  required?: boolean;
}

/** The human's answer to one question: the chosen option ids plus an optional freeform "Other" value. */
export interface InteractiveAnswer {
  selected: string[];
  other?: string | null;
}

/**
 * Optional structured payload on a direct message — a federated AskUserQuestion. Discriminated by `role`:
 *  - `questions`: an agent asks the human a set of option-based questions (rendered as a form in the inbox).
 *  - `answers`: the human's reply, carrying machine-readable picks keyed by question id (the message body
 *    still holds a human-readable summary so the thread reads naturally on any peer).
 */
export type InteractivePayload =
  | { role: 'questions'; v: number; questions: InteractiveQuestion[]; submitLabel?: string }
  | { role: 'answers'; v: number; answersFor: string; answers: Record<string, InteractiveAnswer> };

/**
 * One mailbox copy of a direct message. Both sides store their own row (classic mailbox model):
 * the sender keeps an `outbound` row, the recipient an `inbound` row, sharing `id`/`conversationId`
 * so receipts and replies correlate. `ownerGhii` is whose mailbox this copy belongs to.
 */
export interface DirectMessageRecord {
  id: string;
  /** Whose mailbox copy this row is (sender's copy or recipient's copy). */
  ownerGhii: string;
  /** Groups a thread on both nodes. By default derived from the sorted GHII pair (one thread per pair);
   *  a subject thread instead uses a freshly minted id carried in the federation payload. */
  conversationId: string;
  /** Optional thread subject — set on the message that opens a new subject thread; lets a pair have
   *  more than one thread (e.g. per topic) instead of a single endless conversation. */
  subject?: string;
  senderGhii: string;
  recipientGhii: string;
  /** GFM markdown; inline media referenced as cid:{attachmentId}. May be empty if attachment-only. */
  body: string;
  attachments?: DirectMessageAttachment[];
  /** Optional structured payload — a federated AskUserQuestion (the question spec, or the human's answers). */
  interactive?: InteractivePayload;
  /** Set when this message is one copy of a broadcast (send-to-many) — groups the copies for results. */
  broadcastId?: string;
  /**
   * What KIND of message this is, when it is not a person writing to a person.
   *
   * `system-fault` is the node reporting its own failure to whoever runs it, without the user being
   * asked to describe anything. It exists so an operator's inbox can tell the two apart on sight,
   * because they are answered differently: a person's question wants an answer, a fault report wants
   * a fix and at most an acknowledgement. When one IS answered, the reply says the same three
   * things — it was not the user's doing, it is being corrected, and thank you for finding it.
   *
   * Omitted means an ordinary message. The field is the extension point, not a taxonomy: add a value
   * only when an operator would triage it differently.
   */
  kind?: 'system-fault';
  /** false = an announcement (recipients cannot reply); omitted/true = a normal message. Travels with the
   *  message (incl. cross-node) so the recipient's node can enforce/hide replies. */
  respondable?: boolean;
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'undeliverable';
  direction: 'inbound' | 'outbound';
  /** Message this is a reply to (same conversationId). */
  replyToId?: string;
  origin: 'local' | 'federation';
  /** Node that created (sent) the message. */
  originNodeId: string;
  /** Last delivery error, if status is failed/undeliverable. */
  error?: string;
  /**
   * TARGET-058: the provenance record describing this message's body — how much of it a model wrote,
   * and whether a person read the substance before it was sent.
   *
   * Both mailbox copies carry the SAME id: the statement is about the bytes, not about whose row it
   * is. Absent means UNSTATED, which is never "a human wrote it" — a message that arrived from a
   * peer node that strips provenance is unstated, not human-authored.
   */
  aiProvenanceId?: string;
  createdAt: string;
  deliveredAt?: string;
  /** When the RECIPIENT read it — on an outbound row a receipt travelling back, written by
   *  setMessageReadReceipt. Says nothing about whether this mailbox's owner has looked at the row. */
  readAt?: string;
  /**
   * When the mailbox's OWNER looked at this row, which `readAt` above cannot answer: a group thread
   * puts an agent's sent copy in its owner's mailbox, and the recipient reading it stamps `readAt`
   * there. Unread is "not written by me and not looked at" — `senderGhii !== ownerGhii` with this
   * field null — which is what the direction test stood in for until such a copy existed.
   */
  ownerReadAt?: string;
}

/**
 * A conversation with MORE than two participants.
 *
 * A two-party thread has no record: its id is derived from the sorted pair (conversationIdFor), so
 * both nodes agree on it without storing anything. The absence of a record IS the statement "this is
 * a pair", which is why adding groups migrated nothing.
 *
 * `participants` is the MEMBERSHIP, not a delivery list. Every participant still holds their own
 * mailbox copy of each message, so read state, deletion and federation stay per person rather than
 * per thread — the same model a pair thread uses, applied to n people.
 */
export interface ConversationRecord {
  /** The conversationId every message in this thread carries. */
  id: string;
  kind: 'group';
  /** Thread title. A group without one is a group nobody can tell apart in a list. */
  subject?: string;
  /** Identities that may read and write here: GHII, GAII or GEAI. */
  participants: string[];
  /** Who opened it (an identity, not necessarily a human — an agent may open a support thread). */
  createdBy: string;
  /**
   * The named address this thread was opened through, when it was opened through one.
   *
   * `support@operators` resolves to whoever holds the operator role AT THAT MOMENT, and that set
   * changes. Keeping the alias records what the sender actually addressed, which stays true even
   * after the membership does not.
   */
  alias?: string;
  /**
   * The one party to this thread who lives on ANOTHER node.
   *
   * Not a participant, deliberately. Membership stays node-local, because a group is n mailbox copies
   * written in one pass and a copy on a peer is a federation frame with its own delivery, retry and
   * membership-agreement problem — the limit createGroupConversation states and refuses. A support
   * thread that arrived from a peer needs exactly one thing that limit forbids: somewhere to send the
   * answer. This is that, and nothing more.
   *
   * `conversationId` is the id the OTHER side knows the thread by. It is usually the same as this
   * record's id, and is not when two nodes minted the same id for different threads.
   *
   * Set when the thread is created and never after, so refreshSupportParticipants and setParticipants
   * cannot clear it by writing a Partial that omits it.
   */
  remote?: { ghii: string; nodeId: string; conversationId: string };
  createdAt: string;
  updatedAt: string;
}

/**
 * Operator-facing delivery telemetry for one direct-message send attempt. Deliberately carries NO
 * message content and NO participant identities — only the routing/outcome metadata an operator
 * needs to see whether sends succeed or pile up in errors (status, target node, http/error, latency).
 */
export interface MessageDeliveryLog {
  id: string;
  /** The message's uuid (correlation only — not content). */
  messageId: string;
  origin: 'local' | 'federation';
  /** Recipient's node id (where it was being delivered). */
  targetNodeId: string;
  status: 'delivered' | 'queued' | 'failed' | 'undeliverable';
  httpStatus?: number;
  errorMessage?: string;
  latencyMs: number;
  createdAt: string;
}

/** Aggregated delivery stats for the operator dashboard. */
export interface MessageDeliveryStats {
  total: number;
  total24h: number;
  byStatus: Record<string, number>;
  byStatus24h: Record<string, number>;
  topTargetNodes: Array<{ nodeId: string; total: number; failed: number }>;
}

/**
 * Per-pair first-contact consent state, stored under the recipient's namespace. Drives the
 * first-contact gate: no record → pending request; accepted → free-flowing; blocked → rejected.
 */
export interface ContactConsentRecord {
  /** The human who owns this contact list (recipient side). */
  ownerGhii: string;
  /** The other party: GHII | GAII | GEAI. */
  contactId: string;
  state: 'pending' | 'accepted' | 'blocked';
  /** How the row came to exist: 'message' = created reactively by the first-contact DM gate
   *  (default); 'saved' = explicitly added to the owner's address book via the contacts API. */
  origin?: 'message' | 'saved';
  /** The request message that opened the relationship, if any. */
  firstMessageId?: string;
  createdAt: string;
  updatedAt: string;
}
