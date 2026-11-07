/**
 * @file auth/pill-strings.js
 * @description The login pill's OWN labels, in the languages the node ships. The pill draws the
 *   language switch, so it is the one widget on the page that always knows which language the reader
 *   chose; before this it rendered "logged in / Logout" in English underneath a Spanish page, because
 *   the labels defaulted to English literals and only the SPA ever passed `opts.i18n`. Every app that
 *   declares `aimeat-locales` now gets the pill in the reader's language without passing anything.
 *
 *   Why a table rather than a fetch: locales/en.json is 479 kB, and loading half a megabyte on every
 *   app page for eleven words is not a trade worth making. These eleven strings are the pill cluster's
 *   entire vocabulary.
 *
 *   The English column matches `modal.*` in locales/en.json where a key exists there, EXCEPT
 *   `signInBtn`: the pill's button keeps the heart and the shorter wording it has always had, because
 *   it sits in a header row rather than in the modal. `federated`, `manageAccess`, `account` and
 *   `pageSettings` are pill-only and live here alone.
 * @structure PILL_STRINGS (en/fi/es) · pillStrings(lang)
 * @usage import { pillStrings } from './pill-strings.js';
 *   const i = Object.assign({}, pillStrings(lang), opts.i18n);   // a caller's strings always win
 * @version-history
 *   v1.5.0 — 2026-11-07 — The words of the pill's AI state (ai-state.js): the light, the bolt and its
 *     popup, and of the one-button light/dark switch (`toDark`, `toLight`).
 *   v1.4.0 — 2026-11-04 — `homeSettings`: where the name goes on a page that makes it a link, with the
 *     words of `home.settings.open` in locales/.
 *   v1.3.0 — 2026-09-24 — Themes & Styles: `lookThemes` and `lookStyles` name the picker's two groups,
 *     `styleLightOnly` and `styleDarkOnly` say why light/dark stands down for a style with one mode.
 *     `themeLabel` names the light/dark group "Light or dark": "theme" is the whole look now, one word
 *     for one thing. `lookStyles` says "Styles in this theme", because the built-in theme and its
 *     first style are both called AIMEAT; `modeOnly` is the word beside the kept mode's icon.
 *   v1.2.0 — 2026-09-13 — `pageSettings`: the name of the button a signed-out pill folds its
 *     language, light/dark and palette controls behind on a phone. The settled word in each
 *     language (Settings, Asetukset, Ajustes).
 *   v1.1.0 — 2026-09-05 — `fixedRegister`: what the light/dark control says on a page that keeps
 *     its own palette (a genre body), where the switch now stands down instead of doing nothing.
 *   v1.0.0 — 2026-08-13 — Initial. Born from a Spanish CADENCE showing an English "Logout".
 */

export var PILL_STRINGS = {
  en: {
    loggedIn: 'logged in', logoutBtn: 'Log out', signInBtn: '❤️ Sign In', account: 'Account',
    federated: 'Federated', manageAccess: 'Manage permissions',
    lightMode: 'Light mode', darkMode: 'Dark mode', themeLabel: 'Light or dark',
    autoMode: 'Automatic: follows your device', autoShort: 'Auto',
    fixedRegister: 'This register keeps its own light',
    styleLightOnly: 'This style has a light mode only', styleDarkOnly: 'This style has a dark mode only',
    lookThemes: 'Themes', lookStyles: 'Styles in this theme', modeOnly: 'only',
    chooseLook: 'Choose look', switchLanguage: 'Language', pageSettings: 'Settings',
    homeSettings: 'Home settings',
    toDark: 'Switch to dark', toLight: 'Switch to light',
    aiOn: 'Your AI is connected', aiOff: 'No AI connected yet', aiAgents: 'Agents: {n}',
    aiLatest: 'Last active: {name}', aiChat: 'The chat here is ready', aiConnect: 'Connect your AI',
    aiShow: 'Show connections', aiOwnStill: 'Your connected AI still works on its own subscription.',
    powerName: 'AI power', powerOk: 'AI power available', powerOver: "Today's limit is reached",
    powerNone: 'No AI power here', powerLeft: '{left} left today. Daily limit {limit}.',
    powerLeftNode: '{left} of your allowance left.', powerLow: 'Running low.',
    payerOwn: 'You pay with your own key.', payerNode: 'This node pays.', payerAgent: "The agent's own key pays.",
    canHead: 'What you can do now', needHead: 'This app uses',
    capVision: 'Read pictures', capImage: 'Make pictures',
    capTranscription: 'Speech to text', capSpeech: 'Text to speech',
    capOn: 'On', capOff: 'Off', aiSettings: 'AI settings',
    needRole: "Connect this app's AI roles in your AI settings.",
  },
  fi: {
    loggedIn: 'kirjautuneena', logoutBtn: 'Kirjaudu ulos', signInBtn: '❤️ Kirjaudu', account: 'Tili',
    federated: 'Federoitu', manageAccess: 'Hallitse oikeuksia',
    lightMode: 'Vaalea tila', darkMode: 'Tumma tila', themeLabel: 'Vaalea vai tumma',
    autoMode: 'Automaattinen: seuraa laitteesi asetusta', autoShort: 'Auto',
    fixedRegister: 'Tämä rekisteri pitää oman valonsa',
    styleLightOnly: 'Tällä tyylillä on vain vaalea tila', styleDarkOnly: 'Tällä tyylillä on vain tumma tila',
    lookThemes: 'Teemat', lookStyles: 'Tämän teeman tyylit', modeOnly: 'vain',
    chooseLook: 'Valitse tyyli', switchLanguage: 'Kieli', pageSettings: 'Asetukset',
    homeSettings: 'Kodin asetukset',
    toDark: 'Vaihda tummaan', toLight: 'Vaihda vaaleaan',
    aiOn: 'Tekoälysi on yhdistetty', aiOff: 'Tekoälyä ei ole vielä yhdistetty', aiAgents: 'Agentteja: {n}',
    aiLatest: 'Viimeksi käytössä: {name}', aiChat: 'Tämän noden chat on valmis', aiConnect: 'Yhdistä tekoäly',
    aiShow: 'Näytä yhteydet', aiOwnStill: 'Yhdistetty tekoälysi toimii silti omalla tilauksellaan.',
    powerName: 'Tekoälyvirta', powerOk: 'Tekoälyvirtaa on', powerOver: 'Päivän raja on täynnä',
    powerNone: 'Tekoälyvirtaa ei ole', powerLeft: '{left} jäljellä tänään. Päivän raja on {limit}.',
    powerLeftNode: 'Osuuttasi on jäljellä {left}.', powerLow: 'Virta on vähissä.',
    payerOwn: 'Maksat omalla avaimellasi.', payerNode: 'Node maksaa.', payerAgent: 'Agentin oma avain maksaa.',
    canHead: 'Mitä voit tehdä nyt', needHead: 'Tämä sovellus käyttää',
    capVision: 'Kuvan tulkinta', capImage: 'Kuvien teko',
    capTranscription: 'Kuuntelu (puhe tekstiksi)', capSpeech: 'Puhe (teksti ääneksi)',
    capOn: 'Käytössä', capOff: 'Ei käytössä', aiSettings: 'Tekoälyn asetukset',
    needRole: 'Yhdistä tämän sovelluksen tekoälyroolit tekoälyn asetuksissa.',
  },
  es: {
    loggedIn: 'sesión iniciada', logoutBtn: 'Cerrar sesión', signInBtn: '❤️ Entrar', account: 'Cuenta',
    federated: 'Federado', manageAccess: 'Gestionar permisos',
    lightMode: 'Modo claro', darkMode: 'Modo oscuro', themeLabel: 'Claro u oscuro',
    autoMode: 'Automático: sigue el ajuste de tu dispositivo', autoShort: 'Auto',
    fixedRegister: 'Este registro conserva su propia luz',
    styleLightOnly: 'Este estilo solo tiene modo claro', styleDarkOnly: 'Este estilo solo tiene modo oscuro',
    lookThemes: 'Temas', lookStyles: 'Estilos de este tema', modeOnly: 'solo',
    chooseLook: 'Elige el aspecto', switchLanguage: 'Idioma', pageSettings: 'Ajustes',
    homeSettings: 'Configuración del hogar',
    toDark: 'Cambiar a oscuro', toLight: 'Cambiar a claro',
    aiOn: 'Tu IA está conectada', aiOff: 'Aún no hay ninguna IA conectada', aiAgents: 'Agentes: {n}',
    aiLatest: 'Activa por última vez: {name}', aiChat: 'El chat de este nodo está listo', aiConnect: 'Conecta tu IA',
    aiShow: 'Ver conexiones', aiOwnStill: 'Tu IA conectada sigue funcionando con su propia suscripción.',
    powerName: 'Energía de IA', powerOk: 'Hay energía de IA', powerOver: 'Se alcanzó el límite de hoy',
    powerNone: 'No hay energía de IA aquí', powerLeft: 'Quedan {left} hoy. Límite diario: {limit}.',
    powerLeftNode: 'Te quedan {left} de tu asignación.', powerLow: 'Queda poca.',
    payerOwn: 'Pagas con tu propia clave.', payerNode: 'Paga este nodo.', payerAgent: 'Paga la clave propia del agente.',
    canHead: 'Qué puedes hacer ahora', needHead: 'Esta aplicación usa',
    capVision: 'Leer imágenes', capImage: 'Crear imágenes',
    capTranscription: 'Escuchar (voz a texto)', capSpeech: 'Hablar (texto a voz)',
    capOn: 'Activo', capOff: 'Inactivo', aiSettings: 'Ajustes de IA',
    needRole: 'Conecta los roles de IA de esta aplicación en tus ajustes de IA.',
  },
};

/** The pill's labels for one language, falling back to English per key. */
export function pillStrings(lang) {
  var base = PILL_STRINGS.en;
  var over = PILL_STRINGS[lang] || {};
  var out = {};
  for (var k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = over[k] || base[k];
  return out;
}
