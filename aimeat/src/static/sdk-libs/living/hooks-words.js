/**
 * @file living/hooks-words.js
 * @description THE WORDS THE HOOKS SAY, IN BOTH LANGUAGES, IN ONE PLACE. Everything else in a
 *   living document takes its words from the record: a label, a sentence, a machine's advice are
 *   all the author's own. These are not — they are the LIBRARY talking, about a road out of the
 *   browser that the author did not write and cannot be expected to translate: a refusal from the
 *   node, a reading that did not refresh, the two gear dialogs and their fields.
 *
 *   SO THEY ARE COMPOSED IN EACH LANGUAGE RATHER THAN TRANSLATED FROM ONE, the way every other
 *   piece of text on this platform is, and they are read through the same page-first resolution
 *   order as the record's own words (i18n.js), so one switch moves all of it at once.
 *
 *   A REFUSAL PREFERS THE NODE'S OWN SENTENCE. The extension answers with a message that names the
 *   host and says how to add it; that sentence is better than anything this file could write,
 *   because it knows the configuration. What is here is the fallback for a refusal that arrived
 *   with a code and no words, and the frame the node's sentence is set into.
 * @structure WORDS · say(key, langs) · fill(text, values) · refusalWords(refusal, langs)
 * @usage
 *   import { say, fill } from './hooks-words.js';
 *   say('inward.title', ['fi']);   // 'Tämä arvo voi tulla ulkoa'
 * @version-history
 *   v0.6.0 — 2026-09-06 — Initial (the living document, stage 5: hooks).
 */
import { pickLang } from './i18n.js';

/** Every string this library says about a hook, composed in each language it is offered in. */
export const WORDS = {
  fi: {
    'gear.in': 'Tämä arvo voi tulla ulkoa',
    'gear.out': 'Kun tämä muuttuu, kerro jollekin',
    'inward.title': 'Tämä arvo voi tulla ulkoa',
    'inward.lead': 'Arvon voi asettaa käsin, lukea osoitteesta tai kirjoittaa muistiin. Sinä valitset kumpaa tietä.',
    'inward.road': 'Mistä arvo tulee',
    'inward.road.hand': 'Käsin, tältä sivulta',
    'inward.road.url': 'Osoitteesta',
    'inward.road.key': 'Muistiavaimesta',
    'inward.url': 'Osoite',
    'inward.path': 'Polku vastauksen sisällä',
    'inward.every': 'Kuinka usein, sekuntia',
    'inward.key': 'Muistiavain',
    'inward.expected': 'Näin vastauksen pitää näyttää',
    'inward.testRead': 'Kokeile lukemista',
    'inward.write': 'Kirjoita arvo muistiin',
    'inward.agent': 'Sano tämä omalle tekoälyllesi',
    'inward.range': 'Sallittu väli',
    'outward.title': 'Kun tämä muuttuu, kerro jollekin',
    'outward.lead': 'Jokaisesta siirtymästä lähtee yksi viesti, joka kantaa koko asiakirjan tilan.',
    'outward.kind': 'Kenelle kerrotaan',
    'outward.kind.url': 'Osoitteeseen',
    'outward.kind.agent': 'Omalle agentille',
    'outward.url': 'Osoite',
    'outward.method': 'Menetelmä',
    'outward.agent': 'Agentin nimi',
    'outward.enabled': 'Päällä',
    'outward.states': 'Tilat',
    'outward.watching': 'Seurattava kone',
    'outward.payload': 'Näin viesti lähtee',
    'outward.testSend': 'Kokeile lähetystä',
    'save': 'Tallenna',
    'close': 'Sulje',
    'copy': 'Kopioi',
    'copied': 'Kopioitu',
    'guest.read': 'Kirjaudu sisään, niin arvo luetaan ulkoa. Näytössä on viimeisin lukema.',
    'guest.send': 'Kirjaudu sisään, niin tämä voi kertoa ulospäin.',
    'stale.lead': 'Lukema ei päivittynyt: ',
    'stale.tail': ' Näytössä on viimeisin, joka saatiin.',
    'refusal.ALLOWLIST_REFUSED': 'Tätä osoitetta ei ole sallittu tällä solmulla.',
    'refusal.RATE_LIMITED': 'Kutsuja on tehty liikaa tämän minuutin aikana.',
    'refusal.PAYLOAD_TOO_LARGE': 'Viesti on liian iso lähetettäväksi.',
    'refusal.UPSTREAM_FAILED': 'Vastaanottaja ei vastannut.',
    'refusal.NO_EXTENSION': 'Tämän solmun living-hooks-laajennus ei vastannut.',
    'refusal.UNKNOWN': 'Kutsu ei mennyt läpi.',
    'sentence.write': 'Kirjoita AIMEAT-muistiin avaimelle {key} arvo {sample}. Asiakirja "{title}" lukee sen sieltä.',
    'sentence.task': 'Asiakirja "{title}" siirtyi tilasta {from} tilaan {to}. Koko tila on tämän viestin mukana.',
  },
  en: {
    'gear.in': 'This value can come from outside',
    'gear.out': 'When this changes, tell someone',
    'inward.title': 'This value can come from outside',
    'inward.lead': 'The value can be set by hand, read from an address, or written into memory. You choose which road.',
    'inward.road': 'Where the value comes from',
    'inward.road.hand': 'By hand, on this page',
    'inward.road.url': 'From an address',
    'inward.road.key': 'From a memory key',
    'inward.url': 'Address',
    'inward.path': 'Path inside the answer',
    'inward.every': 'How often, in seconds',
    'inward.key': 'Memory key',
    'inward.expected': 'This is the shape the answer must have',
    'inward.testRead': 'Test read',
    'inward.write': 'Write the value into memory',
    'inward.agent': 'Say this to your own AI',
    'inward.range': 'The range it accepts',
    'outward.title': 'When this changes, tell someone',
    'outward.lead': 'Every transition sends one message, and it carries the whole document\'s state.',
    'outward.kind': 'Who to tell',
    'outward.kind.url': 'An address',
    'outward.kind.agent': 'One of your agents',
    'outward.url': 'Address',
    'outward.method': 'Method',
    'outward.agent': 'The agent\'s name',
    'outward.enabled': 'On',
    'outward.states': 'The states',
    'outward.watching': 'The machine it watches',
    'outward.payload': 'This is the message as it goes',
    'outward.testSend': 'Test send',
    'save': 'Save',
    'close': 'Close',
    'copy': 'Copy',
    'copied': 'Copied',
    'guest.read': 'Sign in and the value is read from outside. What you see is the last reading.',
    'guest.send': 'Sign in and this can tell the outside.',
    'stale.lead': 'The reading did not refresh: ',
    'stale.tail': ' What you see is the last one that arrived.',
    'refusal.ALLOWLIST_REFUSED': 'This address is not one this node is allowed to call.',
    'refusal.RATE_LIMITED': 'Too many calls have been made this minute.',
    'refusal.PAYLOAD_TOO_LARGE': 'The message is too big to send.',
    'refusal.UPSTREAM_FAILED': 'The receiver did not answer.',
    'refusal.NO_EXTENSION': 'This node\'s living-hooks extension did not answer.',
    'refusal.UNKNOWN': 'The call did not go through.',
    'sentence.write': 'Write into AIMEAT memory, under the key {key}, the value {sample}. The document "{title}" reads it from there.',
    'sentence.task': 'The document "{title}" went from {from} to {to}. Its whole state is with this message.',
  },
};

/**
 * One of this library's own strings, in the language the page is reading.
 * @param {string} key @param {string[]} [langs]
 * @returns {string}
 */
export function say(key, langs) {
  const map = {};
  for (const lang of Object.keys(WORDS)) {
    if (WORDS[lang][key] != null) map[lang] = WORDS[lang][key];
  }
  const got = pickLang(map, langs || []);
  return got ? String(got.text) : String(key);
}

/**
 * A sentence with its holes filled. The holes are `{name}`, and a name with nothing behind it is
 * left standing rather than becoming "undefined".
 * @param {string} text @param {Record<string, any>} values
 * @returns {string}
 */
export function fill(text, values) {
  return String(text).replace(/\{([A-Za-z0-9_]+)\}/g, function (whole, name) {
    const v = values ? values[name] : undefined;
    return v == null ? whole : String(v);
  });
}

/**
 * A refusal, as a person reads it. The node's own sentence wins when there is one, because it knows
 * the configuration and can say how to change it; the code's fallback is for a refusal that arrived
 * with no words at all.
 * @param {{ code?: string, message?: string }|null|undefined} refusal @param {string[]} [langs]
 * @returns {string}
 */
export function refusalWords(refusal, langs) {
  if (!refusal) return '';
  if (refusal.message) return String(refusal.message);
  const code = String(refusal.code || 'UNKNOWN');
  const known = WORDS.en['refusal.' + code] ? code : 'UNKNOWN';
  return say('refusal.' + known, langs);
}
