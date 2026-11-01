/**
 * @file src/services/email-text-links.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Links in a plain-text mail body that a principal other than the node wrote (an
 *   extension's ctx.email, an automation report). The body stays text and is escaped as a whole
 *   (secaudit2026oct22); only two whole-line shapes become links in the HTML part:
 *     - `[Label](https://…)` alone on a line: a button, with the address's host under it so the
 *       reader sees where it goes. The plain-text part reads `Label: https://…`.
 *     - a bare `https://…` alone on a line: a link to itself.
 *   The address must be https, parse as a URL, and hold no space, quote, angle bracket or
 *   parenthesis; anything else stays text. Nothing here lets a sender do what it could not already
 *   do by putting the address in the body.
 * @structure linkedTextHtml(body) · linkedTextPlain(body)
 * @usage import { linkedTextHtml, linkedTextPlain } from './email-text-links.js';
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial: the store's ready mail showed its 200-character sign-in link as
 *     text (aimeat-commercial-1c, test lane).
 */
import { escapeHtml as esc } from '../utils/html-escape.js';

const ADDRESS = String.raw`https:\/\/[^\s"'<>()]+`;
const BUTTON_LINE = new RegExp(String.raw`^\[([^\]\r\n]{1,80})\]\((${ADDRESS})\)$`);
const BARE_LINE = new RegExp(`^${ADDRESS}$`);

function httpsUrl(raw: string): URL | null {
  if (!URL.canParse(raw)) return null;
  const url = new URL(raw);
  return url.protocol === 'https:' ? url : null;
}

/** The body as HTML: escaped text with line breaks kept, and the two link shapes drawn as links. */
export function linkedTextHtml(body: string): string {
  const out: string[] = [];
  let text: string[] = [];
  const flush = () => {
    if (text.length) out.push(`<p>${text.join('<br>')}</p>`);
    text = [];
  };
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    const button = BUTTON_LINE.exec(trimmed);
    const buttonUrl = button ? httpsUrl(button[2]) : null;
    if (button && buttonUrl) {
      flush();
      out.push(`<p style="text-align: center;"><a href="${esc(button[2])}" class="btn">${esc(button[1].trim())}</a><br>`
        + `<span style="font-size: 13px; color: #999;">${esc(buttonUrl.host)}</span></p>`);
      continue;
    }
    if (BARE_LINE.test(trimmed) && httpsUrl(trimmed)) {
      text.push(`<a href="${esc(trimmed)}" style="word-break: break-all;">${esc(trimmed)}</a>`);
      continue;
    }
    text.push(esc(line));
  }
  flush();
  return out.join('\n');
}

/** The body as plain text: a button line reads `Label: https://…`, everything else as written. */
export function linkedTextPlain(body: string): string {
  return body.split(/\r?\n/).map((line) => {
    const button = BUTTON_LINE.exec(line.trim());
    return button && httpsUrl(button[2]) ? `${button[1].trim()}: ${button[2]}` : line;
  }).join('\n');
}
