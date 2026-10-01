/**
 * @file atelier/workflow-i18n.js
 * @description The words of the workflow answer component (workflowInput, workflow-input.js) in the
 *   kit's three languages. Each language is written in that language, with the words the Workflows
 *   page already ships (workflow: työnkulku / flujo de trabajo; test run: koeajo / ejecución de
 *   prueba). The keys carry the prefix `wf.`, and a host overrides any of them by defining the same
 *   key through i18n.use().
 *
 *   The export is twf, not tw: workspace-i18n.js already exports tw for the workspace components,
 *   and one name for two lookups would make a grep answer the wrong question.
 * @structure STRINGS (en/fi/es) · twf(key, vars): host override first, then this dictionary
 * @usage
 *   import { twf } from './workflow-i18n.js';
 *   twf('wf.answer');
 *   twf('wf.deadline', { when: '2 Oct 2026, 10:00' });
 * @version-history
 *   v0.61.0 — 2026-10-01 — Initial (the workflowInput block).
 */
import { i18n } from './i18n.js';

const STRINGS = {
  en: {
    'wf.title': 'Waiting for your answer',
    'wf.intro': 'A workflow stops at each of these steps until you answer. When you answer, the run goes on.',
    'wf.noLib': 'This block needs aimeat-workflows.js on the page.',
    'wf.signIn': 'Sign in to see the steps that wait for your answer.',
    'wf.loading': 'Loading…',
    'wf.none': 'Nothing is waiting for your answer.',
    'wf.noneRun': 'Nothing in this run is waiting for your answer.',
    'wf.untitled': 'A workflow',
    'wf.run': 'run {id}',
    'wf.testRun': 'test run',
    'wf.asked': 'Asked {when}',
    'wf.deadline': 'Answer by {when}',
    'wf.late': 'The time to answer ended {when}',
    'wf.pickOne': 'Choose one.',
    'wf.pickMany': 'Choose one or more.',
    'wf.other': 'Something else, in your words',
    'wf.otherOnly': 'Your answer',
    'wf.answer': 'Answer',
    'wf.needPick': 'Choose an answer first.',
    'wf.needPickOrText': 'Choose an answer or write your own first.',
    'wf.answered': '{workflow} has your answer. The run goes on.',
    'wf.gone': 'This step no longer waits for an answer: somebody answered it already, or its time ran out. The list is now up to date.',
    'wf.failed': 'Your answer did not go through: {why}',
    'wf.loadFailed': 'The waiting steps could not be read: {why}',
    'wf.sampleNote': 'A sample. Nothing is sent from here.',
    'wf.sample.wf1': 'Weekly newsletter',
    'wf.sample.header1': 'Review',
    'wf.sample.q1': 'The draft for this week is ready. Can it go out?',
    'wf.sample.send': 'Send it',
    'wf.sample.hold': 'Hold it for a week',
    'wf.sample.stop': 'Do not send',
    'wf.sample.wf2': 'Supplier check',
    'wf.sample.q2': 'Which suppliers get the new price list?',
    'wf.sample.s1': 'Northern Mill',
    'wf.sample.s2': 'Lake Bakery',
    'wf.sample.s3': 'Harbour Foods',
  },
  fi: {
    'wf.title': 'Odottaa vastaustasi',
    'wf.intro': 'Työnkulku pysähtyy näihin vaiheisiin ja odottaa, että vastaat. Kun vastaat, ajo jatkuu.',
    'wf.noLib': 'Tämä lohko tarvitsee sivulle aimeat-workflows.js-kirjaston.',
    'wf.signIn': 'Kirjaudu sisään, niin näet vaiheet, jotka odottavat vastaustasi.',
    'wf.loading': 'Ladataan…',
    'wf.none': 'Mikään ei odota vastaustasi.',
    'wf.noneRun': 'Mikään tämän ajon vaihe ei odota vastaustasi.',
    'wf.untitled': 'Työnkulku',
    'wf.run': 'ajo {id}',
    'wf.testRun': 'koeajo',
    'wf.asked': 'Kysytty {when}',
    'wf.deadline': 'Vastaa viimeistään {when}',
    'wf.late': 'Vastausaika päättyi {when}',
    'wf.pickOne': 'Valitse yksi.',
    'wf.pickMany': 'Valitse yksi tai useampi.',
    'wf.other': 'Jotain muuta, omin sanoin',
    'wf.otherOnly': 'Vastauksesi',
    'wf.answer': 'Vastaa',
    'wf.needPick': 'Valitse ensin vastaus.',
    'wf.needPickOrText': 'Valitse ensin vastaus tai kirjoita oma.',
    'wf.answered': '{workflow} sai vastauksesi. Ajo jatkuu.',
    'wf.gone': 'Tämä vaihe ei enää odota vastausta: joku vastasi siihen jo, tai vastausaika päättyi. Lista on nyt ajan tasalla.',
    'wf.failed': 'Vastauksesi ei mennyt perille: {why}',
    'wf.loadFailed': 'Odottavia vaiheita ei saatu luettua: {why}',
    'wf.sampleNote': 'Esimerkki. Täältä ei lähetetä mitään.',
    'wf.sample.wf1': 'Viikkokirje',
    'wf.sample.header1': 'Tarkistus',
    'wf.sample.q1': 'Tämän viikon luonnos on valmis. Voiko sen lähettää?',
    'wf.sample.send': 'Lähetä',
    'wf.sample.hold': 'Siirrä ensi viikkoon',
    'wf.sample.stop': 'Älä lähetä',
    'wf.sample.wf2': 'Toimittajien tarkistus',
    'wf.sample.q2': 'Kenelle toimittajille uusi hinnasto lähtee?',
    'wf.sample.s1': 'Pohjolan Mylly',
    'wf.sample.s2': 'Järvileipomo',
    'wf.sample.s3': 'Satamaruoka',
  },
  es: {
    'wf.title': 'Espera tu respuesta',
    'wf.intro': 'Un flujo de trabajo se detiene en cada uno de estos pasos hasta que respondes. Cuando respondes, la ejecución sigue.',
    'wf.noLib': 'Este bloque necesita aimeat-workflows.js en la página.',
    'wf.signIn': 'Inicia sesión para ver los pasos que esperan tu respuesta.',
    'wf.loading': 'Cargando…',
    'wf.none': 'Nada espera tu respuesta.',
    'wf.noneRun': 'Nada en esta ejecución espera tu respuesta.',
    'wf.untitled': 'Un flujo de trabajo',
    'wf.run': 'ejecución {id}',
    'wf.testRun': 'ejecución de prueba',
    'wf.asked': 'Preguntado {when}',
    'wf.deadline': 'Responde a más tardar {when}',
    'wf.late': 'El plazo para responder terminó {when}',
    'wf.pickOne': 'Elige una opción.',
    'wf.pickMany': 'Elige una o más opciones.',
    'wf.other': 'Otra cosa, con tus palabras',
    'wf.otherOnly': 'Tu respuesta',
    'wf.answer': 'Responder',
    'wf.needPick': 'Primero elige una respuesta.',
    'wf.needPickOrText': 'Primero elige una respuesta o escribe la tuya.',
    'wf.answered': '{workflow} recibió tu respuesta. La ejecución sigue.',
    'wf.gone': 'Este paso ya no espera respuesta: alguien ya respondió o se acabó el plazo. La lista ya está al día.',
    'wf.failed': 'Tu respuesta no se envió: {why}',
    'wf.loadFailed': 'No se pudieron leer los pasos en espera: {why}',
    'wf.sampleNote': 'Una muestra. Desde aquí no se envía nada.',
    'wf.sample.wf1': 'Boletín semanal',
    'wf.sample.header1': 'Revisión',
    'wf.sample.q1': 'El borrador de esta semana está listo. ¿Se puede enviar?',
    'wf.sample.send': 'Envíalo',
    'wf.sample.hold': 'Déjalo para la próxima semana',
    'wf.sample.stop': 'No lo envíes',
    'wf.sample.wf2': 'Revisión de proveedores',
    'wf.sample.q2': '¿Qué proveedores reciben la nueva lista de precios?',
    'wf.sample.s1': 'Molino del Norte',
    'wf.sample.s2': 'Panadería del Lago',
    'wf.sample.s3': 'Alimentos del Puerto',
  },
};

/**
 * The lookup of the workflow answer component: a host's own definition of the same key (through
 * i18n.use()) wins; otherwise this dictionary answers in the platform language, falling back to
 * English, then to the key.
 * @param {string} key  a key with its prefix `wf.`
 * @param {Record<string, any>} [vars]
 * @returns {string}
 */
export function twf(key, vars) {
  const hosted = i18n.t(key, vars);
  if (hosted !== key) return hosted;
  const lang = i18n.lang();
  const table = /** @type {Record<string, string>} */ (
    (STRINGS[/** @type {'en'|'fi'|'es'} */ (lang)] || STRINGS.en));
  const text = table[key] || STRINGS.en[key] || key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, function (whole, name) {
    return vars[name] == null ? whole : String(vars[name]);
  });
}

/** The keys of each language, for the parity test. @returns {Record<string, string[]>} */
export function workflowKeys() {
  return { en: Object.keys(STRINGS.en), fi: Object.keys(STRINGS.fi), es: Object.keys(STRINGS.es) };
}
