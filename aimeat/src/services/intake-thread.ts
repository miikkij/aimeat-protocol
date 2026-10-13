/**
 * @file src/services/intake-thread.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A conversation through a public intake form: what a visitor who is not signed in
 *   and the form owner's agent (or the owner in person) say to each other, kept as records in the
 *   owner's workspace. This file is the part with no storage and no request in it: the settings a
 *   form carries, the visitor's secret, the shape of the three records and how they are read.
 *
 *   THREE RECORDS PER CONVERSATION, each in its own space of the form's workspace, all with the
 *   same id:
 *
 *     the thread   written by the node only: the visitor's turns, in order
 *     the reply    written by the owner's side (an agent, or a person in an app): the answers,
 *                  who answers from now on (`handler`), and whether the conversation is closed
 *     the signal   written by the node only, once per visitor turn an agent is to answer: its
 *                  publication is what wakes an agent that watches the signal space
 *
 *   WHY THE SIGNAL IS ITS OWN RECORD. An agent that watched the thread space would wake on every
 *   visitor turn, with no way for the node to hold one back. The node decides whether a turn costs
 *   the owner a model call: it writes no signal when a person has taken the conversation over, and
 *   none when the form's agent turns for the day are spent. The agent needs no rule of its own.
 *
 *   THE VISITOR HOLDS A SECRET, NOT AN ID. Starting a conversation returns a token once. The
 *   record id is a hash of it, so the id in the owner's workspace does not open the conversation
 *   to anyone, and a token is never stored. The token travels in a request body, never in an
 *   address, because addresses are logged.
 *
 *   WHAT A VISITOR READS BACK is the allow-list below and nothing else of either record: role,
 *   text and time of each turn, who answers, and whether it is closed.
 * @structure THREAD_DEFAULTS · THREAD_CEILINGS · IntakeThreadConfig · parseThreadConfig() ·
 *   THREAD_RECORD_FIELDS · SIGNAL_RECORD_FIELDS · newThreadToken() · threadIdOf() · cleanTurnText() ·
 *   ThreadTurn · turnsOfThread() · replyState() · composeTurns() · visitorTurnCount() ·
 *   lastVisitorTurnAt() · threadIsExpired()
 * @usage
 *   const parsed = parseThreadConfig(body.thread, namespace);
 *   const id = threadIdOf(token);                       // null for anything that is not a token
 *   const turns = composeTurns(turnsOfThread(thread), replyState(reply).replies);
 * @version-history
 *   v1.0.0 — 2026-10-13 — Initial (the October agents plan, P4:
 *     wish-el-v-keskustelu-kirjautumattoman-vierailijan-kanssa-p4-p-t-k).
 */
import { createHash, randomBytes } from 'node:crypto';

/** What a form's conversation settings are when the owner names none. */
export const THREAD_DEFAULTS = {
  /** Visitor turns in one conversation. */
  maxTurns: 20,
  /** Characters in one visitor turn. */
  maxChars: 2000,
  /** Days a conversation is kept after its last visitor turn. */
  ttlDays: 30,
  /** Conversations one form starts in a day (the form's own `max_per_day` when it sets one). */
  maxThreadsPerDay: 50,
  /** Visitor turns per day, over all conversations of the form, that wake an agent. */
  maxAgentTurnsPerDay: 300,
} as const;

/** The most an owner can set each to. */
export const THREAD_CEILINGS = { maxTurns: 200, maxChars: 8000, ttlDays: 365, maxAgentTurnsPerDay: 10_000 } as const;

/** The least time between two turns of one visitor in one conversation. */
export const MIN_TURN_INTERVAL_MS = 2000;

/** The conversation settings a form carries, as stored in its config. */
export interface IntakeThreadConfig {
  replyNamespace: string;
  signalNamespace: string;
  maxTurns: number;
  maxChars: number;
  ttlDays: number;
  maxAgentTurnsPerDay: number;
}

/** The properties the node writes into a thread record; its space's schema has to hold them. */
export const THREAD_RECORD_FIELDS = ['id', 'form_id', 'started_at', 'updated_at', 'turns', 'signalled_turn'] as const;
/** The properties the node writes into a signal record. */
export const SIGNAL_RECORD_FIELDS = ['id', 'thread', 'turn', 'at'] as const;

const NAMESPACE_SHAPE = /^[a-z0-9][a-z0-9_-]*(\.[a-z0-9][a-z0-9_-]*)*$/i;

function boundedInt(value: unknown, fallback: number, ceiling: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.min(Math.floor(value), ceiling) : fallback;
}

/**
 * The conversation settings of a form definition (`thread` in the body of POST /v1/intake/forms),
 * or why they cannot be stored. `formNamespace` is the form's own destination, which holds the
 * thread records.
 */
export function parseThreadConfig(raw: unknown, formNamespace: string): { ok: true; thread: IntakeThreadConfig } | { ok: false; message: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'thread must be an object with reply_namespace and signal_namespace' };
  const t = raw as Record<string, unknown>;
  const reply = typeof t.reply_namespace === 'string' ? t.reply_namespace.trim() : '';
  const signal = typeof t.signal_namespace === 'string' ? t.signal_namespace.trim() : '';
  for (const [name, ns] of [['reply_namespace', reply], ['signal_namespace', signal]] as const) {
    if (!ns || !NAMESPACE_SHAPE.test(ns)) return { ok: false, message: `thread.${name} is required and names a space of the workspace by its namespace` };
    if (ns.startsWith('meta.')) return { ok: false, message: `thread.${name} cannot be a meta.* namespace` };
  }
  if (new Set([formNamespace, reply, signal]).size !== 3) {
    return { ok: false, message: 'namespace, thread.reply_namespace and thread.signal_namespace must be three different spaces' };
  }
  return {
    ok: true,
    thread: {
      replyNamespace: reply,
      signalNamespace: signal,
      maxTurns: boundedInt(t.max_turns, THREAD_DEFAULTS.maxTurns, THREAD_CEILINGS.maxTurns),
      maxChars: boundedInt(t.max_chars, THREAD_DEFAULTS.maxChars, THREAD_CEILINGS.maxChars),
      ttlDays: boundedInt(t.ttl_days, THREAD_DEFAULTS.ttlDays, THREAD_CEILINGS.ttlDays),
      maxAgentTurnsPerDay: boundedInt(t.max_agent_turns_per_day, THREAD_DEFAULTS.maxAgentTurnsPerDay, THREAD_CEILINGS.maxAgentTurnsPerDay),
    },
  };
}

// ── The visitor's secret ─────────────────────────────────────────────────────

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** A new conversation secret: 32 random bytes, given to the visitor once and never stored. */
export function newThreadToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * The record id of the conversation a token opens, or null for anything that is not a token. The
 * id is a hash of the token, so reading an id out of the workspace opens nothing.
 */
export function threadIdOf(token: unknown): string | null {
  if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) return null;
  return 't' + createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 40);
}

// ── Turns ────────────────────────────────────────────────────────────────────

export interface ThreadTurn { role: 'visitor' | 'agent' | 'person'; text: string; at: string }

/**
 * A visitor's turn as it is stored: a string with the C0 control characters taken out (tab,
 * newline and return stay; a NUL cannot be stored by Postgres at all), trimmed, not empty and not
 * past the form's limit.
 */
export function cleanTurnText(value: unknown, maxChars: number): { ok: true; text: string } | { ok: false; message: string } {
  if (typeof value !== 'string') return { ok: false, message: 'text is required' };
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (!text) return { ok: false, message: 'text is required' };
  if (text.length > maxChars) return { ok: false, message: `text is too long: this conversation takes at most ${maxChars} characters in one message` };
  return { ok: true, text };
}

const isIso = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));

/** The visitor's turns of a thread record, in the order they were written. Anything else in it is left out. */
export function turnsOfThread(threadValue: unknown): ThreadTurn[] {
  const turns = (threadValue as { turns?: unknown } | null)?.turns;
  if (!Array.isArray(turns)) return [];
  return turns
    .filter((t): t is { text: string; at: string } => !!t && typeof (t as { text?: unknown }).text === 'string' && isIso((t as { at?: unknown }).at))
    .map((t) => ({ role: 'visitor' as const, text: t.text, at: t.at }));
}

/** The most answers of one reply record that are read, and the longest one. */
const REPLIES_MAX = 400;
const REPLY_CHARS_MAX = 8000;

/**
 * What the owner's side has said and decided, read from the reply record. The record is written by
 * a member (an agent's tool, or a person's app), so every field is read defensively:
 * `replies: [{ text, at, role? }]` with role "agent" unless it says "person"; `handler` is "person"
 * once a person has taken the conversation over, and "agent" otherwise; `closed` is true only when
 * the record says so. A missing record is an open conversation that an agent answers.
 */
export function replyState(replyValue: unknown): { handler: 'agent' | 'person'; closed: boolean; replies: ThreadTurn[] } {
  const v = (replyValue && typeof replyValue === 'object' ? replyValue : {}) as { handler?: unknown; closed?: unknown; replies?: unknown };
  const replies = (Array.isArray(v.replies) ? v.replies : [])
    .filter((r): r is { text: string; at: string; role?: unknown } => !!r && typeof (r as { text?: unknown }).text === 'string'
      && (r as { text: string }).text.trim().length > 0 && isIso((r as { at?: unknown }).at))
    .slice(0, REPLIES_MAX)
    .map((r) => ({ role: r.role === 'person' ? 'person' as const : 'agent' as const, text: r.text.slice(0, REPLY_CHARS_MAX), at: r.at }));
  return { handler: v.handler === 'person' ? 'person' : 'agent', closed: v.closed === true, replies };
}

/**
 * The conversation as the visitor reads it: both sides' turns in time order. Two turns with the
 * same time keep the visitor's first, because an answer follows what it answers.
 */
export function composeTurns(visitorTurns: ThreadTurn[], replies: ThreadTurn[]): ThreadTurn[] {
  const tagged = [...visitorTurns.map((t, i) => ({ t, side: 0, i })), ...replies.map((t, i) => ({ t, side: 1, i }))];
  tagged.sort((a, b) => Date.parse(a.t.at) - Date.parse(b.t.at) || a.side - b.side || a.i - b.i);
  return tagged.map((x) => ({ role: x.t.role, text: x.t.text, at: x.t.at }));
}

export function visitorTurnCount(threadValue: unknown): number {
  return turnsOfThread(threadValue).length;
}

/** When the visitor last wrote, in milliseconds, or 0 for a thread with no turn. */
export function lastVisitorTurnAt(threadValue: unknown): number {
  const turns = turnsOfThread(threadValue);
  return turns.length ? Date.parse(turns[turns.length - 1].at) : 0;
}

/** Whether a thread record is past the form's keeping time, counted from its last visitor turn. */
export function threadIsExpired(threadValue: unknown, nowMs: number, ttlDays: number): boolean {
  const updated = (threadValue as { updated_at?: unknown } | null)?.updated_at;
  const at = isIso(updated) ? Date.parse(updated) : lastVisitorTurnAt(threadValue);
  return at > 0 && nowMs - at > ttlDays * 24 * 60 * 60 * 1000;
}
