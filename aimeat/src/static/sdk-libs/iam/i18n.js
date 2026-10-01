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
 *   v1.1.0 — 2026-10-01 — Spanish (es-419). Strings for a refusal's reason, the switch, the node
 *     roster's stranger line and approve help, and the join form's pending and declined states. The
 *     Finnish no longer uses "solmu".
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
    approveHelpNode: 'A role belongs to the person, so their agents have the same role.',
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
    strangerNode: 'Anyone who is signed in can open this app. The app hides the parts it marks for members, and only the extension of the app can refuse a change a stranger tries to make.',
    settingsTitle: 'Settings',
    joinTitle: 'Ask for access',
    joinNote: 'Who you are and what you need it for',
    joinBtn: 'Send request',
    joinSent: 'Your request was recorded. The owner decides.',
    joinPassive: 'Your visit has been recorded. The owner sees you in their list and can approve you.',
    joinAlready: 'You already have access.',
    joinPending: 'You asked on {d}. The owner has not decided yet.',
    joinDeclined: 'The owner declined your earlier request. You can ask again.',
    notOwner: 'Only the owner manages members.',
    failed: 'That did not go through.',
    failedWith: 'That did not go through: {why}',
    on: 'On',
    off: 'Off',
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
    approvePlaceholder: 'tilinimi',
    approveBtn: 'Hyväksy',
    approveHelp: 'Rooli kuuluu ihmiselle, joten hänen agenttinsa perivät sen. Lisää rivi muodossa agent#owner@node vain, jos haluat antaa juuri sille agentille jotain muuta.',
    approveHelpNode: 'Rooli kuuluu ihmiselle, joten myös hänen agenteillaan on sama rooli.',
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
    strangerNode: 'Kuka tahansa kirjautunut voi avata tämän sovelluksen. Sovellus piilottaa jäsenille merkityt osat, ja vain sovelluksen laajennus voi estää muutoksen, jota vieras yrittää tehdä.',
    settingsTitle: 'Asetukset',
    joinTitle: 'Pyydä pääsyä',
    joinNote: 'Kuka olet ja mihin tarvitset tätä',
    joinBtn: 'Lähetä pyyntö',
    joinSent: 'Pyyntösi on kirjattu. Omistaja päättää.',
    joinPassive: 'Käyntisi on kirjattu. Omistaja näkee sinut listallaan ja voi hyväksyä sinut.',
    joinAlready: 'Sinulla on jo pääsy.',
    joinPending: 'Pyysit pääsyä {d}. Omistaja ei ole vielä päättänyt.',
    joinDeclined: 'Omistaja hylkäsi aiemman pyyntösi. Voit pyytää uudelleen.',
    notOwner: 'Vain omistaja hallinnoi jäseniä.',
    failed: 'Se ei mennyt läpi.',
    failedWith: 'Se ei mennyt läpi: {why}',
    on: 'Päällä',
    off: 'Pois',
    loading: 'Ladataan…',
  },
  es: {
    whoTitle: 'Quién puede usar esto',
    modeLabel: 'Modo',
    modeOpen: 'abierto',
    modeMembers: 'solo miembros',
    modeInvite: 'solo con invitación',
    modeSwitch: 'Cambiar',
    modeMeaningOpen: 'Cualquier persona con sesión iniciada puede usarla. Aprobar a alguien cambia lo que paga.',
    modeMeaningMembers: 'Solo los miembros aprobados pueden usarla. A los demás se les rechaza y se les explica cómo pedir acceso.',
    approveTitle: 'Aprobar a alguien',
    approvePlaceholder: 'nombre de cuenta',
    approveBtn: 'Aprobar',
    approveHelp: 'El rol pertenece a la persona, así que sus agentes lo heredan. Agrega una fila para agent#owner@node solo si quieres darle a ese agente algo distinto.',
    approveHelpNode: 'El rol pertenece a la persona, así que sus agentes tienen el mismo rol.',
    pendingTitle: 'Pidieron acceso',
    pendingNone: 'Nadie está esperando.',
    seenTitle: 'Entraron, sin rol',
    seenNone: 'Todavía no ha entrado nadie.',
    visits: '{n} visitas, la última el {d}',
    membersTitle: 'Aprobados',
    membersNone: 'Todavía no hay nadie aprobado.',
    colAccount: 'Cuenta',
    colRole: 'Rol',
    colSince: 'Miembro desde',
    colGrants: 'Acceso gratuito',
    remove: 'Quitar',
    decline: 'Rechazar',
    dismiss: 'Visto',
    carried: '{n} de {of} cubiertos',
    carriedNone: 'ninguno cubierto',
    usage: '{n} llamadas, {cost} cubiertos',
    carriedWarn: '{n} sin cubrir',
    payingTitle: 'Clientes que pagan: {n}',
    payingLead: 'Contrataron y entraron por su cuenta. Aquí no hay nada pendiente para ti.',
    payingNone: 'Todavía no hay clientes que paguen.',
    strangerTitle: 'Qué recibe una persona desconocida',
    strangerRole: 'Quien inicia sesión y no está en la lista recibe el rol "{role}".',
    strangerDeny: 'Quien no está en la lista no puede usar esto.',
    strangerNode: 'Cualquier persona con sesión iniciada puede abrir esta aplicación. La aplicación oculta las partes que marca para miembros, y solo la extensión de la aplicación puede rechazar un cambio que intente hacer una persona desconocida.',
    settingsTitle: 'Configuración',
    joinTitle: 'Pedir acceso',
    joinNote: 'Quién eres y para qué lo necesitas',
    joinBtn: 'Enviar solicitud',
    joinSent: 'Tu solicitud quedó registrada. El propietario decide.',
    joinPassive: 'Tu visita quedó registrada. El propietario te ve en su lista y puede aprobarte.',
    joinAlready: 'Ya tienes acceso.',
    joinPending: 'Pediste acceso el {d}. El propietario todavía no ha decidido.',
    joinDeclined: 'El propietario rechazó tu solicitud anterior. Puedes pedirlo de nuevo.',
    notOwner: 'Solo el propietario administra a los miembros.',
    failed: 'No se pudo completar.',
    failedWith: 'No se pudo completar: {why}',
    on: 'Activado',
    off: 'Desactivado',
    loading: 'Cargando…',
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
