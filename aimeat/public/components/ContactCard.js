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
 *     this repo used to publish the founder's phone number on its own business page.
 *   v2.1.0 — 2026-07-28 — Renders a LIST of people with roles: a company has a person who
 *     answers commercial questions and a person who answers technical ones, and a single
 *     hardcoded card sent both to the same inbox.
 *   v2.2.0 — 2026-07-28 — Optional profile link (LinkedIn) per contact. A stranger deciding
 *     whether to email you generally wants to see who you are first.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { siteContacts } from '/js/site.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

export function ContactCard() {
  const contacts = siteContacts();

  // Nobody configured, no card. A "talk to a human" box with no human behind it is worse
  // than nothing at all.
  if (contacts.length === 0) return null;

  return html`
    <div class="ld-contact">
      <div class="ld-contact-title">${tr('contact.title', 'Talk to a human.')}</div>
      <div class="ld-contact-people">
        ${contacts.map(c => html`
          <div class="ld-contact-person" key=${c.email}>
            <div class="ld-contact-name">${c.name || c.email}</div>
            ${c.role ? html`<div class="ld-contact-role">${c.role}</div>` : ''}
            <div class="ld-contact-links">
              ${c.phone ? html`<a href=${`tel:${c.phone.replace(/[\s-]/g, '')}`}>${c.phone}</a>` : ''}
              <a href=${`mailto:${c.email}`}>${c.email}</a>
              ${c.linkedin ? html`<a href=${c.linkedin} target="_blank" rel="noopener">${tr('contact.linkedin', 'LinkedIn')}</a>` : ''}
            </div>
          </div>
        `)}
      </div>
      <div class="ld-contact-sub">${tr('contact.sub', 'You reach us directly. A demo fits in the same call.')}</div>
    </div>
  `;
}
