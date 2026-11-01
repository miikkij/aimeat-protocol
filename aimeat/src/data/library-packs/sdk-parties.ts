/**
 * @file src/data/library-packs/sdk-parties.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The registry entry of aimeat-parties.js: an app's own users without an AIMEAT account,
 *   who register with an e-mail address and become outside parties of the app's owner (plan
 *   doc-mvwxcas3dom3, D4.2). Its own file, spread into SDK_PACKS by library-packs/sdk.ts.
 * @structure PARTIES_PACKS
 * @usage Spread into SDK_PACKS by library-packs/sdk.ts.
 * @version-history
 *   v1.0.0 - 2026-11-01 - Initial (plan doc-mvwxcas3dom3, D4.2).
 */
import type { LibraryPack } from './types.js';

export const PARTIES_PACKS: LibraryPack[] = [
  {
    id: 'aimeat-parties',
    kind: 'sdk',
    category: 'core',
    title: 'Outside users of an app',
    description: 'Let people without an AIMEAT account register to your app with an e-mail address, sign in with a mailed link, and keep their own records in it. They are outside parties of the app\'s owner and never accounts of the node.',
    url: '/v1/libs/aimeat-parties.js',
    include: ['<script src="{{BASE_URL}}/v1/libs/aimeat-parties.js"></script>'],
    requires: [],
    license: 'MIT',
    apiSurface: 'AIMEAT.parties',
    aiDoc: [
      'For an app whose users are NOT AIMEAT accounts: the buyers of a market place, the members of a club,',
      'the customers of a shop. Each registers with an e-mail address and becomes an outside party of the',
      "app's owner. The node decides everything; this library carries the calls.",
      '',
      'THE FLOW:',
      '  await AIMEAT.parties.ready();                       // opens a mailed link the page was loaded with',
      '  const { open } = await AIMEAT.parties.registration(); // may people register now?',
      "  await AIMEAT.parties.signUp('person@example.org');   // 202: a link is mailed to the address",
      "  await AIMEAT.parties.signIn('person@example.org');   // a new link, for a person already registered",
      '  if (AIMEAT.parties.signedIn()) { const me = await AIMEAT.parties.me(); }   // { party, role, app }',
      '  await AIMEAT.parties.signOut();                      // ends every session of the person here',
      '',
      'THE DATA OF ONE PERSON: one record per collection, at most 20 collections of 64 kB each.',
      "  await AIMEAT.parties.data.set('cart', { items: [...] });",
      "  const cart = await AIMEAT.parties.data.get('cart');            // null when nothing is kept",
      "  const prices = await AIMEAT.parties.data.get('prices', { shared: true });   // what the app shares to all",
      "  await AIMEAT.parties.data.remove('cart');",
      'A person reads and writes only their own collections and reads the shared ones. The app writes a',
      'shared collection with its owner\'s session: PUT /v1/apps/{owner}/{app}/party-data-shared/{key} { value }.',
      '',
      'WHAT WILL SURPRISE YOU:',
      '1. signUp() answers the same for an address already registered, so it never tells who is registered.',
      '   Tell the person to open the link from their mail.',
      '2. The signup works only when the node allows it (AIMEAT_PARTY_SELF_REGISTRATION) and the owner opened',
      '   it for this app (PUT /v1/apps/{owner}/{app}/parties/registration { open: true }). Otherwise',
      '   PARTY_REGISTRATION_OFF or PARTY_REGISTRATION_CLOSED: show "registration is closed", not an error.',
      '3. A node that sends no mail answers MAIL_NOT_CONFIGURED: nobody could open the link.',
      '4. The session is a token for THIS app only: no other app and no node route takes it.',
      '5. The people are personal data the owner holds. The data map says so: "registers-parties" in',
      '   machinery, or "registers": { "who": "...", "keeps": ["e-mail address", ...] }.',
    ].join('\n'),
    changelog: [
      { version: '1.0.0', date: '2026-11-01', summary: 'Initial: signUp, signIn, ready, me, signOut, registration, and data.get/set/remove over /v1/apps/{owner}/{app}/parties and party-data.' },
    ],
    tierHint: 'T1',
    interviewTriggers: ['register', 'sign up', 'customers', 'members without account', 'marketplace users', 'rekisteröityminen', 'asiakkaat', 'kauppapaikka'],
    sizeEstimate: '~3KB',
    status: 'preview',
    modelTier: 'needs-doc',
    proofs: [],
    promptGroup: 'core',
    promptLine: '- aimeat-parties.js — people without an AIMEAT account register to the app with an e-mail link and keep their own records in it (`AIMEAT.parties.signUp(email)`, `signIn`, `me`, `signOut`, `data.get/set/remove`). Works only when the node and the app owner allow registration.',
  },
];
