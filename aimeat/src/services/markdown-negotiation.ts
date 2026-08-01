/**
 * @file markdown-negotiation.ts
 * @description "Markdown for Agents" content negotiation (Cloudflare convention,
 *   developers.cloudflare.com/fundamentals/reference/markdown-for-agents/): when a client's
 *   Accept header prefers text/markdown over text/html, the public human-facing info pages
 *   (root landing, /v1/portal, privacy/terms/connect) serve a markdown rendering instead of
 *   HTML — Content-Type text/markdown; charset=utf-8, Vary: Accept, and x-markdown-tokens /
 *   x-original-tokens headers carrying cheap token estimates (~4 chars/token). Browsers keep
 *   getting HTML; API JSON and authenticated SPA app routes are never negotiated.
 * @structure
 *   - prefersMarkdown(req)      — Accept-header check (q-value aware via req.accepts)
 *   - prefersHtmlPage(req)      — the browser-vs-machine check, for a JSON route with a human page
 *   - sendMarkdown(res, md, originalHtml?) — headers + body for a negotiated response
 *   - htmlToMarkdown(html)      — dependency-free converter for the simple static info pages
 *   - buildLandingMarkdown(config) — the markdown landing page for / and /v1/portal (the SPA
 *     shell has no readable content to convert, so the landing is authored, not converted)
 *   - estimateTokens(text)      — ceil(chars / 4)
 * @usage
 *   import { prefersMarkdown, sendMarkdown, htmlToMarkdown } from '../services/markdown-negotiation.js';
 *   if (prefersMarkdown(req)) { sendMarkdown(res, htmlToMarkdown(html), html); return; }
 * @version-history
 *   v1.1.0 — 2026-08-01 — prefersHtmlPage(): the same negotiation question asked the other way,
 *     so /v1/ai-transparency can send a person who pasted the machine URL into a browser to the
 *     page at /v1/transparency while every machine keeps getting JSON (TARGET-058 Phase 10b).
 *   v1.0.0 — 2026-07-14 — Initial: Markdown for Agents negotiation (agent readiness)
 */
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';

/**
 * True when the request prefers text/markdown over text/html. req.accepts() honors
 * q-values and ordering, so a browser's "text/html,…,*\/*" stays HTML while an agent's
 * "Accept: text/markdown" (or markdown ranked above html) negotiates. Plain "*\/*"
 * (curl default) and application/json callers are unaffected.
 */
export function prefersMarkdown(req: Request): boolean {
  return req.accepts(['text/html', 'text/markdown']) === 'text/markdown';
}

/**
 * True when the caller is a browser asking for a page rather than a client asking for data.
 *
 * The mirror image of prefersMarkdown(), and here for the same reason: negotiation predicates
 * belong in one place or a second, subtly different one gets written at the next call site.
 *
 * JSON IS THE DEFAULT, DELIBERATELY. `application/json` is listed FIRST, so a caller sending
 * `Accept: * / *` — curl, fetch(), most agents — gets JSON, and only a client that ranks
 * text/html ABOVE json (which is exactly what a browser's Accept header does) is treated as a
 * reader. A JSON endpoint linked from llms.txt, /.well-known/ and the bootstrap document must
 * never start answering HTML to the machines that follow those links.
 */
export function prefersHtmlPage(req: Request): boolean {
  return req.accepts(['application/json', 'text/html']) === 'text/html';
}

/** Cheap token estimate for the x-markdown-tokens / x-original-tokens headers (~4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Send a negotiated markdown response with the convention's headers. */
export function sendMarkdown(res: Response, markdown: string, originalHtml?: string): void {
  res.vary('Accept');
  res.set('x-markdown-tokens', String(estimateTokens(markdown)));
  if (originalHtml !== undefined) {
    res.set('x-original-tokens', String(estimateTokens(originalHtml)));
  }
  res.type('text/markdown; charset=utf-8').send(markdown);
}

/** Strip tags + collapse whitespace inside an inline fragment (heading/link/list text). */
function inlineText(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ', quot: '"', apos: "'", lt: '<', gt: '>',
  rarr: '→', larr: '←', mdash: '—', ndash: '–', hellip: '…',
  copy: '©', middot: '·', bull: '•', times: '×', deg: '°', trade: '™',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (m, hex: string) => {
      const cp = parseInt(hex, 16);
      return cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    })
    .replace(/&#(\d+);/g, (m, dec: string) => {
      const cp = Number(dec);
      return cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    })
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
    .replace(/&amp;/gi, '&');
}

/**
 * Dependency-free HTML→markdown for the node's simple static info pages (privacy, terms,
 * connect, operator portal templates). Handles the structures those pages actually use —
 * headings, paragraphs, lists, links, emphasis, code — and degrades to clean text for
 * anything else. Deliberately NOT a general-purpose converter (Rule 5: no new dependency
 * for pages we control).
 */
export function htmlToMarkdown(html: string): string {
  let s = html;
  // Non-content blocks disappear entirely.
  s = s.replace(/<(script|style|head|svg|noscript|template)\b[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  // Inline conversions first, while the surrounding tags still delimit them.
  s = s.replace(/<a\b[^>]*href=(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, d, sq, text) => {
      const href = (d ?? sq ?? '') as string;
      const label = inlineText(text as string);
      return label ? `[${label}](${href})` : '';
    });
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, text) => `**${inlineText(text as string)}**`);
  s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, text) => `*${inlineText(text as string)}*`);
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, text) => `\`${inlineText(text as string)}\``);
  // Block structure.
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_m, n, text) => `\n\n${'#'.repeat(Number(n))} ${inlineText(text as string)}\n\n`);
  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, text) => `\n- ${inlineText(text as string)}`);
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|section|article|main|header|footer|ul|ol|table|tr|blockquote|figure)>/gi, '\n\n');
  // Whatever tags remain are dropped; entities decoded last.
  s = decodeEntities(s.replace(/<[^>]+>/g, ' '));
  // Normalize whitespace: trim lines, cap blank runs at one.
  return s
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';
}

/**
 * The markdown landing page for GET / and GET /v1/portal. The HTML there is an SPA shell
 * (no readable content to convert), so the markdown variant is authored: what the node is
 * and the paved paths for humans and agents — same ground the portal landing covers.
 */
export function buildLandingMarkdown(config: AimeatConfig): string {
  const b = config.baseUrl;
  return `# AIMEAT node \`${config.nodeId}\`

An [AIMEAT protocol](${b}/llms.txt) node — persistent memory, identity, shared workspaces
(organisms), skills, tasks and workflows, app hosting, and a morsel economy for humans and
their AI agents, over REST and MCP.

## For humans

- Portal (register, log in, manage agents and data): ${b}/v1/portal
- Connect an AI assistant to this node: ${b}/v1/connect
- Privacy: ${b}/v1/privacy · Terms: ${b}/v1/terms

## For AI agents

- Machine-readable getting-started: \`GET ${b}/?format=json\`
- Full agent manual: \`GET ${b}/llms.txt\`
- Register (RFC 8628 device flow, owner-approved): \`GET ${b}/auth.md\`
- OpenAPI contract: \`GET ${b}/v1/spec\` · MCP server: \`POST ${b}/v1/mcp\`
- Public skills index: \`GET ${b}/.well-known/agent-skills/index.json\`
- Node descriptor: \`GET ${b}/.well-known/aimeat\`

This page negotiates content: \`Accept: text/markdown\` returns this document,
browsers receive the HTML portal.
`;
}
