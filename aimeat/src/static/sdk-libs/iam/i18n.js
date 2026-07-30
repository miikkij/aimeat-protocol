/**
 * @file iam/i18n.js
 * @description Finnish and English strings for the member panel. They ship with the library because
 *   the same six concepts were translated separately into every app that grew its own panel, and a
 *   seventh app should not have to do it a seventh time.
 *
 *   Language follows the host page: `document.documentElement.lang`, or an explicit `lang` option.
 *   An app with its own dictionary can override any key through `strings`, so shipping defaults
 *   never takes wording control away from the app.
 * @structure STRINGS · t(lang, key, vars) · pickLang(explicit)
 * @usage import { t, pickLang } from './i18n.js';
 * @version-history
 *   v1.0.0 — 2026-07-30 — Initial (TARGET-055 phase 1).
 */

/** @type {Record<string, Record<string, string>>} */
export const STRINGS = {
  en: {
    whoTitle: 'Who may use this',
    modeLabel: 'Mode',
    modeOpen: 'open',
    modeMembers: 'members-only',
    modeInvite: 'invite-only',
    modeSwitch: 'Switch',
    modeMeaningOpen: 'Anyone signed in may use it. Approving someone still changes what they pay.',
    modeMeaningMembers: 'Only approved members may use it. Everyone else is refused and told how to ask.',
    approveTitle: 'Approve someone',
    approvePlaceholder: 'account name, or owner@node',
    approveBtn: 'Approve',
    approveHelp: 'A role belongs to the person, so their agents inherit it. Add a row for agent#owner@node only to give that one agent something different.',
    pendingTitle: 'Asked for access',
    pendingNone: 'Nobody is waiting.',
    seenTitle: 'Turned up, holds no role',
    seenNone: 'Nobody has turned up yet.',
    visits: '{n} visits, last {d}',
    membersTitle: 'Approved',
    membersNone: 'Nobody is approved yet.',
    colAccount: 'Account',
    colRole: 'Role',
    colSince: 'Member since',
    colGrants: 'Free access',
    remove: 'Remove',
    decline: 'Decline',
    dismiss: 'Seen it',
    carried: '{n} / {of} carried',
    carriedNone: 'none carried',
    usage: '{n} calls, {cost} carried',
    carriedWarn: '{n} not carried',
    payingTitle: 'Paying customers: {n}',
    payingLead: 'They took a contract and let themselves in. Nothing here is waiting for you.',
    payingNone: 'No paying customers yet.',
    strangerTitle: 'What a stranger gets',
    strangerRole: 'Anyone signed in who is not on the list gets "{role}".',
    strangerDeny: 'Anyone not on the list is refused.',
    settingsTitle: 'Settings',
    joinTitle: 'Ask for access',
    joinNote: 'Who you are and what you need it for',
    joinBtn: 'Send request',
    joinSent: 'Your request was recorded. The owner decides.',
    joinPassive: 'Your visit has been recorded. The owner sees you in their list and can approve you.',
    joinAlready: 'You already have access.',
    notOwner: 'Only the owner manages members.',
    failed: 'That did not go through.',
    loading: 'Loading…',
  },
  fi: {
    whoTitle: 'Ketkä saavat käyttää',
    modeLabel: 'Tila',
    modeOpen: 'avoin',
    modeMembers: 'vain jäsenet',
    modeInvite: 'vain kutsutut',
    modeSwitch: 'Vaihda',
    modeMeaningOpen: 'Kuka tahansa kirjautunut saa käyttää. Hyväksyntä muuttaa silti sen mitä käyttäjä maksaa.',
    modeMeaningMembers: 'Vain hyväksytyt jäsenet saavat käyttää. Muille kerrotaan miten pääsyä pyydetään.',
    approveTitle: 'Hyväksy käyttäjä',
    approvePlaceholder: 'tilinimi tai omistaja@solmu',
    approveBtn: 'Hyväksy',
    approveHelp: 'Rooli kuuluu ihmiselle, joten hänen agenttinsa perivät sen. Lisää rivi muodossa agentti#omistaja@solmu vain jos haluat että juuri se agentti pitää jotain muuta.',
    pendingTitle: 'Pyytäneet pääsyä',
    pendingNone: 'Kukaan ei odota.',
    seenTitle: 'Käyneet, ei roolia',
    seenNone: 'Kukaan ei ole vielä käynyt.',
    visits: '{n} käyntiä, viimeksi {d}',
    membersTitle: 'Hyväksytyt',
    membersNone: 'Ketään ei ole vielä hyväksytty.',
    colAccount: 'Tili',
    colRole: 'Rooli',
    colSince: 'Jäsen alkaen',
    colGrants: 'Maksuton käyttö',
    remove: 'Poista',
    decline: 'Hylkää',
    dismiss: 'Kuitattu',
    carried: '{n} / {of} katettu',
    carriedNone: 'ei katettuja',
    usage: '{n} kutsua, {cost} katettu',
    carriedWarn: '{n} kattamatta',
    payingTitle: 'Maksavat asiakkaat: {n}',
    payingLead: 'He ottivat sopimuksen ja päästivät itsensä sisään. Täällä ei odota mitään päätöstä.',
    payingNone: 'Ei vielä maksavia asiakkaita.',
    strangerTitle: 'Mitä tuntematon saa',
    strangerRole: 'Kirjautunut joka ei ole listalla saa roolin "{role}".',
    strangerDeny: 'Listan ulkopuolinen ei saa käyttää tätä.',
    settingsTitle: 'Asetukset',
    joinTitle: 'Pyydä pääsyä',
    joinNote: 'Kuka olet ja mihin tarvitset tätä',
    joinBtn: 'Lähetä pyyntö',
    joinSent: 'Pyyntösi on kirjattu. Omistaja päättää.',
    joinPassive: 'Käyntisi on kirjattu. Omistaja näkee sinut listallaan ja voi hyväksyä sinut.',
    joinAlready: 'Sinulla on jo pääsy.',
    notOwner: 'Vain omistaja hallinnoi jäseniä.',
    failed: 'Se ei mennyt läpi.',
    loading: 'Ladataan…',
  },
};

/**
 * Which language to render in: an explicit option, else the host page's `lang`, else English.
 * @param {string} [explicit]
 * @returns {string}
 */
export function pickLang(explicit) {
  const raw = explicit || (document.documentElement && document.documentElement.lang) || 'en';
  const short = String(raw).toLowerCase().slice(0, 2);
  return STRINGS[short] ? short : 'en';
}

/**
 * One string, with `{name}` placeholders filled. An unknown key returns the key itself rather than
 * an empty node, so a missing translation is visible instead of silently blank.
 * @param {string} lang
 * @param {string} key
 * @param {Record<string, string|number>} [vars]
 * @param {Record<string, string>} [overrides]  App-supplied wording, wins over the shipped default.
 * @returns {string}
 */
export function t(lang, key, vars, overrides) {
  const table = STRINGS[lang] || STRINGS.en;
  let s = (overrides && overrides[key]) || table[key] || STRINGS.en[key] || key;
  if (vars) {
    for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(String(vars[k]));
  }
  return s;
}
