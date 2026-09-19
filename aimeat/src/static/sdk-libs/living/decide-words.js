/**
 * @file living/decide-words.js
 * @description Every string the decide node says to a person, composed in each language the
 *   library is offered in. The questions to the model are the record's and stay English; these are
 *   the words AROUND them: where the node is, why it did not ask, and what a person is asked to do
 *   when the answer was not sure enough to move the machine.
 * @structure DECIDE_WORDS · sayDecide(key, langs, values)
 * @usage  import { sayDecide } from './decide-words.js';
 * @version-history
 *   v0.8.0 — 2026-09-19 — Initial (living 0.8.0).
 */
import { pickLang } from './i18n.js';

export const DECIDE_WORDS = {
  fi: {
    'status.': 'Ei vielä kysytty',
    'status.asking': 'Kysyy päätösmallilta',
    'status.moved': 'Siirsi tilaa',
    'status.stayed': 'Tila pysyi ennallaan',
    'status.person': 'Odottaa ihmisen päätöstä',
    'status.decided': 'Arvioitu',
    'status.unavailable': 'Päätösmalli ei ole käytettävissä',
    'status.failed': 'Kysymys epäonnistui',
    'noLib': 'Tämä sivu ei lataa päätösmallin kirjastoa (aimeat-decide.js), joten mitään ei kysytty.',
    'unavailable': 'Päätösmalli ei ole käytettävissä tällä tilillä, joten mitään ei kysytty.',
    'proposal': 'Malli ehdottaa siirtoa {event}, mutta varmuus {conf} jää alle kynnyksen {t}. Sinä päätät.',
    'proposalNone': 'Malli ei löytänyt sopivaa siirtoa tarpeeksi varmasti. Sinä päätät.',
    'byHand': 'Päätösmalli ei vastannut. Valitse seuraava askel itse.',
    'confirm': 'Hyväksy {event}',
    'keep': 'Pidä tila',
    'gates': 'Ratkaisee',
    'thresholds': 'Kynnykset',
    'step': 'Askel {event}',
    'removedNone': 'Henkilötietoja ei löytynyt, joten tekstistä ei poistettu mitään ennen lähetystä.',
    'removedLead': 'Poistettiin tekstistä ennen lähetystä: ',
    'removedTail': '. Ruudulla viesti näkyy sellaisena kuin kirjoitit sen.',
    'kind.person.1': 'nimi', 'kind.person.n': 'nimeä',
    'kind.email.1': 'sähköpostiosoite', 'kind.email.n': 'sähköpostiosoitetta',
    'kind.phone.1': 'puhelinnumero', 'kind.phone.n': 'puhelinnumeroa',
    'kind.hetu.1': 'henkilötunnus', 'kind.hetu.n': 'henkilötunnusta',
    'kind.iban.1': 'tilinumero', 'kind.iban.n': 'tilinumeroa',
    'kind.address.1': 'katuosoite', 'kind.address.n': 'katuosoitetta',
  },
  en: {
    'status.': 'Nothing asked yet',
    'status.asking': 'Asking the decision model',
    'status.moved': 'Moved the state',
    'status.stayed': 'The state stayed',
    'status.person': 'Waiting for a person',
    'status.decided': 'Judged',
    'status.unavailable': 'The decision model is not available',
    'status.failed': 'The question failed',
    'noLib': 'This page does not load the decision model library (aimeat-decide.js), so nothing was asked.',
    'unavailable': 'The decision model is not available on this account, so nothing was asked.',
    'proposal': 'The model proposes {event}, but its confidence {conf} is under the threshold {t}. You decide.',
    'proposalNone': 'The model found no step it was sure enough about. You decide.',
    'byHand': 'The decision model did not answer. Choose the next step yourself.',
    'confirm': 'Accept {event}',
    'keep': 'Keep the state',
    'gates': 'Decides',
    'thresholds': 'Thresholds',
    'step': 'Step {event}',
    'removedNone': 'No personal data was found, so nothing was taken out of the text before sending.',
    'removedLead': 'Taken out of the text before sending: ',
    'removedTail': '. The screen shows the message as you wrote it.',
    'kind.person.1': 'name', 'kind.person.n': 'names',
    'kind.email.1': 'e-mail address', 'kind.email.n': 'e-mail addresses',
    'kind.phone.1': 'phone number', 'kind.phone.n': 'phone numbers',
    'kind.hetu.1': 'identity code', 'kind.hetu.n': 'identity codes',
    'kind.iban.1': 'account number', 'kind.iban.n': 'account numbers',
    'kind.address.1': 'street address', 'kind.address.n': 'street addresses',
  },
};

/**
 * One string in the language in force, with its `{holes}` filled.
 * @param {string} key @param {string[]} langs @param {Record<string, any>} [values]
 * @returns {string}
 */
export function sayDecide(key, langs, values) {
  const map = {};
  for (const lang of Object.keys(DECIDE_WORDS)) {
    if (DECIDE_WORDS[lang][key] != null) map[lang] = DECIDE_WORDS[lang][key];
  }
  const got = pickLang(map, langs || []);
  const text = got ? String(got.text) : String(key);
  return text.replace(/\{([A-Za-z0-9_]+)\}/g, function (whole, name) {
    const v = values ? values[name] : undefined;
    return v == null ? whole : String(v);
  });
}
