/**
 * @file ManagedEnvNote.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The managed-environment note shown ABOVE every copyable prompt on the public
 *   pages: what a company-managed AI tool's "prompt injection / untrusted source" notice means,
 *   why it comes from the environment rather than from the prompt, and the three routes round it
 *   (the administrator approves the connector · the manual copy path, which needs no connector ·
 *   self-hosting, since the code is MIT and readable). One component so the wording cannot drift
 *   between the landing page, the /v1/start playbook and the classic portal. The same text is
 *   duplicated by hand in the two static connect pages, which are plain HTML with no Preact.
 *   It never tells anyone to click a notice away: a security team hit that notice cold, read it
 *   as a property of the product, and stopped there. Explaining beats reassuring.
 * @structure ManagedEnvNote({ compact }) — `<aside class="mgd-note">` with a title, the reason,
 *   the do-not-click-past line, an ordered list of the three routes (dropped when `compact`),
 *   and a link to /v1/connect for the administrator.
 * @usage
 *   import { ManagedEnvNote } from '/components/ManagedEnvNote.js';
 *   html`<${ManagedEnvNote} />`            // full, beside a primary prompt
 *   html`<${ManagedEnvNote} compact=${true} />`  // title + reason only, for secondary prompts
 * @version-history
 *   v1.0.0 — 2026-07-31 — Initial. Born from a security team that met the notice with no
 *     warning and did not continue; mirrors the block published in the Experience Center.
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
const html = htm.bind(h);

export function ManagedEnvNote({ compact = false }) {
  // t() echoes the key when a translation is missing — fall back to readable English.
  const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
  return html`
    <aside class="mgd-note">
      <h4 class="mgd-note-title">${tr('managedEnv.title', 'On a company-managed account: what those notices mean')}</h4>
      <p class="mgd-note-body">${tr('managedEnv.why', 'Company-managed AI tools (Claude Enterprise, Team and similar) may show a notice about prompt injection or an untrusted source when you use a prompt from this page. The notice appears before anything has run. The reason is the environment: there, every external service the administrator has not approved is untrusted by default, and the same notice applies to any unapproved connector.')}</p>
      <p class="mgd-note-body">${tr('managedEnv.read', 'Do not click past it out of habit. If you do not know where a prompt came from, do not run it. The prompt above is shown in full before you copy it.')}</p>
      ${compact ? '' : html`
        <p class="mgd-note-body"><b>${tr('managedEnv.routesTitle', 'Three routes, in this order:')}</b></p>
        <ol class="mgd-note-routes">
          <li>${tr('managedEnv.route1', 'Ask your administrator to approve the connector. They approve the MCP endpoint, the OAuth sign-in (each person signs in as themselves, there are no shared keys), and the tool set the connector exposes. Order: the administrator approves first, then you add the connector and sign in.')}</li>
          <li>${tr('managedEnv.route2', 'Use the manual route. This page works with no connector at all: you copy the prompt, read it, paste it into your chat, and bring the answer back. Nothing is connected, and nothing leaves the chat until you send it.')}</li>
          <li>${tr('managedEnv.route3', 'Run AIMEAT yourself. The whole codebase is MIT licensed and self-hostable: you can read exactly what the prompt does, run it on your own server, and check it yourself. We are not asking you to trust it, we are asking you to check it.')}</li>
        </ol>`}
      <a class="mgd-note-link" href="/v1/connect" target="_blank" rel="noopener">${tr('managedEnv.link', 'Connector technical details for your administrator →')}</a>
    </aside>`;
}
