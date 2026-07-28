/**
 * @file ContactCard.js
 * @description Shared "Talk to a human" contact card — used on /v1/business and
 *   /v1/pricing ONLY (one implementation, no copied text). tel: + mailto: links.
 *   Name, email and phone come from this node's siteLinks config, so another
 *   operator's site never prints someone else's contact details. Renders nothing
 *   when the node has no contact email configured.
 * @usage import { ContactCard } from '/components/ContactCard.js';
 * @version-history
 *   v1.0.0 — 2026-06-10 — Initial (owner spec: human card).
 *   v2.0.0 — 2026-07-28 — Contact details from siteLinks instead of hardcoded. A clone of
 *     this repo used to publish Jouni's phone number on its own business page.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { siteLink } from '/js/site.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

export function ContactCard() {
  const name = siteLink('contactName');
  const email = siteLink('contactEmail');
  const phone = siteLink('contactPhone');

  // No email, no card. A "talk to a human" box with nobody behind it is worse than nothing.
  if (!email) return null;

  return html`
    <div class="ld-contact">
      <div class="ld-contact-title">${tr('contact.title', 'Talk to a human.')}</div>
      ${name ? html`<div class="ld-contact-name">${name}</div>` : ''}
      <div class="ld-contact-links">
        ${phone ? html`<a href=${`tel:${phone.replace(/\s+/g, '')}`}>${phone}</a>` : ''}
        <a href=${`mailto:${email}`}>${email}</a>
      </div>
      <div class="ld-contact-sub">${tr('contact.sub', 'I answer myself. A demo fits in the same call.')}</div>
    </div>
  `;
}
