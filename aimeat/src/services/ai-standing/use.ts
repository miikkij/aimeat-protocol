/**
 * @file src/services/ai-standing/use.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The line on the owner's feed when one of their AIs did something without asking: what it
 *   did, on which permission, and who gave that permission and when.
 *
 *   WHY. Jouni, 2026-11-20: when an AI may act on its own, the act is only recorded, with the
 *   setting that allowed it, and the record shows in an audit log. The
 *   words this covers are the ones a person gives by name (./words.ts standingCandidates): an act on
 *   any of them is one the person would otherwise have been asked about.
 *
 *   HOW IT IS FED. requireScope (auth/middleware.ts) notes the words it admitted an agent for, the MCP
 *   tool wrapper (mcp/tool-usage-wrap.ts) the words of a tool an agent ran, and the publish gate
 *   (services/publish-requests/ask.ts) an agent that made something public on publish:public. All are
 *   synchronous and buffered, as services/scope/use.ts is: a call never waits on this, and a failed
 *   write never fails a call. The first act after a flush is written within FIRST_ACT_DELAY_MS, the
 *   rest at the next minute's flush.
 *
 *   WHICH WORDS. A word from the owner's setting, and a word no wildcard carries that the owner ticked
 *   on the agent's own page. A powerful word an agent holds through "Full access" (`*`, e.g. ai:use or
 *   task:write) writes no line: nobody gave it by name, and a line a day for every such agent would
 *   bury everything else on the feed.
 *
 *   ONE LINE PER AGENT, WORD AND DAY. An agent that publishes forty pages in a day on one permission
 *   writes one line, not forty: the line says the first thing it did that day. The day is kept in the
 *   owner's setting record (`noted`), so two node processes write it once between them.
 *
 *   WHICH SETTING. `via: "standing"` when the word came from the owner's "Allow always" setting (with
 *   who set it and when), `via: "agent"` when the owner gave it on that agent's own page.
 * @structure STANDING_USED_KIND · noteStandingUse(principal, words, call) · flushStandingUse() ·
 *   holdStandingUseForErasure(account) · initStandingUse(storage, config) · shutdownStandingUse()
 * @usage noteStandingUse(req.auth.sub, ['publish:public'], 'POST /v1/memory');
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-toimii-itsen-isesti-omistajan-asetuksella-salli-aina-ja-k).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { recordAccountEvent } from '../account/events.js';
import { agentPageUrl, plainPermission } from '../permission-ask.js';
import { serviceNamespaceOf } from '../service-records.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { ownerGhiiOf, parseGAII } from '../../utils/gaii.js';
import { isOutsideWildcard } from '../../utils/scope-coverage.js';
import { logger } from '../../utils/logger.js';
import { ErasureHolds, type ErasedAccount } from '../erasure/holds.js';
import { standingCandidates } from './words.js';
import { STANDING_KEY, parseStanding } from './settings.js';

/** The account event kind of the line (storage/types/account-events.ts). */
export const STANDING_USED_KIND = 'ai_acted_without_asking';

const FLUSH_INTERVAL_MS = 60_000;
/** The first act after a flush is written this soon, so the owner sees the line while it is news. */
const FIRST_ACT_DELAY_MS = 5_000;
/** At most this many distinct (agent, word) pairs wait between flushes; more are dropped and logged. */
const MAX_PENDING = 5_000;

// process-local: the storage and config this process writes the feed lines with, bound at start.
let storageRef: Storage | null = null;
// process-local: the config this process reads the feed lines' links from, bound at start.
let configRef: AimeatConfig | null = null;
// process-local: each process flushes the acts its own requests noted; the day mark is in storage, so two processes write one line.
let timer: ReturnType<typeof setInterval> | null = null;
// process-local: the early flush of this process's first act; a second process has its own.
let soon: ReturnType<typeof setTimeout> | null = null;
// process-local: this process's flush in progress, so an erasure waits for it.
let inFlight: Promise<void> | null = null;
/** `<agent GAII>|<word>` → the first act seen since the last flush. */
// process-local: the acts this process's requests noted; a crash before the flush loses at most a minute of feed lines.
let pending = new Map<string, { call: string; at: string }>();
// process-local: the word list, computed from code once; every process computes the same list.
let candidates: Set<string> | null = null;
/** The accounts whose erasure runs now: their agents' acts are not noted (holdStandingUseForErasure). */
const erasing = new ErasureHolds();

const day = (iso: string) => iso.slice(0, 10);

/**
 * Note that agent `principal` was admitted for `words` on `call` (a method and route, or a tool name).
 * Synchronous, never throws, never waits. Words a wildcard carries are ignored: only the words a
 * person gives by name make an act one they would otherwise have been asked about.
 */
export function noteStandingUse(principal: string, words: readonly string[], call: string): void {
  try {
    if (!storageRef || !parseGAII(principal) || erasing.covers(principal)) return;
    candidates ??= new Set(standingCandidates());
    for (const w of words) {
      if (!candidates.has(w)) continue;
      const key = `${principal}|${w}`;
      if (pending.has(key)) continue;
      if (pending.size >= MAX_PENDING) { logger.warn('[ai-standing] the act buffer is full; an act was not written to the feed', { principal, word: w }); return; }
      pending.set(key, { call: call.slice(0, 200), at: new Date().toISOString() });
      if (!soon && timer) {
        soon = setTimeout(() => { soon = null; void flushStandingUse(); }, FIRST_ACT_DELAY_MS);
        soon.unref?.();
      }
    }
  } catch (err) {
    logger.warn('[ai-standing] an act could not be noted', { principal, error: String(err) });
  }
}

/** Write what the buffer holds now: one feed line per agent, word and day. */
export async function flushStandingUse(): Promise<void> {
  if (inFlight) { await inFlight; }
  if (!storageRef || pending.size === 0) return;
  const batch = pending;
  pending = new Map();
  const storage = storageRef;
  const config = configRef;
  inFlight = (async () => {
    const byOwner = new Map<string, Array<{ gaii: string; word: string; call: string; at: string }>>();
    for (const [key, v] of batch) {
      const [gaii, word] = key.split('|');
      const owner = ownerGhiiOf(gaii);
      if (!byOwner.has(owner)) byOwner.set(owner, []);
      byOwner.get(owner)!.push({ gaii, word, ...v });
    }
    for (const [ownerGhii, acts] of byOwner) {
      if (erasing.covers(ownerGhii)) continue;
      try {
        let fresh: typeof acts = [];
        let words: Record<string, { at: string; by: string }> = {};
        let given: Record<string, string[]> = {};
        await updateRecord(storage, serviceNamespaceOf(ownerGhii), STANDING_KEY, parseStanding, (cur) => {
          words = cur.words; given = cur.given;
          fresh = acts.filter(a => cur.noted[`${a.gaii}|${a.word}`] !== day(a.at));
          if (fresh.length === 0) return UNCHANGED;
          const noted = { ...cur.noted };
          // A day older than yesterday is of no use to the next flush; the record does not grow.
          const yesterday = day(new Date(Date.now() - 86_400_000).toISOString());
          for (const [k, d] of Object.entries(noted)) if (d < yesterday) delete noted[k];
          for (const a of fresh) noted[`${a.gaii}|${a.word}`] = day(a.at);
          return { ...cur, noted };
        }, { tag: STANDING_KEY });
        for (const a of fresh) {
          const name = parseGAII(a.gaii)?.agent ?? a.gaii;
          const fromSetting = (given[a.gaii] ?? []).includes(a.word) && words[a.word];
          // A powerful word an agent holds through "Full access" (`*`) is not one the person gave by
          // name: a line a day for each such agent would bury the feed. The setting's words and the
          // words no wildcard carries (ticked by name on the agent's page) are written.
          if (!fromSetting && !isOutsideWildcard(a.word)) continue;
          await recordAccountEvent(storage, {
            ownerGhii, kind: STANDING_USED_KIND, actorGaii: a.gaii, at: a.at,
            subject: name,
            link: config ? agentPageUrl(config.baseUrl, name) : '',
            data: {
              name, word: a.word, words: (plainPermission(a.word, 'en') ?? a.word).replace(/\.+\s*$/, ''), call: a.call,
              via: fromSetting ? 'standing' : 'agent',
              ...(fromSetting ? { setAt: words[a.word].at, setBy: words[a.word].by } : {}),
            },
          }, config ?? undefined);
        }
      } catch (err) {
        logger.warn('[ai-standing] the acts could not be written to the feed', { owner: ownerGhii, error: String(err) });
      }
    }
  })();
  try { await inFlight; } finally { inFlight = null; }
}

/**
 * An account erasure: drop the account's waiting acts, wait for a write in progress, and note none of
 * the account's acts until the returned release is called (services/owner/erasure.ts).
 */
export async function holdStandingUseForErasure(account: ErasedAccount): Promise<() => void> {
  const release = erasing.hold(account);
  while (inFlight) await inFlight;
  for (const key of [...pending.keys()]) {
    if (ErasureHolds.isOf(key.split('|')[0], account)) pending.delete(key);
  }
  return release;
}

/** Arm the buffer and its flush timer (server-bootstrap). */
export function initStandingUse(storage: Storage, config: AimeatConfig): void {
  storageRef = storage;
  configRef = config;
  if (timer) clearInterval(timer);
  timer = setInterval(() => { void flushStandingUse(); }, FLUSH_INTERVAL_MS);
  timer.unref?.();
}

/** Write what waits and stop the timer (shutdown, tests). */
export async function shutdownStandingUse(): Promise<void> {
  if (timer) { clearInterval(timer); timer = null; }
  if (soon) { clearTimeout(soon); soon = null; }
  await flushStandingUse();
}
