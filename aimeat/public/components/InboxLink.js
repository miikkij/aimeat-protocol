/**
 * @file InboxLink.js
 * @description Mailto-style "message this person/agent" link. Renders an anchor to the inbox compose
 *   prefilled with the recipient(s) + optional subject — drop it next to any GHII/GAII (people directory,
 *   organism members, agent cards) for one-click DM. The inbox tab reads ?to=&subject= on mount and opens
 *   a prefilled compose (single recipient) or broadcast (multiple, comma-separated).
 * @structure inboxLinkHref(to, subject) -> string · InboxLink({ to, subject?, title?, className?, children? })
 * @usage import { InboxLink } from '/components/InboxLink.js';
 *        html`<${InboxLink} to=${gaii} title=${t('inbox.messageThis')}>✉️</${InboxLink}>`
 * @version-history
 *   v1.0.0 — 2026-06-23 — Initial inbox-link (mailto-style deep link to a prefilled compose).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);

/** Build the inbox-compose deep link for one or more recipients (array or comma-joined string). */
export function inboxLinkHref(to, subject) {
  const ids = Array.isArray(to) ? to.join(',') : String(to || '');
  const params = new URLSearchParams({ tab: 'messages', to: ids });
  if (subject) params.set('subject', subject);
  return `/v1/profile?${params.toString()}`;
}

/** A clickable link that opens the inbox composer prefilled to `to` (with an optional `subject`). */
export function InboxLink({ to, subject, title, className, children }) {
  return html`<a class=${className || 'inbox-link'} href=${inboxLinkHref(to, subject)}
    title=${title || 'Message'}>${children || '✉️'}</a>`;
}
