/**
 * @file ContactCard.js
 * @description Shared "Talk to a human" contact card — used on /v1/business and
 *   /v1/pricing ONLY (one implementation, no copied text). tel: + mailto: links.
 * @usage import { ContactCard } from '/components/ContactCard.js';
 * @version-history
 *   v1.0.0 — 2026-06-10 — Initial (owner spec: human card).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

export function ContactCard() {
  return html`
    <div class="ld-contact">
      <div class="ld-contact-title">${tr('contact.title', 'Talk to a human.')}</div>
      <div class="ld-contact-name">Jouni Miikki, founder</div>
      <div class="ld-contact-links">
        <a href="tel:+358408231070">+358 40 8231070</a>
        <a href="mailto:jouni.miikki@aimeat.io">jouni.miikki@aimeat.io</a>
      </div>
      <div class="ld-contact-sub">${tr('contact.sub', 'I answer myself. A demo fits in the same call.')}</div>
    </div>
  `;
}
