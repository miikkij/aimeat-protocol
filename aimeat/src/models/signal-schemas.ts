/**
 * @file signal-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Record shapes for SIGNALS — the node's one generic way to count that something was
 *   reached. An email opened, a link clicked, a published page fetched, a QR scanned, an app's own
 *   event: one collector, one record shape, one report, so counts from different channels can be
 *   read side by side instead of each surface inventing its own tally.
 *
 *   THE SHAPE IS A MONTHLY ROLL-UP, NOT A ROW PER HIT, and that is the load-bearing decision here.
 *   The key budget is 1000 keys per principal (src/config.ts), so a record per hit — or even per
 *   day per stream — is not a design, it is an outage on a schedule: a 200-recipient campaign
 *   would eat the owner's whole namespace in weeks. One key per stream per month holds the daily
 *   buckets inside it, so a stream costs 12 keys a year no matter how many hits land, and the
 *   1024 kB value ceiling is nowhere near reached (a busy month measures in single-digit kB).
 *
 *   WHO, WITHOUT THE NODE LEARNING WHO. A hit may carry a `subject`: an opaque token the SENDER
 *   minted and only the sender can map back to a person. The node counts per subject so "who
 *   opened it" is answerable, and stores no address, no name and no IP, so the answer stays the
 *   sender's to give. A stream can turn the per-subject roll-up off entirely (`perSubject: false`)
 *   and keep the totals.
 *
 *   WHAT A HIT IS NOT: it is not a fact about a person. An open is an ARGUABLE signal — Apple Mail
 *   fetches images on the reader's behalf and Gmail proxies them, so opens count machines as
 *   readers — while a click is an act. The report says which is which rather than adding them up,
 *   because a number a customer cannot defend to their own customer is worth less than no number.
 *
 * @structure vocabularies (SignalEvent · SignalChannel · VisitorClass) · caps · SignalStreamConfig ·
 *   SignalMonthRecord · key builders · emptyMonth/emptyDay helpers
 * @usage import { streamKey, monthKey, type SignalMonthRecord } from '../models/signal-schemas.js';
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial: the generic hit-collection contract.
 */

/**
 * What happened. Deliberately a closed list: an open vocabulary would let two surfaces spell the
 * same act differently and make the report meaningless the first time anyone compared two channels.
 * `custom` is the escape hatch for an app's own event, and carries its own `ref` to say which.
 */
export const SIGNAL_EVENTS = ['open', 'click', 'view', 'scan', 'custom'] as const;
export type SignalEvent = (typeof SIGNAL_EVENTS)[number];

/** Where the hit came from. The dimension that answers "which channel brings the people". */
export const SIGNAL_CHANNELS = ['email', 'social', 'page', 'qr', 'app', 'other'] as const;
export type SignalChannel = (typeof SIGNAL_CHANNELS)[number];

/**
 * Who reached it, as far as the request can tell.
 *
 * `ai` is split out from `bot` rather than folded into it because it is the half a customer is
 * buying: a search crawler indexing a page and a person's assistant fetching it to answer a
 * question about them are different events, and only one of them means the brand showed up in an
 * AI's answer. `human` is the residual — no bot signature — which is an honest name for a guess.
 */
export const VISITOR_CLASSES = ['human', 'ai', 'bot'] as const;
export type VisitorClass = (typeof VISITOR_CLASSES)[number];

/**
 * Why an AI came. An assistant fetch happens because a PERSON asked something right now; a crawler
 * fetch happens because a model is being trained or an index is being built. A report that merged
 * them would answer neither "is anyone asking about us" nor "are we in the training data".
 */
export type AiFetchKind = 'assistant' | 'crawler';

// ── Caps ──────────────────────────────────────────────────────────────────────────────────────
// Every one of these bounds an UNAUTHENTICATED write path. They are constants rather than config
// because the safe value does not differ between localhost and the public internet: they exist to
// stop a stranger growing an owner's storage, and that is the same danger everywhere.

/** Streams one owner may hold. A stream is a deliberate act (a campaign, a page, a channel). */
export const MAX_STREAMS_PER_OWNER = 200;
/** Subjects rolled up inside one month record. Beyond it, hits still count in the totals — the
 *  per-subject detail stops growing, which keeps the record inside the value ceiling. */
export const MAX_SUBJECTS_PER_MONTH = 2000;
/** Hits counted per stream per day. Past it the door still answers normally and records nothing:
 *  a flood must not be able to make the report lie or the record grow. */
export const MAX_HITS_PER_STREAM_PER_DAY = 50_000;
/** Month records kept per stream. Older ones are pruned as new hits arrive, so an abandoned
 *  campaign cannot hold key budget forever. */
export const RETAIN_MONTHS = 24;
/** Length ceilings for the free-text-ish parts of a hit. */
export const MAX_SUBJECT_LEN = 64;
export const MAX_REF_LEN = 64;

// ── The stream ────────────────────────────────────────────────────────────────────────────────

/**
 * A named thing an owner measures. Server-trusted: the public collector reads it to decide whether
 * to accept an unauthenticated write and where to put it, which is why `signals.` is a reserved
 * owner prefix (utils/reserved-keys.ts) and why this record is written by the signals routes only,
 * never through the memory API.
 *
 * It holds NO destination URL, on purpose. A redirect target stored here would make the node an
 * open redirect the moment anything served it, so the click-through page belongs to the app that
 * owns the campaign, and the node's job stops at counting.
 */
export interface SignalStreamConfig {
  streamId: string;
  ownerGhii: string;
  /** The owner's own words for what this measures. Never interpreted. */
  label: string;
  /** Default channel for hits that do not name one. */
  channel: SignalChannel;
  /** Roll up per-subject detail. False keeps the totals and forgets who. */
  perSubject: boolean;
  enabled: boolean;
  /** Free-text grouping the owner chooses (an app id, a campaign family). Used for listing only. */
  group: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── The month record ──────────────────────────────────────────────────────────────────────────

/** Counts for one day, sliced the three ways a report is read. */
export interface SignalDayCounts {
  /** Total hits that day. */
  total: number;
  /** By event: `{ open: 12, click: 3 }`. Absent key means zero. */
  events: Partial<Record<SignalEvent, number>>;
  /** By channel. */
  channels: Partial<Record<SignalChannel, number>>;
  /** By who: human / ai / bot. */
  classes: Partial<Record<VisitorClass, number>>;
  /** Named AI agents seen that day and how often (`{ chatgpt: 4, claude: 1 }`). The evidence
   *  behind an AI-visibility claim: a count with no names is not something a customer can show. */
  aiAgents: Record<string, number>;
}

/** What one subject (one recipient, one visitor token) did this month. */
export interface SignalSubjectRoll {
  /** First and last time this subject was seen, ISO. */
  firstAt: string;
  lastAt: string;
  /** Per-event counts for this subject. */
  events: Partial<Record<SignalEvent, number>>;
  /** Which link/ref this subject last hit, when one was named. */
  lastRef: string | null;
  /** Whether anything this subject did looked like a machine. A campaign report uses it to keep a
   *  scanner's open out of "these people opened it". */
  machine: boolean;
}

/**
 * One stream's counts for one calendar month. THE unit of storage in this subsystem.
 *
 * `spec` names the document that says how to read it, so an agent or another system can honour the
 * shape without us shipping code for it (the Memory Contract pattern,
 * docs/coding-guidelines/memory-contracts.md).
 */
export interface SignalMonthRecord {
  type: 'aimeat.signals.month';
  spec: string;
  streamId: string;
  /** `YYYY-MM`. */
  month: string;
  /** Keyed `YYYY-MM-DD`. Only days with hits appear. */
  days: Record<string, SignalDayCounts>;
  /** Per-subject roll-up, absent entirely when the stream keeps totals only. */
  subjects: Record<string, SignalSubjectRoll>;
  /** True once MAX_SUBJECTS_PER_MONTH was reached: the totals stayed honest, the detail stopped.
   *  Named in the record rather than inferred, so a report can say so instead of looking complete. */
  subjectsTruncated: boolean;
  /** Hits the day caps refused, so a suppressed flood is visible rather than silent. */
  dropped: number;
  updatedAt: string;
}

export const SIGNAL_MONTH_SPEC = '/docs/specs/signals-contract.md';

// ── Keys ──────────────────────────────────────────────────────────────────────────────────────

/** Stream ids are slugs: `[a-z0-9-]`, 2-64. A key is an address, so it stays predictable. */
export const STREAM_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

export const streamKey = (streamId: string): string => `signals.stream.${streamId}`;
export const STREAM_KEY_PREFIX = 'signals.stream.';
export const monthKey = (streamId: string, month: string): string => `signals.hits.${streamId}.${month}`;
export const monthKeyPrefix = (streamId: string): string => `signals.hits.${streamId}.`;

/** `YYYY-MM` for an ISO instant, in UTC — one clock for every node and every reader. */
export const monthOf = (iso: string): string => iso.slice(0, 7);
/** `YYYY-MM-DD` for an ISO instant, in UTC. */
export const dayOf = (iso: string): string => iso.slice(0, 10);

export function emptyDay(): SignalDayCounts {
  return { total: 0, events: {}, channels: {}, classes: {}, aiAgents: {} };
}

export function emptyMonth(streamId: string, month: string, now: string): SignalMonthRecord {
  return {
    type: 'aimeat.signals.month',
    spec: SIGNAL_MONTH_SPEC,
    streamId,
    month,
    days: {},
    subjects: {},
    subjectsTruncated: false,
    dropped: 0,
    updatedAt: now,
  };
}
