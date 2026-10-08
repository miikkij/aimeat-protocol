/**
 * @file src/services/visibility/channel.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reads where a person came from: the channel of one page load, from its Referer and
 *   its `utm_source`, and, when the channel is an AI, which AI.
 *
 *   ONLY THE ANSWER IS KEPT. The caller hands in the raw Referer and the raw `utm_source`, this file
 *   returns a channel from a closed list and an AI family from a closed table, and neither input is
 *   stored anywhere. A Referer can carry a search phrase or a private URL, so the class is the most
 *   that may leave this function.
 *
 *   `utm_source` WINS OVER THE REFERER. ChatGPT, Perplexity and Copilot add `utm_source` to the
 *   links in their answers, and a browser often sends no Referer for them at all (a link opened from
 *   an app, a `noreferrer` policy). The parameter is the one signal that survives that.
 *
 *   A host on the place's own address is an INTERNAL navigation, not a referral: a person moving
 *   from one of the owner's apps to another did not arrive from anywhere.
 *
 *   The tables are a guess about strings a client controls. Nothing here grants or refuses access;
 *   a forged Referer buys a visitor one wrong row in the owner's report.
 * @structure aiFamilyOfHost · classifyChannel (the closed lists are in models/visibility-schemas.ts)
 * @usage const { channel, family } = classifyChannel({ referer, utmSource, selfHosts: [host] });
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial, for AI visibility (layer A).
 */

import type { VisitChannel, AiFamily } from '../../models/visibility-schemas.js';

interface HostRule { suffix: string; family: AiFamily }

/** AI answer hosts, matched on the host's suffix. The more specific entry comes first. */
const AI_HOSTS: HostRule[] = [
  { suffix: 'chatgpt.com', family: 'chatgpt' },
  { suffix: 'chat.openai.com', family: 'chatgpt' },
  { suffix: 'openai.com', family: 'chatgpt' },
  { suffix: 'claude.ai', family: 'claude' },
  { suffix: 'perplexity.ai', family: 'perplexity' },
  { suffix: 'copilot.microsoft.com', family: 'copilot' },
  { suffix: 'copilot.cloud.microsoft', family: 'copilot' },
  { suffix: 'copilot.com', family: 'copilot' },
  { suffix: 'gemini.google.com', family: 'gemini' },
  { suffix: 'bard.google.com', family: 'gemini' },
  { suffix: 'aistudio.google.com', family: 'gemini' },
  { suffix: 'notebooklm.google.com', family: 'gemini' },
  { suffix: 'meta.ai', family: 'meta-ai' },
  { suffix: 'chat.mistral.ai', family: 'mistral' },
  { suffix: 'grok.com', family: 'grok' },
  { suffix: 'chat.deepseek.com', family: 'deepseek' },
  { suffix: 'deepseek.com', family: 'deepseek' },
  { suffix: 'you.com', family: 'you' },
  { suffix: 'poe.com', family: 'poe' },
  { suffix: 'phind.com', family: 'phind' },
];

/**
 * `utm_source` values the AI products put on their links, lower-cased. A value that is an AI host
 * (`chatgpt.com`) is caught by the host table as well, so this holds the bare names.
 */
const AI_UTM: Record<string, AiFamily> = {
  chatgpt: 'chatgpt', openai: 'chatgpt', claude: 'claude', anthropic: 'claude',
  perplexity: 'perplexity', copilot: 'copilot', 'bing-copilot': 'copilot', gemini: 'gemini',
  'meta-ai': 'meta-ai', mistral: 'mistral', 'le-chat': 'mistral', grok: 'grok', deepseek: 'deepseek',
  you: 'you', poe: 'poe', phind: 'phind', duckassist: 'duckassist',
};

/**
 * Search engines. Matched on a label of the host rather than a suffix because Google alone has
 * two hundred country domains. Checked AFTER the AI table, so gemini.google.com stays an AI.
 */
const SEARCH_LABELS = ['google', 'bing', 'duckduckgo', 'yahoo', 'yandex', 'baidu', 'ecosia', 'startpage', 'qwant', 'naver', 'seznam', 'kagi'];
const SEARCH_HOSTS = ['search.brave.com', 'search.yahoo.com'];

/** Social networks and messengers, by host suffix. */
const SOCIAL_HOSTS = [
  'facebook.com', 'fb.com', 'instagram.com', 'threads.net', 'threads.com', 'x.com', 't.co', 'twitter.com',
  'linkedin.com', 'lnkd.in', 'reddit.com', 'youtube.com', 'youtu.be', 'tiktok.com', 'pinterest.com',
  'bsky.app', 'mastodon.social', 'snapchat.com', 'whatsapp.com', 'telegram.org', 't.me', 'discord.com',
  'news.ycombinator.com', 'vk.com',
];
const SOCIAL_UTM = ['facebook', 'fb', 'instagram', 'ig', 'threads', 'twitter', 'x', 'linkedin', 'reddit', 'youtube', 'tiktok', 'pinterest', 'bluesky', 'mastodon', 'whatsapp', 'telegram', 'discord', 'newsletter-social'];
const SEARCH_UTM = ['google', 'bing', 'duckduckgo', 'yahoo', 'ecosia', 'brave'];

const hostMatches = (host: string, suffix: string): boolean => host === suffix || host.endsWith(`.${suffix}`);

/** The AI family an answer host belongs to, or null when the host is not an AI's. */
export function aiFamilyOfHost(host: string): AiFamily | null {
  const h = host.toLowerCase().replace(/\.$/, '');
  for (const rule of AI_HOSTS) if (hostMatches(h, rule.suffix)) return rule.family;
  return null;
}

/** The host of a Referer, or null when it is absent or not an http(s) URL. */
function refererHost(referer: string | null | undefined): string | null {
  if (!referer) return null;
  // An unparseable Referer is treated as no Referer: the visit still counts, as direct.
  const url = URL.parse(referer.slice(0, 2048));
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) return null;
  return url.hostname.toLowerCase();
}

export interface ChannelVerdict {
  channel: VisitChannel;
  /** Set when `channel` is `ai`. */
  family: AiFamily | null;
}

/**
 * Classify one page load.
 *
 * `selfHosts` are the hosts that belong to this place (the request's own host and the apex): a
 * Referer under one of them is internal. A host matches when it is equal to an entry or a
 * subdomain of it, so the apex covers every app origin under it.
 */
export function classifyChannel(args: {
  referer?: string | null;
  utmSource?: string | null;
  selfHosts?: Array<string | null | undefined>;
}): ChannelVerdict {
  const utm = (args.utmSource ?? '').trim().toLowerCase().slice(0, 100);
  if (utm) {
    const named = Object.hasOwn(AI_UTM, utm) ? AI_UTM[utm] : undefined;
    const viaHost = aiFamilyOfHost(utm.replace(/^https?:\/\//, '').split('/')[0] ?? '');
    const family = named ?? viaHost;
    if (family) return { channel: 'ai', family };
    if (SEARCH_UTM.includes(utm)) return { channel: 'search', family: null };
    if (SOCIAL_UTM.includes(utm)) return { channel: 'social', family: null };
  }

  const host = refererHost(args.referer);
  if (!host) return { channel: utm ? 'referral' : 'direct', family: null };

  for (const self of args.selfHosts ?? []) {
    const s = (self ?? '').toLowerCase().split(':')[0];
    if (s && hostMatches(host, s)) return { channel: 'internal', family: null };
  }
  const family = aiFamilyOfHost(host);
  if (family) return { channel: 'ai', family };
  if (SEARCH_HOSTS.some((s) => hostMatches(host, s))) return { channel: 'search', family: null };
  const labels = host.split('.');
  if (labels.some((l) => SEARCH_LABELS.includes(l)) && !SOCIAL_HOSTS.some((s) => hostMatches(host, s))) {
    return { channel: 'search', family: null };
  }
  if (SOCIAL_HOSTS.some((s) => hostMatches(host, s))) return { channel: 'social', family: null };
  return { channel: 'referral', family: null };
}
