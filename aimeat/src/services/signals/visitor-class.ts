/**
 * @file src/services/signals/visitor-class.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reads a User-Agent and answers three questions a signal report is built on: was this
 *   a person, a machine, or an AI — and if an AI, WHICH one and why it came.
 *
 *   THE AI SPLIT IS THE POINT. Folding assistants into "bot" would throw away the half a customer
 *   is actually buying: `ChatGPT-User` and `Claude-User` fetch a page because a PERSON asked
 *   something about that business a second ago, while `GPTBot` and `CCBot` fetch it to build a
 *   model or an index. The first is a lead, the second is shelf presence, and a report that added
 *   them together would answer neither question.
 *
 *   EMAIL SCANNERS ARE WHY AN OPEN IS AN ESTIMATE. Gmail proxies every image through
 *   GoogleImageProxy, and corporate mail gateways (Proofpoint, Mimecast, Barracuda) fetch links and
 *   images before the recipient ever sees the message. Naming them keeps their fetches out of "a
 *   person opened this". What CANNOT be named is Apple Mail Privacy Protection: it fetches through
 *   a relay with an ordinary Safari signature and is undetectable here by design. So open counts
 *   are reported as an estimate and click counts as fact, and no amount of table-writing changes
 *   that — which is why the report says it in words rather than implying it with a footnote.
 *
 *   The table is a guess about a string a client controls. Nothing here is a security decision, no
 *   access is granted or refused by it, and a forged User-Agent buys a visitor exactly one thing:
 *   a wrong row in their own reader's report.
 *
 * @structure AI_AGENTS · SCANNERS · GENERIC_BOTS · classifyVisitor
 * @usage const v = classifyVisitor(req.get('user-agent'));  // { klass, aiAgent, aiKind }
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial, for the signals collector.
 */
import type { VisitorClass, AiFetchKind } from '../../models/signal-schemas.js';

export interface VisitorVerdict {
  klass: VisitorClass;
  /** Stable short name of the AI that came (`chatgpt`, `claude`, `perplexity`), null otherwise.
   *  Short and lower-case because it is a map key in every month record ever written. */
  aiAgent: string | null;
  aiKind: AiFetchKind | null;
  /** Why this verdict, for the debugging that follows the first "these numbers look wrong". */
  matched: string | null;
}

interface AgentRule {
  /** Matched case-insensitively against the raw User-Agent. */
  token: string;
  name: string;
  kind: AiFetchKind;
}

/**
 * Known AI fetchers, most specific first — `Claude-User` must win before `ClaudeBot` and before any
 * generic `bot` fallback, so ordering here is behaviour, not tidiness.
 *
 * `assistant` = a person asked something and the model went to look.
 * `crawler`   = training corpus or answer index being built, no person waiting.
 */
const AI_AGENTS: AgentRule[] = [
  // OpenAI
  { token: 'ChatGPT-User', name: 'chatgpt', kind: 'assistant' },
  { token: 'OAI-SearchBot', name: 'chatgpt', kind: 'crawler' },
  { token: 'GPTBot', name: 'chatgpt', kind: 'crawler' },
  // Anthropic
  { token: 'Claude-User', name: 'claude', kind: 'assistant' },
  { token: 'Claude-SearchBot', name: 'claude', kind: 'crawler' },
  { token: 'ClaudeBot', name: 'claude', kind: 'crawler' },
  { token: 'anthropic-ai', name: 'claude', kind: 'crawler' },
  // Perplexity
  { token: 'Perplexity-User', name: 'perplexity', kind: 'assistant' },
  { token: 'PerplexityBot', name: 'perplexity', kind: 'crawler' },
  // Google (Gemini / Vertex). Googlebot itself is a search crawler and stays out of this table.
  { token: 'Google-CloudVertexBot', name: 'gemini', kind: 'crawler' },
  { token: 'Google-Extended', name: 'gemini', kind: 'crawler' },
  { token: 'GoogleOther', name: 'gemini', kind: 'crawler' },
  // Microsoft Copilot rides bingbot for indexing; only the assistant fetch is distinguishable.
  { token: 'BingPreview', name: 'copilot', kind: 'assistant' },
  // Meta
  { token: 'meta-externalfetcher', name: 'meta-ai', kind: 'assistant' },
  { token: 'meta-externalagent', name: 'meta-ai', kind: 'crawler' },
  // Apple
  { token: 'Applebot-Extended', name: 'apple-ai', kind: 'crawler' },
  // The rest of the field
  { token: 'MistralAI-User', name: 'mistral', kind: 'assistant' },
  { token: 'DuckAssistBot', name: 'duckassist', kind: 'assistant' },
  { token: 'YouBot', name: 'you', kind: 'crawler' },
  { token: 'cohere-training-data-crawler', name: 'cohere', kind: 'crawler' },
  { token: 'cohere-ai', name: 'cohere', kind: 'crawler' },
  { token: 'Amazonbot', name: 'amazon', kind: 'crawler' },
  { token: 'Bytespider', name: 'bytedance', kind: 'crawler' },
  { token: 'AI2Bot', name: 'ai2', kind: 'crawler' },
  { token: 'CCBot', name: 'commoncrawl', kind: 'crawler' },
  { token: 'Diffbot', name: 'diffbot', kind: 'crawler' },
  { token: 'FirecrawlAgent', name: 'firecrawl', kind: 'crawler' },
  { token: 'TimpiBot', name: 'timpi', kind: 'crawler' },
];

/**
 * Mail proxies and security gateways. They fetch images and follow links on the recipient's behalf,
 * so every one of these that lands in "a person opened this" is a lie the customer would repeat.
 */
const SCANNERS = [
  'GoogleImageProxy', 'YahooMailProxy', 'Microsoft Office', 'Outlook-iOS', 'Outlook-Android',
  'proofpoint', 'mimecast', 'barracuda', 'symantec', 'forcepoint', 'trendmicro', 'sophos',
  'safelinks', 'urldefense',
];

/** Search engines, SEO tools, monitors and plain HTTP clients. Machines, but nobody's audience. */
const GENERIC_BOTS = [
  'googlebot', 'bingbot', 'slurp', 'duckduckbot', 'yandexbot', 'baiduspider', 'petalbot',
  'ahrefsbot', 'semrushbot', 'mj12bot', 'dotbot', 'screaming frog', 'linkedinbot', 'twitterbot',
  'facebookexternalhit', 'whatsapp', 'telegrambot', 'discordbot', 'slackbot', 'embedly',
  'uptimerobot', 'pingdom', 'statuscake', 'site24x7', 'newrelicpinger', 'datadog',
  'curl/', 'wget/', 'python-requests', 'python-urllib', 'go-http-client', 'java/', 'okhttp',
  'axios/', 'node-fetch', 'got (', 'libwww-perl', 'httpclient', 'headlesschrome', 'phantomjs',
  'playwright', 'puppeteer', 'scrapy', 'apache-httpclient',
];

/** Last-resort words. Anything self-describing as a robot is taken at its word. */
const BOT_WORDS = ['bot', 'crawler', 'spider', 'scraper', 'monitor', 'fetcher'];

/**
 * Classify one request's User-Agent.
 *
 * An absent or empty agent counts as `bot`: every real browser sends one, and a fetch that does not
 * is a script. Erring that way keeps a made-up number out of the human column, which is the column
 * a customer makes decisions with.
 */
export function classifyVisitor(userAgent: string | undefined | null): VisitorVerdict {
  const ua = (userAgent ?? '').trim();
  if (!ua) return { klass: 'bot', aiAgent: null, aiKind: null, matched: 'no-user-agent' };
  const lower = ua.toLowerCase();

  for (const rule of AI_AGENTS) {
    if (lower.includes(rule.token.toLowerCase())) {
      return { klass: 'ai', aiAgent: rule.name, aiKind: rule.kind, matched: rule.token };
    }
  }
  for (const token of SCANNERS) {
    if (lower.includes(token.toLowerCase())) {
      return { klass: 'bot', aiAgent: null, aiKind: null, matched: token };
    }
  }
  for (const token of GENERIC_BOTS) {
    if (lower.includes(token)) {
      return { klass: 'bot', aiAgent: null, aiKind: null, matched: token };
    }
  }
  for (const word of BOT_WORDS) {
    if (lower.includes(word)) {
      return { klass: 'bot', aiAgent: null, aiKind: null, matched: word };
    }
  }
  return { klass: 'human', aiAgent: null, aiKind: null, matched: null };
}
