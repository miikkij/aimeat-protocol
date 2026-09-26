/**
 * @file ContactCard.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared "Talk to a human" contact card — used on /v1/business and
 *   /v1/pricing ONLY (one implementation, no copied text). tel: + mailto: links.
 *   Name, email and phone come from this node's siteLinks config, so another
 *   operator's site never prints someone else's contact details. Renders nothing
 *   when the node has no contact email configured. Its look is css/components/contact-card.css
 *   (.contact-card and its parts) inside the large dashed aside of poster.css.
 * @usage import { ContactCard } from '/components/ContactCard.js';
 * @version-history
 *   v2.3.0 -- 2026-09-27 -- Draws its own names: .ld-contact(-title/-people/-person/-name/-role/-links/
 *     -sub) is .contact-card(-…); the rules moved with them out of css/views/landing.css into
 *     css/components/contact-card.css (a move).
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
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
    <div class="contact-card poster-aside poster-aside--large">
      <div class="contact-card-title">${tr('contact.title', 'Talk to a human.')}</div>
      <div class="contact-card-people">
        ${contacts.map(c => html`
          <div class="contact-card-person" key=${c.email}>
            <div class="contact-card-name">${c.name || c.email}</div>
            ${c.role ? html`<div class="contact-card-role">${c.role}</div>` : ''}
            <div class="contact-card-links">
              ${c.phone ? html`<a href=${`tel:${c.phone.replace(/[\s-]/g, '')}`}>${c.phone}</a>` : ''}
              <a href=${`mailto:${c.email}`}>${c.email}</a>
              ${c.linkedin ? html`<a href=${c.linkedin} target="_blank" rel="noopener">${tr('contact.linkedin', 'LinkedIn')}</a>` : ''}
            </div>
          </div>
        `)}
      </div>
      <div class="contact-card-sub">${tr('contact.sub', 'You reach us directly. A demo fits in the same call.')}</div>
    </div>
  `;
}
