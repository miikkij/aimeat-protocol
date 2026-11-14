/**
 * @file src/services/help/rules.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shared parts of Ask someone who knows ("Kysy osaajalta"): the result shape every
 *   function answers, the limits, the ids, and how a question's topics are matched against a helper's.
 *
 *   TOPICS ARE THE PERSON'S OWN WORDS. A helper chooses them (suggested from their business card,
 *   never from their private interview answers); a question's topics come from the asker's AI or are
 *   read from the question's text. Matching is case-insensitive and starts at a word, so an inflected
 *   form finds its base ("Entralla" finds "Entra"), and "postgres" finds "PostgreSQL tuning".
 * @structure HelpDeps · HelpResult · refuse · limits · newQuestionId · newRouteId · normalizeTopic ·
 *   cleanTopics · topicsMatch · matchCount · topicsInText · addDays · addHours · monthStart
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';

/** What every help function takes. */
export interface HelpDeps { storage: Storage; config: AimeatConfig }
/** A refusal with its HTTP status, code and the words a person reads. */
export interface HelpRefusal { ok: false; status: number; code: string; message: string }
export type HelpResult<T> = { ok: true; data: T } | HelpRefusal;
export const refuse = (status: number, code: string, message: string): HelpRefusal => ({ ok: false, status, code, message });

export const MAX_TOPICS = 40;
export const MAX_TOPIC_LENGTH = 60;
export const MAX_SUBJECT = 200;
export const MAX_QUESTION = 8000;
export const MAX_TRIED = 4000;
export const MAX_ANSWER = 16000;
export const MAX_THANKS = 1000;
export const MAX_ATTACHMENTS = 10;
/** A question goes to at most this many helpers at once. */
export const MAX_HELPERS_AT_ONCE = 2;
/** Closed questions not kept for others are deleted this long after they closed. */
export const CLOSED_RETENTION_DAYS = 90;
/** An answered question nobody closed expires this long after its deadline. */
export const ANSWERED_GRACE_DAYS = 30;

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
function base32(bytes: Buffer, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += BASE32[bytes[i] % 32];
  return out;
}
export function newQuestionId(): string { return `hq_${base32(randomBytes(20), 20)}`; }
export function newRouteId(): string { return `hr_${base32(randomBytes(20), 20)}`; }

/** One topic as it is compared: trimmed, single-spaced, lower case. */
export function normalizeTopic(topic: string): string {
  return topic.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Topics as stored: trimmed, at most MAX_TOPIC_LENGTH each, no duplicates (case-insensitive), at most MAX_TOPICS. */
export function cleanTopics(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== 'string') continue;
    const shown = t.replace(/\s+/g, ' ').trim().slice(0, MAX_TOPIC_LENGTH);
    const key = normalizeTopic(shown);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(shown);
    if (out.length >= MAX_TOPICS) break;
  }
  return out;
}

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * `needle` stands in `hay` at the start of a word (letters of any script count as word characters).
 * The end is left open, so an inflected form matches its base: Finnish "Entralla" and "PostgreSQL:ään"
 * match the topics "Entra" and "PostgreSQL". A needle under three characters must be a whole word, so
 * "AI" does not match "aikataulu".
 */
function containsWord(hay: string, needle: string): boolean {
  if (!needle) return false;
  const end = needle.length < 3 ? '($|[^\\p{L}\\p{N}])' : '';
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(needle)}${end}`, 'u').test(hay);
}

/** Two topics match when they are equal or one holds the other as a whole word. */
export function topicsMatch(a: string, b: string): boolean {
  const x = normalizeTopic(a);
  const y = normalizeTopic(b);
  if (!x || !y) return false;
  return x === y || containsWord(x, y) || containsWord(y, x);
}

/** How many of `wanted` some topic in `offered` matches. */
export function matchCount(wanted: string[], offered: string[]): number {
  return wanted.filter(w => offered.some(o => topicsMatch(w, o))).length;
}

/** The topics of `offered` that appear in a text as whole words. */
export function topicsInText(text: string, offered: string[]): string[] {
  const hay = normalizeTopic(text);
  return offered.filter(o => containsWord(hay, normalizeTopic(o)));
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString();
}
export function addHours(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * 3_600_000).toISOString();
}
/** The first moment of the UTC month `iso` falls in. */
export function monthStart(iso: string): string {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

/** A trimmed string of at most `max` characters, or '' for anything that is not a string. */
export function text(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.trim().slice(0, max) : '';
}
