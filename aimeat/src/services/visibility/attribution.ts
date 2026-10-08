/**
 * @file src/services/visibility/attribution.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where a purchase came from, decided when the checkout opens and carried on the
 *   checkout session, so the completed purchase can be counted under its channel without a cookie.
 *
 *   TWO WAYS A PURCHASE STARTS. A person on a page: the page's SDK sends the Referer the page was
 *   opened from and its `utm_source` with the checkout, and this file turns them into a channel.
 *   The raw values are not stored; the session carries the channel and the AI family only. An
 *   agent at a checkout endpoint (UCP, ACP, MCP): the agent is the AI, named from its UCP profile
 *   address or its User-Agent, and the channel is `ai`.
 *
 *   A buyer whose browser sends `Sec-GPC: 1` or `DNT: 1` gets no attribution at all, so the
 *   purchase counts in the totals and under no channel.
 * @structure pageAttribution · agentAttribution · ucpAgentFamily · agentFamilyOf
 * @usage const attribution = pageAttribution({ referrer, utmSource, selfHosts, optedOut });
 * @version-history
 *   v1.1.0 — 2026-10-08 — agentFamilyOf: an AIMEAT agent's family from its GAII, used when no
 *     header names the AI (layer C).
 *   v1.0.0 — 2026-10-08 — Initial, for AI visibility (layer A).
 */
import type { CheckoutAttribution } from '../../commerce/types.js';
import { classifyChannel, aiFamilyOfHost } from './channel.js';
import { classifyVisitor } from '../signals/visitor-class.js';
import { AI_FAMILIES } from '../../models/visibility-schemas.js';

/** A person's checkout on a page. Undefined when there is nothing to attribute or the buyer opted out. */
export function pageAttribution(args: {
  referrer?: string | null;
  utmSource?: string | null;
  selfHosts?: Array<string | null | undefined>;
  optedOut?: boolean;
}): CheckoutAttribution | undefined {
  if (args.optedOut) return undefined;
  const v = classifyChannel({ referer: args.referrer, utmSource: args.utmSource, selfHosts: args.selfHosts });
  return { channel: v.channel, family: v.family, via: 'page' };
}

/**
 * Hosts of agent platforms' UCP profiles, by AI family. The profile address is what a UCP platform
 * names itself with (the `UCP-Agent` header), so it is the most reliable name an agent gives.
 */
const PLATFORM_HOSTS: Array<{ suffix: string; family: (typeof AI_FAMILIES)[number] }> = [
  { suffix: 'microsoft.com', family: 'copilot' },
  { suffix: 'bing.com', family: 'copilot' },
  { suffix: 'copilot.com', family: 'copilot' },
  { suffix: 'openai.com', family: 'chatgpt' },
  { suffix: 'chatgpt.com', family: 'chatgpt' },
  { suffix: 'google.com', family: 'gemini' },
  { suffix: 'anthropic.com', family: 'claude' },
  { suffix: 'claude.ai', family: 'claude' },
  { suffix: 'perplexity.ai', family: 'perplexity' },
];

/**
 * The AI family named by a `UCP-Agent` header. The header is an RFC 8941 dictionary
 * (`profile="https://…"`); a bare URL is read as well, which is what this node accepted first.
 */
export function ucpAgentFamily(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /https?:\/\/[^\s",;]+/.exec(header.slice(0, 2048));
  const host = m ? URL.parse(m[0])?.hostname?.toLowerCase() : null;
  if (!host) return null;
  const known = aiFamilyOfHost(host);
  if (known) return known;
  for (const p of PLATFORM_HOSTS) if (host === p.suffix || host.endsWith(`.${p.suffix}`)) return p.family;
  return 'other';
}

/** An agent's checkout at a checkout endpoint. Always attributed: the buyer is an AI by definition. */
export function agentAttribution(args: {
  ucpAgent?: string | null; userAgent?: string | null; family?: string | null;
  /** The buying agent's GAII when it is an AIMEAT agent: its name says which AI it is, when nothing else does. */
  gaii?: string | null;
}): CheckoutAttribution {
  const fromProfile = ucpAgentFamily(args.ucpAgent);
  const fromUa = classifyVisitor(args.userAgent).aiAgent;
  const fromGaii = args.gaii ? agentFamilyOf(args.gaii) : null;
  const family = args.family
    ?? (fromProfile && fromProfile !== 'other' ? fromProfile : null)
    ?? fromUa
    ?? (fromGaii && fromGaii !== 'aimeat-agent' ? fromGaii : null)
    ?? fromProfile ?? fromGaii ?? 'other';
  return { channel: 'ai', family, via: 'agent' };
}

/** Words in an agent's own name that say which AI it is. Checked in order; the first match wins. */
const NAME_WORDS: Array<[RegExp, string]> = [
  [/copilot|bing|microsoft/, 'copilot'],
  [/claude|anthropic/, 'claude'],
  [/chatgpt|openai|gpt|codex/, 'chatgpt'],
  [/gemini|google|bard/, 'gemini'],
  [/perplexity/, 'perplexity'],
  [/mistral|le-chat/, 'mistral'],
  [/grok|xai/, 'grok'],
  [/deepseek/, 'deepseek'],
  [/llama|meta/, 'meta-ai'],
];

/**
 * The family of an AIMEAT agent from its GAII (`claude-code#alice@node` → `claude`). An agent whose
 * name says nothing is `aimeat-agent`: an AI acting for an account here, which is still worth
 * telling apart from a person. Only the family is kept, never the agent's name.
 */
export function agentFamilyOf(gaii: string | null | undefined): string {
  const name = (gaii ?? '').split('#')[0]!.toLowerCase();
  if (!name || !gaii?.includes('#')) return 'aimeat-agent';
  if ((AI_FAMILIES as readonly string[]).includes(name)) return name;
  for (const [re, family] of NAME_WORDS) if (re.test(name)) return family;
  return 'aimeat-agent';
}
