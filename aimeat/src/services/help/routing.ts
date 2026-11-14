/**
 * @file src/services/help/routing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who a question goes to. A helper is a candidate when they chose to receive questions,
 *   their topics match, their audience allows the asker, they are available, and their weekly limit
 *   is not reached. The best match goes first, and among equals the one with the fewest questions this
 *   week, so the same few people do not carry everything (Cross, Rebele and Grant, HBR 2016: 3–5 % of
 *   people do 20–35 % of the helping).
 *
 *   THE ORDER CAN BE THE OPERATOR'S OWN. With `helpRoutingExtension` set, the extension's `rank` action
 *   receives the candidates (ids, matched topics, weekly load; never a question's text or anyone's
 *   memory) and answers `{ order: [ids] }`. Anything else, a timeout or an error, keeps the built-in
 *   order: routing never stops because an extension failed.
 *
 *   A PASS IS INVISIBLE. Who passed is in the route rows, which only the helper who passed can read.
 *   The asker sees "no answer yet", never "Bob had no time".
 * @structure HelpCandidate · findCandidates · weeklyLoad
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */
import type { HelpParticipantRecord } from '../../storage/types/help.js';
import { sharedOrganisms } from '../contacts-together.js';
import { runExtensionActionAsSystem } from '../extension/system-run.js';
import { localAccountName } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { addDays, matchCount, topicsInText, topicsMatch, type HelpDeps } from './rules.js';

export interface HelpCandidate {
  ghii: string;
  displayName: string;
  /** The helper's topics that matched the question. */
  matched: string[];
  /** Questions sent to this helper in the last seven days. */
  load: number;
  participant: HelpParticipantRecord;
}

/** Questions sent to this helper in the last seven days. */
export async function weeklyLoad(deps: HelpDeps, helperGhii: string, now: string): Promise<number> {
  const routes = await deps.storage.listHelpRoutesForHelper(helperGhii, { since: addDays(now, -7), limit: 200 });
  return routes.length;
}

function available(p: HelpParticipantRecord, now: string): boolean {
  if (p.status === 'available') return true;
  return !!p.statusUntil && p.statusUntil <= now;
}

/**
 * The helpers a question may go to, best first. `topics` are the question's own; when it has none,
 * a helper's topic that appears in `text` counts as a match. `exclude` holds people who already got
 * the question or must not get it (the asker). `named`, when given, limits the search to these
 * people, still subject to their own choices.
 */
export async function findCandidates(deps: HelpDeps, args: {
  askerGhii: string; topics: string[]; text: string; exclude: Set<string>; named?: string[]; now?: string;
}): Promise<HelpCandidate[]> {
  const now = args.now ?? new Date().toISOString();
  const helpers = await deps.storage.listHelpers({ limit: 1000 });
  const pool = helpers.filter(p => p.ownerGhii !== args.askerGhii && !args.exclude.has(p.ownerGhii) && available(p, now)
    && (!args.named || args.named.includes(p.ownerGhii)));
  if (pool.length === 0) return [];

  const needsShared = pool.filter(p => p.audience === 'organisms').map(p => p.ownerGhii);
  const shared = needsShared.length ? await sharedOrganisms(deps.storage, args.askerGhii, needsShared) : new Map();

  const out: HelpCandidate[] = [];
  for (const p of pool) {
    if (p.audience === 'organisms' && !(shared.get(p.ownerGhii)?.length)) continue;
    const matched = args.topics.length
      ? p.topics.filter(t => args.topics.some(q => topicsMatch(q, t)))
      : topicsInText(args.text, p.topics);
    // A person named by the asker is a candidate without a topic match; everyone else needs one.
    if (!args.named && matched.length === 0) continue;
    const load = await weeklyLoad(deps, p.ownerGhii, now);
    if (load >= p.capPerWeek) continue;
    const g = await deps.storage.getGHIIByOwner(localAccountName(p.ownerGhii));
    if (!g) continue;
    out.push({ ghii: p.ownerGhii, displayName: g.displayName || g.username, matched, load, participant: p });
  }
  // More of the question's topics covered first, then the lighter week, then a stable order.
  const covered = (c: HelpCandidate) => (args.topics.length ? matchCount(args.topics, c.matched) : c.matched.length);
  out.sort((a, b) => (covered(b) - covered(a)) || (a.load - b.load) || a.ghii.localeCompare(b.ghii));
  return rankWithExtension(deps, out, args.topics);
}

/** The operator's own order, when an extension is named and answers in time; the built-in order otherwise. */
async function rankWithExtension(deps: HelpDeps, candidates: HelpCandidate[], topics: string[]): Promise<HelpCandidate[]> {
  const name = deps.config.helpRoutingExtension;
  if (!name || candidates.length < 2) return candidates;
  try {
    const ext = await deps.storage.getExtension(name);
    if (!ext || !ext.installedBy || ext.installedBy.includes('@')) return candidates;
    const ownerGhii = `${ext.installedBy}@${deps.config.nodeId}`;
    const signal = AbortSignal.timeout(5000);
    const out = await runExtensionActionAsSystem({ storage: deps.storage, config: deps.config }, {
      extensionName: name, actionId: 'rank',
      input: { topics, candidates: candidates.map(c => ({ id: c.ghii, matched: c.matched, load: c.load, cap_per_week: c.participant.capPerWeek })) },
      // Nobody is present: the node itself asks, as a schedule does (system@<node>, a reserved name).
      callerGaii: `system@${deps.config.nodeId}`, ownerName: ext.installedBy, storageOwnerGhii: ownerGhii,
      logLabel: 'help-routing', producerKind: 'extension', signal,
    });
    const order = (out.result as { order?: unknown } | null)?.order;
    if (!Array.isArray(order)) return candidates;
    const byId = new Map(candidates.map(c => [c.ghii, c]));
    const ranked = order.filter((id): id is string => typeof id === 'string' && byId.has(id)).map(id => byId.get(id)!);
    const rest = candidates.filter(c => !ranked.includes(c));
    return [...ranked, ...rest];
  } catch (err) {
    logger.warn('help: the routing extension did not answer; the built-in order is used', { extension: name, error: String(err) });
    return candidates;
  }
}
