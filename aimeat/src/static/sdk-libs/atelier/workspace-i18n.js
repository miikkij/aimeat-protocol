/**
 * @file atelier/workspace-i18n.js
 * @description The words of the workspace components (workspaceTeam, workspacePicker) in the kit's
 *   three languages. Each language is written in that language. A host overrides any key by
 *   defining it under the `workspace.` prefix in i18n.use(). The role words follow the organisms
 *   page: viewer / lukija / lector, contributor / kirjoittaja / colaborador, creator / luoja /
 *   quien lo creó.
 * @structure STRINGS (en/fi/es) · tw(key, vars) — host override first, then this dictionary
 * @usage
 *   import { tw } from './workspace-i18n.js';
 *   tw('team.title');
 * @version-history
 *   v0.61.0 — 2026-10-01 — Initial (IAM plan Phase D blocks 2 and 3).
 */
import { i18n } from './i18n.js';

const STRINGS = {
  en: {
    'sample.note': 'A sample. Nothing here is sent or changed.',
    'failed': 'That did not go through: {why}',
    'noLib': 'This block needs aimeat-organism.js on the page.',
    'loading': 'Loading…',
    'role.viewer': 'viewer',
    'role.contributor': 'contributor',
    'role.creator': 'creator',
    'orgRole.owner': 'owner',
    'orgRole.admin': 'admin',
    'orgRole.member': 'member',
    'team.title': 'People in this workspace',
    'team.intro': 'Who may read this workspace, and who may also write in it.',
    'team.signIn': 'Sign in to see who has access to this workspace.',
    'tab.requests': 'Requests',
    'tab.people': 'People',
    'tab.invite': 'Invite',
    'team.requestsNone': 'Nobody is waiting.',
    'team.peopleNone': 'Nobody else has access yet.',
    'team.approve': 'Approve',
    'team.decline': 'Decline',
    'team.remove': 'Remove',
    'team.role': 'Role',
    'team.since': 'since {d}',
    'team.asked': 'asked {d}',
    'team.creatorHint': 'Created this workspace. The creator always has access.',
    'team.raise': 'May {who} write in this workspace?',
    'team.raiseText': 'A contributor reads and writes in this workspace. A viewer only reads.',
    'team.raiseYes': 'Allow writing',
    'team.confirmRemove': 'Remove {who} from this workspace?',
    'team.confirmRemoveText': 'They can no longer read or write here. You can add them again later.',
    'team.invitePlaceholder': 'Account name or email',
    'team.inviteHint': 'An account name gets the role at once. An email address gets an invitation to the organism, with this role in this workspace.',
    'team.add': 'Add',
    'team.invite': 'Invite',
    'team.granted': '{who} is now a {role}.',
    'team.declined': 'You declined the request from {who}.',
    'team.removed': '{who} no longer has access.',
    'team.inviteSent': 'Invitation sent to {email}.',
    'team.inviteLink': 'No email went out. Send them this link yourself: {url}',
    'team.colName': 'Name',
    'team.colSince': 'Since',
    'team.colActions': 'Role and actions',
    'picker.title': 'Where this app keeps its records',
    'picker.intro': 'An organism is a shared space for a group; this app keeps its records in one workspace of it.',
    'picker.signIn': 'Sign in to choose where this app keeps its records.',
    'picker.choose': 'Choose the organism',
    'picker.wsWill': 'The app uses the workspace "{name}" in it, and creates it if it is not there yet.',
    'picker.none': 'You do not belong to any organism yet. Create one below.',
    'picker.use': 'Use this',
    'picker.create': 'Create a new organism',
    'picker.orgName': 'Name of the new organism',
    'picker.createGo': 'Create',
    'picker.working': 'Getting the workspace ready…',
    'picker.using': 'Using {ws} in {org}',
    'picker.change': 'Change',
    'picker.cancel': 'Keep the current one',
  },
  fi: {
    'sample.note': 'Esimerkki. Täältä ei lähetetä eikä muuteta mitään.',
    'failed': 'Se ei mennyt läpi: {why}',
    'noLib': 'Tämä osa tarvitsee sivulle aimeat-organism.js-kirjaston.',
    'loading': 'Ladataan…',
    'role.viewer': 'lukija',
    'role.contributor': 'kirjoittaja',
    'role.creator': 'luoja',
    'orgRole.owner': 'omistaja',
    'orgRole.admin': 'ylläpitäjä',
    'orgRole.member': 'jäsen',
    'team.title': 'Työtilan ihmiset',
    'team.intro': 'Ketkä saavat lukea tätä työtilaa ja ketkä saavat myös kirjoittaa siihen.',
    'team.signIn': 'Kirjaudu sisään, niin näet, kenellä on pääsy tähän työtilaan.',
    'tab.requests': 'Pyynnöt',
    'tab.people': 'Ihmiset',
    'tab.invite': 'Kutsu',
    'team.requestsNone': 'Kukaan ei odota.',
    'team.peopleNone': 'Kenelläkään muulla ei vielä ole pääsyä.',
    'team.approve': 'Hyväksy',
    'team.decline': 'Hylkää',
    'team.remove': 'Poista',
    'team.role': 'Rooli',
    'team.since': '{d} alkaen',
    'team.asked': 'pyysi {d}',
    'team.creatorHint': 'Loi tämän työtilan. Luojalla on aina pääsy.',
    'team.raise': 'Saako {who} kirjoittaa tähän työtilaan?',
    'team.raiseText': 'Kirjoittaja voi lukea ja kirjoittaa tässä työtilassa. Lukija voi vain lukea.',
    'team.raiseYes': 'Salli kirjoittaminen',
    'team.confirmRemove': 'Poistetaanko {who} tästä työtilasta?',
    'team.confirmRemoveText': 'Hän ei voi enää lukea eikä kirjoittaa täällä. Voit lisätä hänet myöhemmin uudelleen.',
    'team.invitePlaceholder': 'Tilinimi tai sähköposti',
    'team.inviteHint': 'Tilinimi saa roolin heti. Sähköpostiosoite saa kutsun organismiin, ja kutsussa on tämä rooli tähän työtilaan.',
    'team.add': 'Lisää',
    'team.invite': 'Kutsu',
    'team.granted': '{who} on nyt {role}.',
    'team.declined': 'Hylkäsit pyynnön: {who}.',
    'team.removed': 'Käyttäjällä {who} ei enää ole pääsyä.',
    'team.inviteSent': 'Kutsu lähti osoitteeseen {email}.',
    'team.inviteLink': 'Sähköposti ei lähtenyt. Lähetä tämä linkki itse: {url}',
    'team.colName': 'Nimi',
    'team.colSince': 'Alkaen',
    'team.colActions': 'Rooli ja toiminnot',
    'picker.title': 'Mihin sovellus tallentaa tietonsa',
    'picker.intro': 'Organismi on ryhmän yhteinen tila. Tämä sovellus pitää tietonsa yhdessä sen työtilassa.',
    'picker.signIn': 'Kirjaudu sisään, niin voit valita, mihin sovellus tallentaa tietonsa.',
    'picker.choose': 'Valitse organismi',
    'picker.wsWill': 'Sovellus käyttää siinä työtilaa "{name}" ja luo sen, jos sitä ei vielä ole.',
    'picker.none': 'Et vielä kuulu mihinkään organismiin. Luo uusi alla.',
    'picker.use': 'Käytä tätä',
    'picker.create': 'Luo uusi organismi',
    'picker.orgName': 'Uuden organismin nimi',
    'picker.createGo': 'Luo',
    'picker.working': 'Työtilaa valmistellaan…',
    'picker.using': 'Käytössä työtila {ws} organismissa {org}',
    'picker.change': 'Vaihda',
    'picker.cancel': 'Pidä nykyinen',
  },
  es: {
    'sample.note': 'Una muestra. Desde aquí no se envía ni se cambia nada.',
    'failed': 'No se pudo completar: {why}',
    'noLib': 'Este bloque necesita aimeat-organism.js en la página.',
    'loading': 'Cargando…',
    'role.viewer': 'lector',
    'role.contributor': 'colaborador',
    'role.creator': 'quien lo creó',
    'orgRole.owner': 'propietario',
    'orgRole.admin': 'administrador',
    'orgRole.member': 'miembro',
    'team.title': 'Personas en este espacio de trabajo',
    'team.intro': 'Quién puede leer este espacio de trabajo y quién puede además escribir en él.',
    'team.signIn': 'Inicia sesión para ver quién tiene acceso a este espacio de trabajo.',
    'tab.requests': 'Solicitudes',
    'tab.people': 'Personas',
    'tab.invite': 'Invitar',
    'team.requestsNone': 'Nadie está esperando.',
    'team.peopleNone': 'Nadie más tiene acceso todavía.',
    'team.approve': 'Aprobar',
    'team.decline': 'Rechazar',
    'team.remove': 'Quitar',
    'team.role': 'Rol',
    'team.since': 'desde el {d}',
    'team.asked': 'lo pidió el {d}',
    'team.creatorHint': 'Creó este espacio de trabajo. Quien lo crea siempre tiene acceso.',
    'team.raise': '¿Puede {who} escribir en este espacio de trabajo?',
    'team.raiseText': 'Un colaborador lee y escribe en este espacio de trabajo. Un lector solo lee.',
    'team.raiseYes': 'Permitir escribir',
    'team.confirmRemove': '¿Quitar a {who} de este espacio de trabajo?',
    'team.confirmRemoveText': 'Ya no podrá leer ni escribir aquí. Puedes volver a agregar a esa persona más tarde.',
    'team.invitePlaceholder': 'Nombre de cuenta o correo',
    'team.inviteHint': 'Un nombre de cuenta recibe el rol de inmediato. Una dirección de correo recibe una invitación al organismo, con este rol en este espacio de trabajo.',
    'team.add': 'Agregar',
    'team.invite': 'Invitar',
    'team.granted': '{who} ahora es {role}.',
    'team.declined': 'Rechazaste la solicitud de {who}.',
    'team.removed': '{who} ya no tiene acceso.',
    'team.inviteSent': 'La invitación se envió a {email}.',
    'team.inviteLink': 'No se envió ningún correo. Mándale tú este enlace: {url}',
    'team.colName': 'Nombre',
    'team.colSince': 'Desde',
    'team.colActions': 'Rol y acciones',
    'picker.title': 'Dónde guarda esta aplicación sus registros',
    'picker.intro': 'Un organismo es un espacio compartido para un grupo; esta aplicación guarda sus registros en uno de sus espacios de trabajo.',
    'picker.signIn': 'Inicia sesión para elegir dónde guarda esta aplicación sus registros.',
    'picker.choose': 'Elige el organismo',
    'picker.wsWill': 'La aplicación usa ahí el espacio de trabajo "{name}" y lo crea si todavía no existe.',
    'picker.none': 'Todavía no perteneces a ningún organismo. Crea uno abajo.',
    'picker.use': 'Usar este',
    'picker.create': 'Crear un organismo nuevo',
    'picker.orgName': 'Nombre del organismo nuevo',
    'picker.createGo': 'Crear',
    'picker.working': 'Preparando el espacio de trabajo…',
    'picker.using': 'Usando el espacio de trabajo {ws} de {org}',
    'picker.change': 'Cambiar',
    'picker.cancel': 'Mantener el actual',
  },
};

/**
 * The workspace components' lookup: the host may override any key by defining `workspace.<key>`
 * through i18n.use(); otherwise this dictionary answers in the platform language, falling back to
 * English, then to the key.
 * @param {string} key
 * @param {Record<string, any>} [vars]
 * @returns {string}
 */
export function tw(key, vars) {
  const hosted = i18n.t('workspace.' + key, vars);
  if (hosted !== 'workspace.' + key) return hosted;
  const lang = i18n.lang();
  const table = /** @type {Record<string, string>} */ (
    (STRINGS[/** @type {'en'|'fi'|'es'} */ (lang)] || STRINGS.en));
  const text = table[key] || STRINGS.en[key] || key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, function (whole, name) {
    return vars[name] == null ? whole : String(vars[name]);
  });
}
