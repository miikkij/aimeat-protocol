/**
 * @file src/services/permission-ask.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an agent tells its person when it lacks a permission, and the address where the
 *   person allows it with one press.
 *
 *   WHY. A person's ChatGPT tried to send a message and attach two PDFs for her, and told her only
 *   that sending "did not succeed" and that the upload was blocked "because of a missing
 *   storage:write permission" (2026-10-17). She could do nothing with that: the refusal named a
 *   permission word, no address and no step, and spoke of "the owner" while she was the owner. The
 *   tool for sending was not on the agent's list at all, so it said the node had no such function.
 *   The developer: "MITÄ VITTUA JOKU HEIDI TAJUAA SEMMOISESTA MITÄÄN".
 *
 *   WHAT IT GIVES. One address per (agent, permissions): /v1/allow?agent=<name>&need=<words>, the
 *   SPA page (views/agent-allow.js) that asks the person one question in their language with Allow
 *   and Don't allow, and never shows a permission word. One sentence for the AI, in English, that
 *   says what it may not do yet in plain words and tells it to hand the person that address in the
 *   person's own words.
 *
 *   WHICH WORDS ONE PRESS MAY GIVE. A word "Full access" carries and the node does not call powerful
 *   (config-posture.ts POWERFUL_AGENT_SCOPES). A word outside every wildcard (utils/scope-coverage.ts)
 *   is a decision the person makes on its own tick on the agent's page, so for those the AI hands the
 *   agent's page instead; the operator's words never reach a person's page at all.
 * @structure OPERATOR_WORDS · isOneClickWord · oneClickWords · allowUrl · agentPageUrl · plainPermission ·
 *   scopesBehindRecord · permissionAskText
 * @usage
 *   const text = permissionAskText({ baseUrl: config.baseUrl, agentGaii, tool: 'aimeat_dm_send', words: ['messages:send'] });
 * @version-history
 *   v1.1.0 — 2026-10-18 — OPERATOR_WORDS, the words the refusal notice for the agent's page leaves out
 *     on an account that does not run the node (services/permission-ask-notice.ts).
 *   v1.0.0 — 2026-10-17 — Initial (wish-puuttuva-lupa-ai-neuvoo-ihmist-yhdell-salli-painikkeella-eik).
 */
import type { Storage } from '../storage/interface.js';
import {
  isOutsideWildcard, uncoveredScopes, OPERATOR_ADMIN_SCOPE, OPERATOR_ORGANISM_REPAIR_SCOPE, COMPLIANCE_READ_SCOPE,
  COMPLIANCE_WRITE_SCOPE, SURFACE_LAYOUT_WRITE_SCOPE, THEME_WRITE_SCOPE,
} from '../utils/scope-coverage.js';
import { logger } from '../utils/logger.js';
import { POWERFUL_AGENT_SCOPES } from '../config-posture.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { createT, type Locale } from '../i18n.js';

/**
 * The words only an operator's own agent can use: each guards a route behind requireOperatorPrincipal
 * (auth/operator-gate.ts), which asks first whether the ACCOUNT runs the node. On any other account
 * ticking one gives nothing, so a person who does not run the node is never told about one.
 */
export const OPERATOR_WORDS: readonly string[] = [
  OPERATOR_ADMIN_SCOPE, OPERATOR_ORGANISM_REPAIR_SCOPE, COMPLIANCE_READ_SCOPE, COMPLIANCE_WRITE_SCOPE,
  SURFACE_LAYOUT_WRITE_SCOPE, THEME_WRITE_SCOPE,
];

/** A permission the person may give with one press on the allow page. */
export function isOneClickWord(word: string): boolean {
  return word.length > 0 && word !== '*' && !word.endsWith(':*')
    && !isOutsideWildcard(word) && !POWERFUL_AGENT_SCOPES.includes(word);
}

/** True when every word in a non-empty list may be given with one press. */
export function oneClickWords(words: readonly string[]): boolean {
  return words.length > 0 && words.every(isOneClickWord);
}

const trimBase = (baseUrl: string) => baseUrl.replace(/\/+$/, '');

/** The page that asks the person to allow `words` for their agent `agentName`. */
export function allowUrl(baseUrl: string, agentName: string, words: readonly string[]): string {
  const q = new URLSearchParams({ agent: agentName, need: [...new Set(words)].join(',') });
  return `${trimBase(baseUrl)}/v1/allow?${q.toString()}`;
}

/** The agent's own card on the person's Agents page, where every permission has its tick. */
export function agentPageUrl(baseUrl: string, agentName: string): string {
  const q = new URLSearchParams({ tab: 'agents', agent: agentName });
  return `${trimBase(baseUrl)}/v1/profile?${q.toString()}`;
}

/**
 * What a permission lets the agent do, in plain words, from the same sentences the agent editor
 * shows (profile.agents.scopeUi.scopeText.<domain>.<action>). A word without a sentence answers
 * null, and the caller says something general rather than the word.
 */
export function plainPermission(word: string, locale: Locale = 'en'): string | null {
  const [domain, action] = word.split(':');
  if (!domain || !action) return null;
  const key = `profile.agents.scopeUi.scopeText.${domain}.${action}`;
  const text = createT(locale)(key);
  return text === key ? null : text;
}

/**
 * The permissions agent `gaii` holds on its record and `tokenScopes` does not cover: what was allowed
 * after the token was issued. Empty when nothing is, and when the record cannot be read, so a failed
 * read leaves the token working as it did.
 */
export async function scopesBehindRecord(storage: Storage, gaii: string, tokenScopes: readonly string[]): Promise<string[]> {
  const agent = await storage.getAgent(gaii).catch((err: unknown) => {
    logger.warn('permission-ask: the agent record could not be read; the token stays as it is', { gaii, error: String(err) });
    return null;
  });
  return agent ? uncoveredScopes(tokenScopes, agent.defaultScopes ?? []) : [];
}

/**
 * The sentence an AI reads when a call needs permissions it does not hold. English, because it is
 * read by the model, which then speaks to the person in their own language.
 */
export function permissionAskText(opts: {
  baseUrl: string; agentGaii: string; tool: string; words: readonly string[];
}): string {
  const agentName = parseGaiiLoose(opts.agentGaii).agent;
  const plain = opts.words.map((w) => plainPermission(w)).filter((s): s is string => !!s);
  const what = plain.length > 0
    ? plain.map((s) => s.replace(/\.$/, '')).join('; ')
    : 'this action';
  const head = `You may not do this yet for the person: ${what}. Nothing went wrong; they have not allowed it.`;
  if (!agentName) {
    return `${head} Tell them in their own language that you cannot do this yet, and that they can allow it on their Agents page.`;
  }
  if (oneClickWords(opts.words)) {
    return `${head} They allow it with one press. Tell them, in their own language and without naming any permission or tool, something like: `
      + `"I can't do that for you yet. Allow it here: ${allowUrl(opts.baseUrl, agentName, opts.words)}". `
      + `When they say they have allowed it, call ${opts.tool} again in this same conversation.`;
  }
  return `${head} This one they give on your page under Agents, with its own tick. Tell them, in their own language and without naming any permission or tool, something like: `
    + `"I can't do that for you yet. You can allow it here: ${agentPageUrl(opts.baseUrl, agentName)}". `
    + `When they say they have allowed it, call ${opts.tool} again.`;
}
