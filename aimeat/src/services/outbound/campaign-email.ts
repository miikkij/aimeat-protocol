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
 *      look that needs a picture arrives broken for the majority. The tracking pixel is the only
 *      image here, and it is 1×1 and hidden, so blocking it costs a count and nothing else.
 * @structure renderCampaignEmail — html + text, from body paragraphs, links, unsubscribe and a theme
 * @usage const { html, text } = renderCampaignEmail({ subject, body, links, unsubscribeUrl, theme })
 * @version-history
 *   v1.0.0 — 2026-08-27 — Initial.
 */
import { fontStack, type ThemeTokens } from './email-theme.js';
import { usableLinks, type OutboundLink } from './email-body.js';

export interface CampaignEmailInput {
  subject: string;
  /** What the person wrote. Plain text; a blank line starts a paragraph. Escaped here. */
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
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const UNSUB: Record<string, string> = {
  fi: 'Et halua näitä viestejä?',
  es: '¿No quieres estos mensajes?',
  en: 'Don’t want these messages?',
};
const UNSUB_LINK: Record<string, string> = { fi: 'Peru tilaus', es: 'Darse de baja', en: 'Unsubscribe' };

/** A spacer that survives Outlook, which collapses an empty div and ignores margin on many things. */
function gap(px: number): string {
  return `<div style="height:${px}px;line-height:${px}px;font-size:0;">&nbsp;</div>`;
}

export function renderCampaignEmail(input: CampaignEmailInput): { html: string; text: string } {
  const th = input.theme;
  const font = fontStack(th.font);
  const lang = input.locale === 'es' ? 'es' : input.locale === 'en' ? 'en' : 'fi';
  const links = usableLinks(input.links);
  const marketing = input.kind === 'marketing';

  const paragraphs = input.body.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

  const bodyHtml = paragraphs
    .map(p => `<p style="margin:0 0 14px;font-family:${font};font-size:15px;line-height:1.65;color:${th.text};">`
      + esc(p).replaceAll('\n', '<br>') + '</p>')
    .join('');

  // Rule 2. The colour lives on the td, and the anchor fills it.
  const buttonsHtml = links.map(l => `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px;">
          <tr><td align="center" bgcolor="${th.accent}" style="border-radius:${th.radius}px;">
            <a href="${esc(l.url.trim())}" style="display:inline-block;padding:13px 26px;font-family:${font};font-size:15px;font-weight:600;color:${th.accentText};text-decoration:none;border-radius:${th.radius}px;">${esc((l.label || l.url).trim().slice(0, 120))}</a>
          </td></tr>
        </table>`).join('');

  const unsubHtml = marketing ? `
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

  const pixel = input.trackingUrl
    ? `<img src="${esc(input.trackingUrl)}" alt="" width="1" height="1" style="display:none" />`
    : '';

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
      <tr><td bgcolor="${th.card}" class="pad" style="background-color:${th.card};border:1px solid ${th.border};border-radius:${th.radius}px;padding:34px 32px 28px;">
        <h1 style="margin:0 0 20px;font-family:${font};font-size:23px;line-height:1.3;font-weight:700;color:${th.heading};">${esc(input.subject)}</h1>
        ${bodyHtml}
        ${links.length ? gap(10) + buttonsHtml : ''}
        ${unsubHtml}
        ${pixel}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const textParts = [paragraphs.join('\n\n')];
  if (links.length) textParts.push(links.map(l => `${(l.label || l.url).trim()}: ${l.url.trim()}`).join('\n'));
  if (marketing) textParts.push(`--\n${UNSUB_LINK[lang]}: ${input.unsubscribeUrl}`);

  return { html, text: textParts.join('\n\n') };
}
