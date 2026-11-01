/**
 * @file public/views/home/customer-welcome.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The welcome a buyer reads first on the node the store made for them: their name
 *   (never the account id), the place's address, what they bought, the two first steps with the
 *   first one the only loud action, and small links to their orders, support and settings.
 *
 *   ONLY ON A CUSTOMER'S NODE (site.js customerNode()), AND ONLY UNTIL THEIR AI IS CONNECTED. The
 *   UX review of the first purchase (2026-10-29, B) found a buyer landing on a page that said
 *   nothing about what they had bought or what to do first. The home's own steps (the AI road
 *   chooser below) stay as they are; this sits above them and says what they are for.
 *
 *   Composed from library components only (Band, BandNote, NamedRow, IndexList, IndexStep,
 *   ChooserFold, Action, Loud, Actions); it has no sheet of its own.
 * @structure CustomerWelcome({ session, initialized })
 * @usage html`<${CustomerWelcome} session=${session} initialized=${state.initialized} />`
 * @version-history
 *   v1.3.0 — 2026-11-01 — While the place's own chat answers (ai-credit.js chatWorks), step 2 is open
 *     with a link to the chat, not greyed as waiting for the outside AI.
 *   v1.2.0 — 2026-10-31 — Jouni's review of v31 (K26): "Tervetuloa omaan AIMEATiisi, <nimi>" with a
 *     real name only, never the account id; the address in small type; "oikea kätesi" in place of
 *     "esikuntapäällikkö", and MCP only behind "Mikä tämä on?"; the connect buttons are the one loud
 *     action; step 2 waits greyed until the AI is connected, and its sentence field is gone; step 3
 *     (orders) left the list for a small link at the foot beside support and settings.
 *   v1.1.0 — 2026-10-31 — The first step says what connecting gives, in Jouni's words with MCP
 *     explained, and has one button each for ChatGPT, Claude and Grok that opens the connect guide on
 *     that AI, and one for another AI (v31 K26).
 *   v1.0.0 — 2026-10-29 — Initial (UX review 2026-10-29, B).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { customerNode, siteLink, storeOrdersHref, contactHref } from '/js/site.js';
import { Band, BandNote } from '/components/Band.js';
import { NamedRow } from '/components/NamedRow.js';
import { IndexList, IndexStep } from '/components/NumberedIndex.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { ChooserFold } from '/components/Chooser.js';
import { Note } from '/components/Note.js';
import { rememberTool } from '/components/SetupGuide.js';
import { useShared } from '/views/surface/shared-read.js';
import { chatWorks } from '/js/ai-credit.js';

/**
 * The AIs a buyer most likely has, as the connect guide names them (GET /v1/ai-tools ids). Each
 * button opens the connect page's guide on that AI (v31 K26: "Mukaan napit Yhdistä ChatGPT /
 * Claude / Grok").
 */
const CONNECT_TOOLS = [['chatgpt', 'ChatGPT'], ['claude-web', 'Claude'], ['grok', 'Grok']];

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/**
 * The welcome, or nothing: not a customer's node, or the person's AI is already connected.
 * @param {{ session: any, initialized: boolean }} props
 */
export function CustomerWelcome({ session, initialized }) {
  const show = customerNode() && !initialized;
  const { data: chatStatus } = useShared('chat-status', show ? '/v1/chat/status' : null, ['chat']);
  if (!show) return null;
  const step2 = tr('home.buyerWelcome.step2', 'Say in one sentence what you want done. AIMEAT makes an agent for it and shows it to you before it starts.');

  // A real name only: a buyer the store named no one gets the account id as their name, and a machine
  // id in the heading reads as a fault (v31 K26: "KOEUUSI417276" was the big heading).
  const name = realName(session);
  const plan = siteLink('purchasePlan');
  const pkg = siteLink('purchasePackage');
  const orders = storeOrdersHref(getLocale());
  const support = contactHref(tr('profile.landing.supportSubject', 'Help with my AIMEAT')) || '/v1/help';
  const bought = (pkg
    ? tr('home.buyerWelcome.boughtPackage', 'You bought AIMEAT {plan} with the package {package}.')
    : tr('home.buyerWelcome.bought', 'You bought AIMEAT {plan}.')).replace('{plan}', plan).replace('{package}', pkg);

  // Until the AI is connected, step 1 is the one thing to do: its buttons are the only loud ones, and
  // step 2 waits greyed with why (v31 K26). Orders, support and settings are small links at the foot.
  return html`
    <${Band} title=${name
      ? tr('home.buyerWelcome.titleNamed', 'Welcome to your own AIMEAT, {name}').replace('{name}', name)
      : tr('home.buyerWelcome.titlePlain', 'Welcome to your own AIMEAT')}>
      <${BandNote}>${window.location.host}<//>
      <${BandNote}>${bought}<//>

      <${NamedRow} stack label=${tr('home.buyerWelcome.stepsLabel', 'Two steps')}>
        <${IndexList} steps>
          <${IndexStep}>
            ${tr('homeConnect.lead', 'Connect ChatGPT, Claude or Grok here, and it becomes your right hand.')}
            <${Actions}>
              ${CONNECT_TOOLS.map(([id, label]) => html`
                <${Loud} key=${id} href="/v1/profile?tab=mcp" onClick=${() => rememberTool(id)}>${tr('homeConnect.button', 'Connect {ai}').replace('{ai}', label)}<//>`)}
              <${Action} small soft href="/v1/profile?tab=mcp">${tr('homeConnect.other', 'Another AI')} →<//>
            <//>
            <${ChooserFold} summary=${tr('homeConnect.mcpQ', 'What is this?')}>
              <p>${tr('homeConnect.mcpWhat', 'The connection uses the open MCP technology. You do not need to know more about it.')}</p>
            <//>
          <//>
          ${chatWorks(chatStatus)
            // The place's own chat answers before any outside AI is connected, so step 2 is open there
            // (commercial's crew52 check: it looked locked although the chat worked).
            ? html`<${IndexStep}>
                ${step2}
                <${Actions}><${Action} small href="/v1/chat">${tr('home.buyerWelcome.step2Open', 'Open the chat')} →<//><//>
              <//>`
            : html`<${IndexStep} line=${tr('home.buyerWelcome.step2Waits', 'This opens when your AI is connected.')}>
                <${Note} kind="quiet">${step2}<//>
              <//>`}
        <//>
      <//>

      <${Actions}>
        ${orders && html`<${Action} small soft href=${orders} newTab>${tr('profile.landing.ordersInvoices', 'Orders and invoices')}<//>`}
        <${Action} small soft href=${support}>${tr('profile.landing.contactSupport', 'Contact support')}<//>
        <${Action} small soft href="/v1/profile">${tr('home.buyerWelcome.settings', 'Settings')}<//>
      <//>
    <//>`;
}

/** The person's own name, or '' when the only name is the account id. */
function realName(session) {
  const display = String(session?.displayName || '').trim();
  return display && display !== session?.owner ? display : '';
}

export default CustomerWelcome;
