/**
 * @file atelier/ai-task-i18n.js
 * @description The words of the one-shot AI block (aiTask), the follow-up chat (aiChat) and the
 *   form's `model` field, in the kit's three languages. Each language is written in that language.
 *   The keys carry their own prefix (`aiTask.`, `aiChat.` or `modelField.`), and a host overrides
 *   any of them by defining the same key through i18n.use(). aiChat also uses the aiTask keys for
 *   the states the two blocks share (sample, no library, signed out, unavailable, busy, errors).
 * @structure STRINGS (en/fi/es) · tai(key, vars): host override first, then this dictionary
 * @usage
 *   import { tai } from './ai-task-i18n.js';
 *   tai('aiTask.run');
 *   tai('aiTask.needChars', { n: 20, m: 4 });
 * @version-history
 *   v0.64.0 — 2026-10-02 — aiTask.openSettings, the button to the person's AI settings.
 *   v0.63.0 — 2026-10-02 — aiTask.made (the date a result was made) and the aiChat words.
 *   v0.62.0 — 2026-10-01 — Initial: aiTask (every state, the error words per code) and the form's
 *     model field.
 */
import { i18n } from './i18n.js';

const STRINGS = {
  en: {
    'aiTask.title': 'Ask the AI',
    'aiTask.inputLabel': 'Your text',
    'aiTask.run': 'Ask the AI',
    'aiTask.checking': 'Checking whether your AI is ready…',
    'aiTask.running': 'The AI is working on the answer…',
    'aiTask.ready': 'The answer is ready.',
    'aiTask.needText': 'Write something first.',
    'aiTask.needChars': 'Write at least {n} characters. You have {m} now.',
    'aiTask.noLib': 'This block needs aimeat-ai.js on the page.',
    'aiTask.noLibCopy': 'AI is not connected on this page. Copy the prompt to your own AI chat, and paste the answer back here.',
    'aiTask.signIn': 'Sign in to ask your AI.',
    'aiTask.signInBtn': 'Sign in',
    'aiTask.off': 'Your AI is not ready for this app.',
    'aiTask.openSettings': 'Open AI settings',
    'aiTask.copyTitle': 'Or use your own AI chat',
    'aiTask.answer': 'The AI answer',
    'aiTask.model': 'Model: {model}',
    'aiTask.cost': 'AI use today: {spent} of {budget}',
    'aiTask.costNoCap': 'AI use today: {spent}',
    'aiTask.truncated': 'The answer stopped at the length limit, so it can be unfinished.',
    'aiTask.pasted': 'Pasted from your own AI chat.',
    'aiTask.made': 'Made {when}',
    'aiTask.sampleNote': 'A sample. Nothing is sent to an AI.',
    'aiTask.sampleAnswer': '**A sample answer.** When this block runs for real, the answer of the AI comes here. Above it is the label that says an AI made it. Under it are the model and what AI use cost today.',
    'aiTask.err.NO_API_KEY': 'No AI is set up for your account yet. Add one on the AI page of your AIMEAT profile.',
    'aiTask.err.INVALID_API_KEY': 'Your AI provider did not accept the key. Check the key on the AI page of your AIMEAT profile.',
    'aiTask.err.QUOTA_EXHAUSTED': 'You used all of today\'s AI budget. It starts again tomorrow, or you can make it larger on the AI page.',
    'aiTask.err.APP_QUOTA_EXHAUSTED': 'This app used all of its AI share for today. It starts again tomorrow, or you can make it larger on the AI page.',
    'aiTask.err.RATE_LIMITED': 'Your AI provider is busy now. Wait a moment and try again.',
    'aiTask.err.JSON_SCHEMA_MISMATCH': 'The AI answered, but not in the form this app needs. Try again.',
    'aiTask.err.generic': 'The AI request did not go through: {why}',
    'aiTask.err.noReason': 'The AI request did not go through.',
    'aiChat.title': 'Ask about this document',
    'aiChat.inputLabel': 'Your question',
    'aiChat.placeholder': 'Ask about the document',
    'aiChat.send': 'Ask',
    'aiChat.you': 'You',
    'aiChat.ai': 'AI',
    'aiChat.log': 'The conversation',
    'aiChat.empty': 'No questions yet. The AI answers from the document and from this conversation.',
    'aiChat.noContext': 'There is no document to ask about yet.',
    'aiChat.needText': 'Write a question first.',
    'aiChat.clear': 'Start over',
    'aiChat.sampleQuestion': 'What does the document say about the deadline?',
    'aiChat.sampleAnswer': '**A sample answer.** When this block runs for real, the AI answers here from the document and the conversation. Each answer has the label that says an AI made it.',
    'modelField.default': 'The default model',
    'modelField.loading': 'Reading the models…',
    'modelField.failed': 'The model list could not be read',
    'modelField.notListed': '{model} (not in your list)',
  },
  fi: {
    'aiTask.title': 'Kysy tekoälyltä',
    'aiTask.inputLabel': 'Tekstisi',
    'aiTask.run': 'Kysy tekoälyltä',
    'aiTask.checking': 'Tarkistan, onko tekoälysi käytettävissä…',
    'aiTask.running': 'Tekoäly kirjoittaa vastausta…',
    'aiTask.ready': 'Vastaus on valmis.',
    'aiTask.needText': 'Kirjoita ensin jotain.',
    'aiTask.needChars': 'Kirjoita vähintään {n} merkkiä. Nyt merkkejä on {m}.',
    'aiTask.noLib': 'Tämä lohko tarvitsee sivulle kirjaston aimeat-ai.js.',
    'aiTask.noLibCopy': 'Tekoäly ei ole käytössä tällä sivulla. Kopioi kehote omaan tekoälykeskusteluusi ja liitä vastaus tähän.',
    'aiTask.signIn': 'Kirjaudu sisään, niin voit kysyä tekoälyltäsi.',
    'aiTask.signInBtn': 'Kirjaudu sisään',
    'aiTask.off': 'Tekoälysi ei ole valmis tätä sovellusta varten.',
    'aiTask.openSettings': 'Avaa tekoälyasetukset',
    'aiTask.copyTitle': 'Tai käytä omaa tekoälykeskusteluasi',
    'aiTask.answer': 'Tekoälyn vastaus',
    'aiTask.model': 'Malli: {model}',
    'aiTask.cost': 'Tekoälyn käyttö tänään: {spent}, päiväraja {budget}',
    'aiTask.costNoCap': 'Tekoälyn käyttö tänään: {spent}',
    'aiTask.truncated': 'Vastaus katkesi pituusrajaan, joten se voi olla kesken.',
    'aiTask.pasted': 'Liitetty omasta tekoälykeskustelustasi.',
    'aiTask.made': 'Tehty {when}',
    'aiTask.sampleNote': 'Esimerkki. Mitään ei lähetetä tekoälylle.',
    'aiTask.sampleAnswer': '**Esimerkkivastaus.** Kun lohko on oikeasti käytössä, tähän tulee tekoälyn vastaus. Sen yläpuolella on merkintä, joka kertoo, että vastauksen teki tekoäly. Alla näkyvät malli ja päivän tekoälykulut.',
    'aiTask.err.NO_API_KEY': 'Tilillesi ei ole vielä asetettu tekoälyä. Lisää se AIMEAT-profiilisi tekoälysivulla.',
    'aiTask.err.INVALID_API_KEY': 'Tekoälyn tarjoaja ei hyväksynyt avaintasi. Tarkista avain AIMEAT-profiilisi tekoälysivulla.',
    'aiTask.err.QUOTA_EXHAUSTED': 'Olet käyttänyt koko tämän päivän tekoälybudjetin. Budjetti alkaa huomenna alusta, tai voit suurentaa sitä tekoälysivulla.',
    'aiTask.err.APP_QUOTA_EXHAUSTED': 'Tämä sovellus on käyttänyt koko tämän päivän tekoälyosuutensa. Osuus alkaa huomenna alusta, tai voit suurentaa sitä tekoälysivulla.',
    'aiTask.err.RATE_LIMITED': 'Tekoälyn tarjoaja on nyt kiireinen. Odota hetki ja yritä uudelleen.',
    'aiTask.err.JSON_SCHEMA_MISMATCH': 'Tekoäly vastasi, mutta ei siinä muodossa, jota sovellus tarvitsee. Yritä uudelleen.',
    'aiTask.err.generic': 'Tekoälypyyntö ei onnistunut: {why}',
    'aiTask.err.noReason': 'Tekoälypyyntö ei onnistunut.',
    'aiChat.title': 'Kysy tästä asiakirjasta',
    'aiChat.inputLabel': 'Kysymyksesi',
    'aiChat.placeholder': 'Kysy asiakirjasta',
    'aiChat.send': 'Kysy',
    'aiChat.you': 'Sinä',
    'aiChat.ai': 'Tekoäly',
    'aiChat.log': 'Keskustelu',
    'aiChat.empty': 'Kysymyksiä ei ole vielä. Tekoäly vastaa asiakirjan ja tämän keskustelun perusteella.',
    'aiChat.noContext': 'Asiakirjaa ei ole vielä, joten siitä ei voi kysyä.',
    'aiChat.needText': 'Kirjoita ensin kysymys.',
    'aiChat.clear': 'Aloita alusta',
    'aiChat.sampleQuestion': 'Mitä asiakirjassa sanotaan määräajasta?',
    'aiChat.sampleAnswer': '**Esimerkkivastaus.** Kun lohko on oikeasti käytössä, tekoäly vastaa tähän asiakirjan ja keskustelun perusteella. Jokaisessa vastauksessa on merkintä, joka kertoo, että vastauksen teki tekoäly.',
    'modelField.default': 'Oletusmalli',
    'modelField.loading': 'Haen malleja…',
    'modelField.failed': 'Malliluetteloa ei saatu luettua',
    'modelField.notListed': '{model} (ei listallasi)',
  },
  es: {
    'aiTask.title': 'Pregúntale a la IA',
    'aiTask.inputLabel': 'Tu texto',
    'aiTask.run': 'Preguntar a la IA',
    'aiTask.checking': 'Revisando si tu IA está lista…',
    'aiTask.running': 'La IA está escribiendo la respuesta…',
    'aiTask.ready': 'La respuesta está lista.',
    'aiTask.needText': 'Primero escribe algo.',
    'aiTask.needChars': 'Escribe al menos {n} caracteres. Llevas {m}.',
    'aiTask.noLib': 'Este bloque necesita aimeat-ai.js en la página.',
    'aiTask.noLibCopy': 'La IA no está conectada en esta página. Copia la instrucción en tu propio chat de IA y pega aquí la respuesta.',
    'aiTask.signIn': 'Inicia sesión para preguntarle a tu IA.',
    'aiTask.signInBtn': 'Iniciar sesión',
    'aiTask.off': 'Tu IA no está lista para esta app.',
    'aiTask.openSettings': 'Abrir los ajustes de IA',
    'aiTask.copyTitle': 'O usa tu propio chat de IA',
    'aiTask.answer': 'Respuesta de la IA',
    'aiTask.model': 'Modelo: {model}',
    'aiTask.cost': 'Uso de IA hoy: {spent} de {budget}',
    'aiTask.costNoCap': 'Uso de IA hoy: {spent}',
    'aiTask.truncated': 'La respuesta se cortó en el límite de longitud, así que puede estar incompleta.',
    'aiTask.pasted': 'Pegada desde tu propio chat de IA.',
    'aiTask.made': 'Hecha el {when}',
    'aiTask.sampleNote': 'Un ejemplo. No se envía nada a una IA.',
    'aiTask.sampleAnswer': '**Una respuesta de ejemplo.** Cuando este bloque funcione de verdad, aquí aparece la respuesta de la IA. Arriba va la etiqueta que dice que la hizo una IA. Abajo van el modelo y lo que costó hoy el uso de IA.',
    'aiTask.err.NO_API_KEY': 'Tu cuenta todavía no tiene una IA configurada. Agrégala en la página de IA de tu perfil de AIMEAT.',
    'aiTask.err.INVALID_API_KEY': 'Tu proveedor de IA no aceptó la clave. Revísala en la página de IA de tu perfil de AIMEAT.',
    'aiTask.err.QUOTA_EXHAUSTED': 'Ya usaste todo el presupuesto de IA de hoy. Vuelve a empezar mañana, o puedes subirlo en la página de IA.',
    'aiTask.err.APP_QUOTA_EXHAUSTED': 'Esta app ya usó toda su parte de IA de hoy. Vuelve a empezar mañana, o puedes subirla en la página de IA.',
    'aiTask.err.RATE_LIMITED': 'Tu proveedor de IA está ocupado ahora. Espera un momento y vuelve a intentarlo.',
    'aiTask.err.JSON_SCHEMA_MISMATCH': 'La IA respondió, pero no en la forma que esta app necesita. Vuelve a intentarlo.',
    'aiTask.err.generic': 'La solicitud a la IA no se completó: {why}',
    'aiTask.err.noReason': 'La solicitud a la IA no se completó.',
    'aiChat.title': 'Pregunta sobre este documento',
    'aiChat.inputLabel': 'Tu pregunta',
    'aiChat.placeholder': 'Pregunta algo sobre el documento',
    'aiChat.send': 'Preguntar',
    'aiChat.you': 'Tú',
    'aiChat.ai': 'IA',
    'aiChat.log': 'La conversación',
    'aiChat.empty': 'Todavía no hay preguntas. La IA responde a partir del documento y de esta conversación.',
    'aiChat.noContext': 'Todavía no hay un documento sobre el cual preguntar.',
    'aiChat.needText': 'Primero escribe una pregunta.',
    'aiChat.clear': 'Empezar de nuevo',
    'aiChat.sampleQuestion': '¿Qué dice el documento sobre la fecha límite?',
    'aiChat.sampleAnswer': '**Una respuesta de ejemplo.** Cuando este bloque funcione de verdad, la IA responde aquí a partir del documento y de la conversación. Cada respuesta lleva la etiqueta que dice que la hizo una IA.',
    'modelField.default': 'El modelo predeterminado',
    'modelField.loading': 'Cargando los modelos…',
    'modelField.failed': 'No se pudo leer la lista de modelos',
    'modelField.notListed': '{model} (no está en tu lista)',
  },
};

/**
 * The lookup of the AI block and the model field: a host's own definition of the same key (through
 * i18n.use()) wins; otherwise this dictionary answers in the platform language, falling back to
 * English, then to the key.
 * @param {string} key  a key with its prefix, `aiTask.`, `aiChat.` or `modelField.`
 * @param {Record<string, any>} [vars]
 * @returns {string}
 */
export function tai(key, vars) {
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

/** Every key of a language, for the parity test. @param {'en'|'fi'|'es'} lang @returns {string[]} */
export function aiTaskKeys(lang) {
  return Object.keys(STRINGS[lang] || {});
}
