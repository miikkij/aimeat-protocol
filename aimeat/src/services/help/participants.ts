/**
 * @file src/services/help/participants.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A member's choices in Ask someone who knows: may others ask them, about what, how
 *   often, may they ask, and what their AI may do. A member who never chose has the node's defaults
 *   (config/help.ts): on an organisation node asking is on and helping is off (Jouni, 2026-11-14).
 *
 *   TOPICS ARE SUGGESTED FROM THE BUSINESS CARD. The card is the page the member's AI made from the
 *   profile interview and the member chose to publish; its JSON-LD names what they know
 *   (`knowsAbout`, `skills`). The interview's private answers (`journey.state`) are never read here
 *   (Jouni, 2026-11-14: "käyttäjien profiilisivut kertoo mitä he osaavat ja tekevät").
 * @structure effectiveParticipant · participationRefusal · getParticipation · setParticipation ·
 *   suggestTopics · topicsFromCardHtml
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */
import type { HelpParticipantRecord, HelpAiMode, HelpAudience, HelpStatus } from '../../storage/types/help.js';
import type { CallerContext } from '../caller-context.js';
import { resolvePublishedPortfolio } from '../portfolio/published.js';
import { localAccountName } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { HELP_ANSWER_SCOPE } from '../../utils/scope-coverage.js';
import { emitHelpChange } from './events.js';
import { cleanTopics, refuse, type HelpDeps, type HelpRefusal, type HelpResult } from './rules.js';

const AI_MODES: readonly HelpAiMode[] = ['off', 'draft', 'auto'];
const AUDIENCES: readonly HelpAudience[] = ['node', 'organisms'];
const STATUSES: readonly HelpStatus[] = ['available', 'busy', 'away'];

/** The member's choices with the node's defaults filled in where they never chose. */
export function effectiveParticipant(deps: HelpDeps, ownerGhii: string, rec: HelpParticipantRecord | null): HelpParticipantRecord {
  const now = new Date().toISOString();
  const c = deps.config;
  const base: HelpParticipantRecord = rec ?? {
    ownerGhii, helper: c.helpHelperDefault, asker: null, topics: [], audience: 'node',
    capPerWeek: c.helpCapPerWeekDefault, status: 'available', statusUntil: null, aiMode: 'draft',
    autoTopics: [], aiMaySend: true, agentsMayAsk: false, createdAt: now, updatedAt: now,
  };
  // An operator who switched the AI's own answers off overrides a member's earlier choice of auto.
  const aiMode = base.aiMode === 'auto' && !c.helpAiAutoAllowed ? 'draft' : base.aiMode;
  return { ...base, asker: base.asker ?? c.helpAskerDefault, aiMode };
}

/**
 * The refusal when the feature is off, the caller is not a member here, or the operator limited it to
 * organism members and the caller belongs to none. Null when they may take part.
 */
export async function participationRefusal(deps: HelpDeps, caller: CallerContext): Promise<HelpRefusal | null> {
  if (!deps.config.helpEnabled) return refuse(403, 'HELP_DISABLED', 'Ask someone who knows is switched off on this node.');
  if (caller.visitor) return refuse(403, 'MEMBERS_ONLY', 'Only members of this node can ask or answer here.');
  if (deps.config.helpParticipation === 'organism-members') {
    const memberships = await deps.storage.listMembershipsByGhii(caller.ownerGhii);
    if (!memberships.some(m => m.status === 'active')) {
      return refuse(403, 'MEMBERS_ONLY', 'On this node, Ask someone who knows is for members of a shared place (organism). Join one first.');
    }
  }
  return null;
}

/** The caller's own choices, with the defaults that apply and the topics their card suggests. */
export async function getParticipation(deps: HelpDeps, caller: CallerContext): Promise<HelpResult<{
  participant: HelpParticipantRecord; chosen: boolean; suggestedTopics: string[];
  node: { aiAutoAllowed: boolean; boardEnabled: boolean; rewardEnabled: boolean; reward: number };
}>> {
  const off = await participationRefusal(deps, caller);
  if (off) return off;
  const rec = await deps.storage.getHelpParticipant(caller.ownerGhii);
  const participant = effectiveParticipant(deps, caller.ownerGhii, rec);
  const suggested = (await suggestTopics(deps, caller.owner)).filter(s => !participant.topics.some(t => t.toLowerCase() === s.toLowerCase()));
  const c = deps.config;
  return {
    ok: true,
    data: {
      participant, chosen: !!rec, suggestedTopics: suggested,
      node: { aiAutoAllowed: c.helpAiAutoAllowed, boardEnabled: c.helpBoardEnabled, rewardEnabled: c.helpRewardEnabled, reward: c.helpReward },
    },
  };
}

/**
 * Change the caller's choices. Only the fields given change. An agent needs help:answer to change
 * them, and may never raise what its own owner allowed it: it cannot switch its AI level up or let
 * agents ask; only the person in person does that.
 */
export async function setParticipation(deps: HelpDeps, caller: CallerContext, body: Record<string, unknown>): Promise<HelpResult<{ participant: HelpParticipantRecord }>> {
  const off = await participationRefusal(deps, caller);
  if (off) return off;
  if (!caller.has(HELP_ANSWER_SCOPE)) {
    return refuse(403, 'SCOPE_DENIED', `Changing these choices needs the permission ${HELP_ANSWER_SCOPE}. The owner grants it on the Agents page, or changes them on the page Ask someone who knows.`);
  }
  const rec = await deps.storage.getHelpParticipant(caller.ownerGhii);
  const cur = effectiveParticipant(deps, caller.ownerGhii, rec);
  const next: HelpParticipantRecord = { ...cur, asker: rec?.asker ?? null, updatedAt: new Date().toISOString() };

  if (body.helper !== undefined) next.helper = body.helper === true;
  if (body.asker !== undefined) next.asker = body.asker === true;
  if (body.topics !== undefined) next.topics = cleanTopics(body.topics);
  if (body.audience !== undefined) {
    if (!AUDIENCES.includes(body.audience as HelpAudience)) return refuse(400, 'INVALID_INPUT', 'audience is node or organisms.');
    next.audience = body.audience as HelpAudience;
  }
  if (body.cap_per_week !== undefined) {
    const n = Number(body.cap_per_week);
    if (!Number.isInteger(n) || n < 1 || n > 50) return refuse(400, 'INVALID_INPUT', 'cap_per_week is a whole number from 1 to 50.');
    next.capPerWeek = n;
  }
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status as HelpStatus)) return refuse(400, 'INVALID_INPUT', 'status is available, busy or away.');
    next.status = body.status as HelpStatus;
  }
  if (body.status_until !== undefined) {
    const until = body.status_until === null || body.status_until === '' ? null : String(body.status_until);
    if (until !== null && Number.isNaN(Date.parse(until))) return refuse(400, 'INVALID_INPUT', 'status_until is an ISO date and time, or empty.');
    next.statusUntil = until === null ? null : new Date(until).toISOString();
  }
  if (body.ai_mode !== undefined) {
    if (!AI_MODES.includes(body.ai_mode as HelpAiMode)) return refuse(400, 'INVALID_INPUT', 'ai_mode is off, draft or auto.');
    next.aiMode = body.ai_mode as HelpAiMode;
  }
  if (body.auto_topics !== undefined) next.autoTopics = cleanTopics(body.auto_topics);
  if (body.ai_may_send !== undefined) next.aiMaySend = body.ai_may_send === true;
  if (body.agents_may_ask !== undefined) next.agentsMayAsk = body.agents_may_ask === true;

  if (next.aiMode === 'auto' && !deps.config.helpAiAutoAllowed) {
    return refuse(409, 'AI_AUTO_OFF', 'The operator of this node does not allow an AI to answer on its own. Choose off or draft.');
  }
  // The AI answers on its own only in topics the helper also offers.
  next.autoTopics = next.autoTopics.filter(a => next.topics.some(t => t.toLowerCase() === a.toLowerCase()));

  if (!caller.isPerson) {
    const rank = (m: HelpAiMode) => AI_MODES.indexOf(m);
    if (rank(next.aiMode) > rank(cur.aiMode) || (next.agentsMayAsk && !cur.agentsMayAsk) || (next.aiMaySend && !cur.aiMaySend)
      || next.autoTopics.some(a => !cur.autoTopics.some(c => c.toLowerCase() === a.toLowerCase()))) {
      return refuse(403, 'PERSON_REQUIRED', 'Only the person may give their AI more room (a higher AI level, more topics it answers on its own, or asking in their name). Ask them to change it on the page Ask someone who knows.');
    }
  }
  await deps.storage.putHelpParticipant(next);
  emitHelpChange(caller.ownerGhii);
  return { ok: true, data: { participant: effectiveParticipant(deps, caller.ownerGhii, next) } };
}

/** Topics the member's published business card names, for the member to choose from. */
export async function suggestTopics(deps: HelpDeps, ownerOrGhii: string): Promise<string[]> {
  const username = localAccountName(ownerOrGhii);
  try {
    const card = await resolvePublishedPortfolio(deps.storage, username);
    if (!card.ok || !card.html) return [];
    return topicsFromCardHtml(card.html);
  } catch (err) {
    // A card that cannot be read suggests nothing; the member still writes topics of their own.
    logger.warn('help: business card topics not read', { error: String(err) });
    return [];
  }
}

/** The `knowsAbout` and `skills` the JSON-LD blocks of a business card name, as plain topics. */
export function topicsFromCardHtml(html: string): string[] {
  const found: string[] = [];
  const blocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  const collect = (v: unknown, depth: number): void => {
    if (depth > 6 || v === null || v === undefined) return;
    if (Array.isArray(v)) { for (const x of v) collect(x, depth + 1); return; }
    if (typeof v !== 'object') return;
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'knowsAbout' || k === 'skills' || k === 'skill') {
        const list = Array.isArray(val) ? val : [val];
        for (const item of list) {
          if (typeof item === 'string') found.push(...item.split(/[,;]/));
          else if (item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string') found.push((item as { name: string }).name);
        }
      } else if (typeof val === 'object') collect(val, depth + 1);
    }
  };
  for (const block of blocks) {
    const body = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '');
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch (err) {
      // A JSON-LD block that does not parse names no topics; the card itself stays as the member made it.
      logger.debug('help: a business card JSON-LD block did not parse', { error: String(err) });
      continue;
    }
    collect(parsed, 0);
  }
  return cleanTopics(found);
}
