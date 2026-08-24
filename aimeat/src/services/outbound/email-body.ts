/**
 * @file src/services/outbound/email-body.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Builds the HTML and plain-text halves of an outbound message from DATA: the text a
 *   person wrote, the buttons they named, the unsubscribe line the law requires and the open
 *   counter they asked for.
 *
 *   WHY THE CALLER NEVER SENDS MARKUP. Everything an app supplies is escaped on the way in, so no
 *   caller can put an anchor, an image or a script into a message this node sends in its owner's
 *   name. That default is right and it also made a link impossible, which is most of what a
 *   campaign is. Naming the label and the address separately keeps both: the caller says what it
 *   wants, the server decides what the markup is.
 *
 *   The scheme check is the sharp edge. `javascript:` and `data:` addresses are dropped rather than
 *   escaped, because an escaped one is still a working link in some mail clients, and a message
 *   somebody's customer opens is the last place to be clever about it.
 *
 *   BOTH HALVES CARRY THE SAME OFFER. The plain-text part spells out every address in full: a
 *   reader whose client shows no HTML must still be able to reach what the message offered them,
 *   and a mail with a text part that says less is also a mail more filters treat as bulk.
 *
 * @structure buildOutboundBody
 * @usage const { htmlBody, textBody } = buildOutboundBody({ body, kind, unsubscribeUrl, links });
 * @version-history
 *   v1.0.0 — 2026-08-24 — Pure extraction out of sendOutbound, plus links and the open counter.
 */

/** A button, as the caller names it. */
export interface OutboundLink {
  label: string;
  url: string;
}

export interface BodyInput {
  /** What the person wrote. Plain text; blank lines become paragraphs. */
  body: string;
  kind: 'transactional' | 'marketing' | 'invoice';
  unsubscribeUrl: string;
  links?: OutboundLink[];
  /** The already-built, already-authorized tracking image URL, or nothing. */
  trackingUrl?: string | null;
}

/** At most this many buttons; past it a message is a page and belongs behind a link. */
const MAX_LINKS = 10;
const MAX_LABEL = 120;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Only http(s) survives. Anything else is dropped whole rather than escaped — see the header. */
export function usableLinks(links: OutboundLink[] | undefined): OutboundLink[] {
  return (links ?? [])
    .filter((l) => typeof l?.url === 'string' && /^https?:\/\//i.test(l.url.trim()))
    .slice(0, MAX_LINKS);
}

export function buildOutboundBody(input: BodyInput): { htmlBody: string; textBody: string } {
  const links = usableLinks(input.links);

  const paragraphs = input.body
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replaceAll('\n', '<br>')}</p>`)
    .join('');

  const linksHtml = links
    .map((l) => `<p><a href="${escapeHtml(l.url.trim())}" style="color:#2563eb">${escapeHtml((l.label || l.url).trim().slice(0, MAX_LABEL))}</a></p>`)
    .join('');

  const optOutHtml = input.kind === 'marketing'
    ? `<p style="font-size:12px;color:#888">Et halua näitä viestejä? <a href="${escapeHtml(input.unsubscribeUrl)}">Peru tilaus</a> / Unsubscribe</p>`
    : '';

  // alt="" and hidden: somebody who never asked to be counted should at least not be shown a
  // broken image about it.
  const trackingHtml = input.trackingUrl
    ? `<img src="${escapeHtml(input.trackingUrl)}" alt="" width="1" height="1" style="display:none" />`
    : '';

  const linksText = links.length
    ? `\n\n${links.map((l) => `${(l.label || l.url).trim()}: ${l.url.trim()}`).join('\n')}`
    : '';
  const optOutText = input.kind === 'marketing'
    ? `\n\n--\nPeru tilaus / Unsubscribe: ${input.unsubscribeUrl}`
    : '';

  return {
    htmlBody: paragraphs + linksHtml + optOutHtml + trackingHtml,
    textBody: `${input.body}${linksText}${optOutText}`,
  };
}
