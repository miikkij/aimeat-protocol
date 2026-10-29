/**
 * @file public/views/home/customer-welcome.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The welcome a buyer reads first on the node the store made for them: their name,
 *   what they bought, the three next steps, a field to say in one sentence what they want, and
 *   where their orders and invoices are.
 *
 *   ONLY ON A CUSTOMER'S NODE (site.js customerNode()), AND ONLY UNTIL THEIR AI IS CONNECTED. The
 *   UX review of the first purchase (2026-10-29, B) found a buyer landing on a page that said
 *   nothing about what they had bought or what to do first. The home's own steps (the AI road
 *   chooser below) stay as they are; this sits above them and says what they are for.
 *
 *   THE SENTENCE GOES WHERE THE AGENTS BAND'S DOES: the new-agent page, which shows the agent
 *   before anything exists (views/home/agents-band.js). One way in for one thing.
 *
 *   Composed from library components only (Band, BandNote, NamedRow, IndexList, IndexStep,
 *   TextField, Action, Actions); it has no sheet of its own.
 * @structure CustomerWelcome({ session, navigate })
 * @usage html`<${CustomerWelcome} session=${session} navigate=${navigate} />`
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (UX review 2026-10-29, B).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { customerNode, siteLink, storeOrdersHref, contactHref } from '/js/site.js';
import { Band, BandNote } from '/components/Band.js';
import { NamedRow } from '/components/NamedRow.js';
import { IndexList, IndexStep } from '/components/NumberedIndex.js';
import { TextField } from '/components/TextField.js';
import { Action, Actions, Loud } from '/components/Action.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/**
 * The welcome, or nothing: not a customer's node, or the person's AI is already connected.
 * @param {{ session: any, initialized: boolean, navigate?: (path: string) => void }} props
 */
export function CustomerWelcome({ session, initialized, navigate }) {
  const [say, setSay] = useState('');
  if (!customerNode() || initialized) return null;

  const name = session?.displayName || session?.owner || '';
  const plan = siteLink('purchasePlan');
  const pkg = siteLink('purchasePackage');
  const orders = storeOrdersHref(getLocale());
  const support = contactHref(tr('profile.landing.supportSubject', 'Help with my AIMEAT')) || '/v1/help';
  const bought = (pkg
    ? tr('home.buyerWelcome.boughtPackage', 'You bought AIMEAT {plan} with the package {package}.')
    : tr('home.buyerWelcome.bought', 'You bought AIMEAT {plan}.')).replace('{plan}', plan).replace('{package}', pkg);

  const make = () => {
    const sentence = say.trim();
    navigate?.('/v1/home?new-agent=1' + (sentence ? '&say=' + encodeURIComponent(sentence) : ''));
  };

  return html`
    <${Band} title=${tr('home.buyerWelcome.title', 'Welcome, {name}').replace('{name}', name)}>
      <${BandNote}>${bought} ${tr('home.buyerWelcome.lead', 'Here is what to do first.')}<//>

      <${NamedRow} stack label=${tr('home.buyerWelcome.stepsLabel', 'Three steps')}>
        <${IndexList} steps>
          <${IndexStep}>${tr('home.buyerWelcome.step1', 'Connect the AI you already use, such as ChatGPT or Claude. The way is right below.')}<//>
          <${IndexStep}>${tr('home.buyerWelcome.step2', 'Say in one sentence what you want done. AIMEAT makes an agent for it and shows it to you before it starts.')}<//>
          <${IndexStep}>${tr('home.buyerWelcome.step3', 'Your order and invoices are in the store, under Orders and invoices in Settings.')}<//>
        <//>
      <//>

      <${NamedRow} stack label=${tr('home.buyerWelcome.sayLabel', 'What do you want done?')}>
        <${TextField}
          label=${tr('home.buyerWelcome.sayField', 'Say it in one sentence')}
          placeholder=${tr('home.agents.askPlaceholder', 'For example: gather the industry news every weekday morning and write a summary')}
          value=${say} onInput=${setSay} onEnter=${make}
          actions=${html`<${Loud} control onClick=${make}>${tr('home.buyerWelcome.sayGo', 'Show me the agent')}<//>`} />
      <//>

      <${Actions}>
        ${orders && html`<${Action} small href=${orders} newTab>${tr('profile.landing.ordersInvoices', 'Orders and invoices')}<//>`}
        <${Action} small href=${support}>${tr('profile.landing.contactSupport', 'Contact support')}<//>
      <//>
    <//>`;
}

export default CustomerWelcome;
