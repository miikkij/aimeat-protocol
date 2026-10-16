/**
 * @file src/services/outbound/campaign-email.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The layout a message leaves in when somebody sends it to their own customer.
 *
 *   WHY THIS IS NOT THE OTHER TEMPLATE. `email-templates.ts` renders what this NODE writes in its
 *   own name: a verification code, a magic link, an invitation. It uses a `<style>` block with
 *   classes, which is fine for a reader who is about to click a link and forget the page. A campaign
 *   is read in Outlook, where the renderer is Word: `<style>` may not survive, `border-radius` and
 *   `box-shadow` do not, and a `<div>` with `max-width` is not a column. Sharing one template meant
 *   either shipping a weak campaign or editing the mail that carries a sign-in link. So: two.
 *
 *   THE FOUR RULES THIS FILE EXISTS TO KEEP, each learned from a client rather than chosen:
 *
 *   1. TABLES AND INLINE STYLES. Every rule that must survive is on the element that needs it. The
 *      `<style>` block is additive only, for the two things it can express and inline cannot.
 *   2. THE BUTTON'S COLOUR IS ON THE CELL. A styled `<a>` degrades to a blue underlined link exactly
 *      where it matters most. `bgcolor` on a `<td>` is the one thing every client has always drawn.
 *   3. A SOLID COLOUR UNDER EVERY GRADIENT. `bgcolor` first, `background-image` second: a client
 *      that ignores the gradient gets the flat colour, not white behind light text.
 *   4. NOTHING DEPENDS ON AN IMAGE. Most clients block images until the reader allows them, so a
 *      look that needs a picture arrives broken for the majority. The lead image is optional, always
 *      carries the alt text a blocked image shows instead, and the layout is the same without it. The
 *      tracking pixel is 1×1 and hidden, so blocking it costs a count and nothing else.
 *
 *   THE BODY is the closed vocabulary of campaign-markup.ts (headings, bullets, bold, https links, a
 *   rule), built into tags by the server from escaped text. THE FOOTER under the card is the sender's
 *   identity from sender-identity.ts, when the owner keeps one: who sends, why the reader gets it,
 *   the privacy notice and the unsubscribe link. Without that record the message is what it was
 *   before: one unsubscribe line inside the card on marketing, nothing on transactional.
 * @structure renderCampaignEmail — html + text · listUnsubscribeHeaders — RFC 2369 / 8058 headers
 * @usage const { html, text } = renderCampaignEmail({ subject, body, links, unsubscribeUrl, theme, sender, image, locale })
 * @version-history
 *   v1.1.0 — 2026-10-16 — The body takes the campaign-markup vocabulary, a lead image fills the top of
 *     the card, the sender footer goes under the card in fi, en or es, and listUnsubscribeHeaders gives
 *     the two List-Unsubscribe headers a marketing send carries. The card is a two-row table so the
 *     image can reach its edges.
 *   v1.0.1 — 2026-10-05 — HTML is escaped with escapeHtml (utils/html-escape.ts), which escapes all five characters (secaudit 2026-10, C8).
 *   v1.0.0 — 2026-08-27 — Initial.
 */
import { fontStack, type ThemeTokens } from './email-theme.js';
import { usableLinks, type OutboundLink } from './email-body.js';
import { parseCampaignBody, renderBlocksHtml, renderBlocksText, safeHttpsUrl } from './campaign-markup.js';
import type { FooterLocale, SenderIdentity } from './sender-identity.js';
import { escapeHtml } from '../../utils/html-escape.js';

export interface CampaignEmailInput {
  subject: string;
  /** What the person wrote: plain text in the campaign-markup.ts vocabulary. Escaped here. */
  body: string;
  links?: OutboundLink[];
  unsubscribeUrl: string;
  /** Marketing carries the unsubscribe line; transactional does not. */
  kind: 'transactional' | 'marketing' | 'invoice';
  /** The sending business's name, above the card. */
  brand?: string;
  /** Already built and authorised, or nothing. */
  trackingUrl?: string | null;
  theme: ThemeTokens;
  locale?: string;
  /** One picture across the top of the card. Left out unless the address is https and alt text is given. */
  image?: { url: string; alt: string };
  /** The validated sender identity (sender-identity.ts), or nothing for no footer. */
  sender?: SenderIdentity | null;
}

const esc = escapeHtml;

const UNSUB: Record<FooterLocale, string> = {
  fi: 'Et halua näitä viestejä?',
  es: '¿No quieres estos mensajes?',
  en: 'Don’t want these messages?',
};
const UNSUB_LINK: Record<FooterLocale, string> = { fi: 'Peru tilaus', es: 'Darse de baja', en: 'Unsubscribe' };
/** The words language-context.md settles on for these two, in all three languages. */
const BUSINESS_ID: Record<FooterLocale, string> = { fi: 'Y-tunnus', es: 'Identificación fiscal', en: 'Business ID' };
const PRIVACY: Record<FooterLocale, string> = { fi: 'Tietosuojaseloste', es: 'Aviso de privacidad', en: 'Privacy notice' };

/** The card's inner width: 580 less its two one-pixel borders. The lead image is drawn at this size. */
const CARD_INNER = 578;

/** A spacer that survives Outlook, which collapses an empty div and ignores margin on many things. */
function gap(px: number): string {
  return `<div style="height:${px}px;line-height:${px}px;font-size:0;">&nbsp;</div>`;
}

/**
 * The two headers a marketing message carries so the reader's mail client can offer its own
 * unsubscribe button: RFC 2369 List-Unsubscribe with the https link, and RFC 8058
 * List-Unsubscribe-Post, which says one POST to that link unsubscribes without a page. Gmail and
 * Yahoo require both of bulk senders since 2024. There is no mailto: form, because this node has no
 * address that reads unsubscribe mail.
 */
export function listUnsubscribeHeaders(unsubscribeUrl: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/** The reason line in the send's language, else English, else Finnish, else whatever there is. */
function reasonFor(sender: SenderIdentity, lang: FooterLocale): string | undefined {
  return sender.reason[lang] ?? sender.reason.en ?? sender.reason.fi ?? sender.reason.es;
}

/** Name and business id on one line, as the footer and the text part both print them. */
function identityLine(sender: SenderIdentity, lang: FooterLocale, sep: string): string {
  return sender.businessId ? `${sender.legalName}${sep}${BUSINESS_ID[lang]} ${sender.businessId}` : sender.legalName;
}

export function renderCampaignEmail(input: CampaignEmailInput): { html: string; text: string } {
  const th = input.theme;
  const font = fontStack(th.font);
  const lang: FooterLocale = input.locale === 'es' ? 'es' : input.locale === 'en' ? 'en' : 'fi';
  const links = usableLinks(input.links);
  const marketing = input.kind === 'marketing';
  // The footer: always on marketing when the owner keeps a sender record, on other kinds only when
  // the record asks for it. On those it carries the identity and the privacy notice, never the reason
  // or the unsubscribe link, which are about a subscription the reader of a receipt does not have.
  const sender = input.sender && (marketing || input.sender.transactional) ? input.sender : null;
  const imageUrl = input.image ? safeHttpsUrl(input.image.url) : null;
  const imageAlt = input.image?.alt?.trim().slice(0, 200) ?? '';

  const blocks = parseCampaignBody(input.body);
  const bodyHtml = renderBlocksHtml(blocks, th);

  // Rule 2. The colour lives on the td, and the anchor fills it.
  const buttonsHtml = links.map(l => `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px;">
          <tr><td align="center" bgcolor="${th.accent}" style="border-radius:${th.radius}px;">
            <a href="${esc(l.url.trim())}" style="display:inline-block;padding:13px 26px;font-family:${font};font-size:15px;font-weight:600;color:${th.accentText};text-decoration:none;border-radius:${th.radius}px;">${esc((l.label || l.url).trim().slice(0, 120))}</a>
          </td></tr>
        </table>`).join('');

  // The in-card unsubscribe line is what a marketing message without a sender record has always had.
  // With a record, the footer carries the link instead, once.
  const unsubHtml = marketing && !sender ? `
        ${gap(14)}
        <div style="border-top:1px solid ${th.border};padding-top:14px;">
          <p style="margin:0;font-family:${font};font-size:12px;line-height:1.5;color:${th.muted};">
            ${UNSUB[lang]} <a href="${esc(input.unsubscribeUrl)}" style="color:${th.muted};">${UNSUB_LINK[lang]}</a>
          </p>
        </div>` : '';

  const brandHtml = input.brand ? `
      <tr><td align="center" style="padding:6px 0 22px;">
        <span style="font-family:${font};font-size:13px;letter-spacing:3px;text-transform:uppercase;color:${th.muted};">${esc(input.brand)}</span>
      </td></tr>` : '';

  const imageHtml = imageUrl && imageAlt ? `
          <tr><td style="padding:0;font-size:0;line-height:0;">
            <img src="${esc(imageUrl)}" alt="${esc(imageAlt)}" width="${CARD_INNER}" style="display:block;width:100%;max-width:${CARD_INNER}px;height:auto;border:0;outline:none;border-radius:${th.radius}px ${th.radius}px 0 0;font-size:14px;line-height:1.4;color:${th.muted};" />
          </td></tr>` : '';

  const pixel = input.trackingUrl
    ? `<img src="${esc(input.trackingUrl)}" alt="" width="1" height="1" style="display:none" />`
    : '';

  const footerHtml = sender ? footerRows(sender, lang, marketing, input.unsubscribeUrl, th, font) : '';

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(input.subject)}</title>
<style>
  /* Additive only: the two things inline styles cannot say. Everything the layout needs is inline. */
  @media (max-width:620px) { .wrap { width:100% !important; } .pad { padding:24px 20px !important; } }
  a { text-decoration:none; }
</style>
</head>
<body style="margin:0;padding:0;background-color:${th.page};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${th.page}" style="background-color:${th.page};background-image:linear-gradient(160deg,${th.page} 0%,${th.pageTo} 55%,${th.page} 100%);">
  <tr><td align="center" style="padding:28px 12px 40px;">
    <table role="presentation" class="wrap" width="580" cellpadding="0" cellspacing="0" border="0" style="width:580px;max-width:100%;">
${brandHtml}
      <tr><td bgcolor="${th.card}" style="background-color:${th.card};border:1px solid ${th.border};border-radius:${th.radius}px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${imageHtml}
          <tr><td class="pad" style="padding:34px 32px 28px;">
        <h1 style="margin:0 0 20px;font-family:${font};font-size:23px;line-height:1.3;font-weight:700;color:${th.heading};">${esc(input.subject)}</h1>
        ${bodyHtml}
        ${links.length ? gap(10) + buttonsHtml : ''}
        ${unsubHtml}
        ${pixel}
          </td></tr>
        </table>
      </td></tr>
      <!-- card end -->${footerHtml}
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const textParts = [renderBlocksText(blocks)];
  if (links.length) textParts.push(links.map(l => `${(l.label || l.url).trim()}: ${l.url.trim()}`).join('\n'));
  if (sender) textParts.push(footerText(sender, lang, marketing, input.unsubscribeUrl));
  else if (marketing) textParts.push(`--\n${UNSUB_LINK[lang]}: ${input.unsubscribeUrl}`);

  return { html, text: textParts.join('\n\n') };
}

/** The footer under the card, in the theme's muted colour: reason, actions, then who sends. */
function footerRows(
  sender: SenderIdentity, lang: FooterLocale, marketing: boolean, unsubscribeUrl: string, th: ThemeTokens, font: string,
): string {
  const p = (inner: string, last = false): string =>
    `<p style="margin:0 0 ${last ? 0 : 8}px;font-family:${font};font-size:12px;line-height:1.6;color:${th.muted};">${inner}</p>`;
  const link = (href: string, label: string): string =>
    `<a href="${esc(href)}" style="color:${th.muted};text-decoration:underline;">${esc(label)}</a>`;
  const reason = marketing ? reasonFor(sender, lang) : undefined;
  const actions = [
    ...(marketing ? [link(unsubscribeUrl, UNSUB_LINK[lang])] : []),
    ...(sender.privacyUrl ? [link(sender.privacyUrl, PRIVACY[lang])] : []),
  ];
  const rows = [
    ...(reason ? [p(esc(reason))] : []),
    ...(actions.length ? [p((marketing ? `${UNSUB[lang]} ` : '') + actions.join(' &nbsp;·&nbsp; '))] : []),
    p(esc(identityLine(sender, lang, ' · ')) + (sender.address ? `<br>${esc(sender.address)}` : ''), true),
  ];
  return `
      <tr><td align="center" style="padding:22px 28px 0;">
        ${rows.join('\n        ')}
      </td></tr>`;
}

/** The same footer for the text part. Every address is spelled out. */
function footerText(sender: SenderIdentity, lang: FooterLocale, marketing: boolean, unsubscribeUrl: string): string {
  const reason = marketing ? reasonFor(sender, lang) : undefined;
  return [
    '--',
    ...(reason ? [reason] : []),
    ...(marketing ? [`${UNSUB_LINK[lang]}: ${unsubscribeUrl}`] : []),
    ...(sender.privacyUrl ? [`${PRIVACY[lang]}: ${sender.privacyUrl}`] : []),
    identityLine(sender, lang, ', '),
    ...(sender.address ? [sender.address] : []),
  ].join('\n');
}
