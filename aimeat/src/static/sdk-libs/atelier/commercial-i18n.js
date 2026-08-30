/**
 * @file atelier/commercial-i18n.js
 * @description The commercial components' own words, in the kit's three languages — the legal
 *   kinds with the reason each page exists (mirroring services/app-legal.ts LEGAL_KIND_INFO, so
 *   the words a builder sees are the words the law review produced), the readiness sentences,
 *   and the strings of the audit trail, the feedback form, the reviewer line and the marks
 *   switches. Kept beside commercial.js under the 800-line rule.
 *
 *   Each language is written in that language, not as translated English. A host overrides any
 *   of these by defining the same key under the `commercial.` prefix in i18n.use().
 * @structure STRINGS (en/fi/es) · tc(key, vars) — host override first, then this dictionary
 * @usage
 *   import { tc } from './commercial-i18n.js';
 *   tc('kind.privacy.title');
 * @version-history
 *   v0.38.0 — 2026-08-30 — Initial (the commercial side arrives in the kit).
 */
import { i18n } from './i18n.js';

const STRINGS = {
  en: {
    'legal.title': 'The pages this app answers with',
    'legal.intro': 'These pages are the app’s own, written by its owner. The app answers for what it does; the node it runs on has its own terms, which cover the node and not this app.',
    'legal.open': 'Open',
    'legal.missing': 'Still to write',
    'legal.none': 'Not written',
    'legal.loadFailed': 'The legal pages could not be read right now.',
    'legal.readinessSells': 'This app sells something, so it answers for the sale: who is selling, on what terms, how to withdraw, how the data is handled, and how the shop can be used by everyone.',
    'legal.readinessPlain': 'A published app answers for its own terms and for the personal data it handles.',
    'legal.readinessMissing': '{n} of those pages are still to write.',
    'legal.readinessOk': 'Every recommended page exists.',
    'kind.terms.title': 'Terms of use',
    'kind.terms.why': 'The contract between the app and the person using it. Every app store asks for it; a shop or a paid tool cannot do without it.',
    'kind.privacy.title': 'Privacy notice',
    'kind.privacy.why': 'What personal data the app handles, why, for how long, who else sees it and how to reach whoever answers for it (GDPR Art. 13).',
    'kind.imprint.title': 'Imprint',
    'kind.imprint.why': 'Who is behind this app: name, address, contact, trade register where there is one.',
    'kind.refunds.title': 'Refunds and withdrawal',
    'kind.refunds.why': 'The 14-day right of withdrawal and how a refund works, for an app that sells anything.',
    'kind.accessibility.title': 'Accessibility statement',
    'kind.accessibility.why': 'How the app meets accessibility requirements. The European Accessibility Act asks this of e-commerce services.',
    'kind.cookies.title': 'Cookies and browser storage',
    'kind.cookies.why': 'What the app keeps in the browser and why, when it keeps anything beyond what running requires.',
    'kind.support.title': 'Support',
    'kind.support.why': 'How to reach whoever answers for the app.',
    'chip.pages': '{n} legal pages still to write',
    'frame.updated': 'Published by {who} for the app “{app}”. Updated {date}.',
    'frame.footer': 'This page is written and published by the app’s owner, who answers for the app and for what this page says. The node it runs on has its own terms, which cover the node and not this app.',
    'audit.title': 'What happened',
    'audit.intro': 'An append-only trail. Rows are written as things happen and never rewritten.',
    'audit.empty': 'Nothing recorded yet.',
    'audit.loadFailed': 'The trail could not be read.',
    'audit.twoHands': 'Two hands open this trail: the organism names the app in the row space, and you approve the organism:rows scope at sign-in.',
    'audit.more': 'Show {n} more',
    'feedback.title': 'Leave feedback',
    'feedback.topic': 'Topic',
    'feedback.message': 'Message',
    'feedback.contact': 'How to reach you (optional)',
    'feedback.send': 'Send',
    'feedback.sent': 'Thank you. Your message went through.',
    'feedback.failed': 'That did not go through.',
    'feedback.messageRequired': 'A message is needed.',
    'reviewer.line': 'Reviewed by {name}, who answers for this app.',
    'reviewer.lifts': 'A named review lifts the visible AI-content label where the law allows it; a notice that you are interacting with an AI is never lifted.',
    'reviewer.law': 'EU AI Act, Article 50',
    'marks.title': 'Marks on the served app',
    'marks.badge': 'The “publish your own app” badge',
    'marks.badgeOn': 'Shown on the served app.',
    'marks.badgeOff': 'Hidden.',
    'marks.install': 'The browser install offer',
    'marks.installOn': 'Offered on the served app.',
    'marks.installOff': 'Hidden.',
    'marks.turnOn': 'Turn on',
    'marks.turnOff': 'Turn off',
    'marks.ownerOnly': 'These switches belong to the app’s owner.',
    'marks.saveFailed': 'The change did not go through.',
  },
  fi: {
    'legal.title': 'Sivut joilla tämä sovellus vastaa',
    'legal.intro': 'Nämä sivut ovat sovelluksen omia, sen omistajan kirjoittamia. Sovellus vastaa siitä mitä se tekee; noodilla jolla se pyörii on omat ehtonsa, jotka koskevat noodia eivätkä tätä sovellusta.',
    'legal.open': 'Avaa',
    'legal.missing': 'Kirjoittamatta',
    'legal.none': 'Ei kirjoitettu',
    'legal.loadFailed': 'Lakisivuja ei juuri nyt saatu luettua.',
    'legal.readinessSells': 'Tämä sovellus myy jotain, joten se vastaa kaupasta: kuka myy, millä ehdoilla, miten kaupan saa purettua, miten tietoja käsitellään ja miten kauppa on kaikkien käytettävissä.',
    'legal.readinessPlain': 'Julkaistu sovellus vastaa omista ehdoistaan ja käsittelemästään henkilötiedosta.',
    'legal.readinessMissing': 'Noista sivuista {n} on vielä kirjoittamatta.',
    'legal.readinessOk': 'Kaikki suositellut sivut ovat olemassa.',
    'kind.terms.title': 'Käyttöehdot',
    'kind.terms.why': 'Sopimus sovelluksen ja sen käyttäjän välillä. Jokainen sovelluskauppa kysyy sitä; kauppa tai maksullinen työkalu ei pärjää ilman.',
    'kind.privacy.title': 'Tietosuojaseloste',
    'kind.privacy.why': 'Mitä henkilötietoa sovellus käsittelee, miksi, kuinka kauan, kuka muu sen näkee ja miten tavoittaa se joka siitä vastaa (GDPR 13 art.).',
    'kind.imprint.title': 'Yhteystiedot ja vastuutaho',
    'kind.imprint.why': 'Kuka tämän sovelluksen takana on: nimi, osoite, yhteystiedot, kaupparekisteri jos sellainen on.',
    'kind.refunds.title': 'Palautukset ja peruuttaminen',
    'kind.refunds.why': '14 päivän peruuttamisoikeus ja miten palautus toimii, kun sovellus myy jotain.',
    'kind.accessibility.title': 'Saavutettavuusseloste',
    'kind.accessibility.why': 'Miten sovellus täyttää saavutettavuusvaatimukset. Esteettömyysdirektiivi vaatii tätä verkkokaupoilta.',
    'kind.cookies.title': 'Evästeet ja selaimen muisti',
    'kind.cookies.why': 'Mitä sovellus säilyttää selaimessa ja miksi, jos se säilyttää jotain muutakin kuin toimintansa vaatiman.',
    'kind.support.title': 'Tuki',
    'kind.support.why': 'Miten tavoittaa se joka sovelluksesta vastaa.',
    'chip.pages': '{n} lakisivua vielä kirjoittamatta',
    'frame.updated': 'Julkaisija {who}, sovellukselle ”{app}”. Päivitetty {date}.',
    'frame.footer': 'Tämän sivun on kirjoittanut ja julkaissut sovelluksen omistaja, joka vastaa sovelluksesta ja tämän sivun sisällöstä. Noodilla jolla sovellus pyörii on omat ehtonsa, jotka koskevat noodia eivätkä tätä sovellusta.',
    'audit.title': 'Mitä tapahtui',
    'audit.intro': 'Vain lisättävä loki. Rivit kirjoitetaan kun asiat tapahtuvat, eikä niitä koskaan kirjoiteta uusiksi.',
    'audit.empty': 'Ei vielä kirjauksia.',
    'audit.loadFailed': 'Lokia ei saatu luettua.',
    'audit.twoHands': 'Tämän lokin avaa kaksi kättä: organismi nimeää sovelluksen rivitilaansa, ja sinä hyväksyt organism:rows-oikeuden kirjautuessasi.',
    'audit.more': 'Näytä {n} lisää',
    'feedback.title': 'Anna palautetta',
    'feedback.topic': 'Aihe',
    'feedback.message': 'Viesti',
    'feedback.contact': 'Miten sinut tavoittaa (valinnainen)',
    'feedback.send': 'Lähetä',
    'feedback.sent': 'Kiitos. Viestisi meni perille.',
    'feedback.failed': 'Lähetys ei mennyt läpi.',
    'feedback.messageRequired': 'Viesti tarvitaan.',
    'reviewer.line': 'Tarkastanut {name}, joka vastaa tästä sovelluksesta.',
    'reviewer.lifts': 'Nimetty tarkastus poistaa näkyvän tekoälysisältö-merkinnän siellä missä laki sen sallii; ilmoitusta siitä että keskustelet tekoälyn kanssa ei poisteta koskaan.',
    'reviewer.law': 'EU:n tekoälyasetus, 50 artikla',
    'marks.title': 'Merkit tarjoillussa sovelluksessa',
    'marks.badge': '”Julkaise oma sovellus” -merkki',
    'marks.badgeOn': 'Näkyy tarjoillussa sovelluksessa.',
    'marks.badgeOff': 'Piilotettu.',
    'marks.install': 'Selaimen asennustarjous',
    'marks.installOn': 'Tarjotaan tarjoillussa sovelluksessa.',
    'marks.installOff': 'Piilotettu.',
    'marks.turnOn': 'Kytke päälle',
    'marks.turnOff': 'Kytke pois',
    'marks.ownerOnly': 'Nämä kytkimet kuuluvat sovelluksen omistajalle.',
    'marks.saveFailed': 'Muutos ei mennyt läpi.',
  },
  es: {
    'legal.title': 'Las páginas con las que responde esta app',
    'legal.intro': 'Estas páginas son de la propia app, escritas por su dueño. La app responde por lo que hace; el nodo donde corre tiene sus propios términos, que cubren el nodo y no esta app.',
    'legal.open': 'Abrir',
    'legal.missing': 'Por escribir',
    'legal.none': 'Sin escribir',
    'legal.loadFailed': 'Las páginas legales no se pudieron leer ahora mismo.',
    'legal.readinessSells': 'Esta app vende algo, así que responde por la venta: quién vende, con qué condiciones, cómo desistir, cómo se tratan los datos y cómo puede usar la tienda todo el mundo.',
    'legal.readinessPlain': 'Una app publicada responde por sus propios términos y por los datos personales que maneja.',
    'legal.readinessMissing': 'De esas páginas, {n} siguen por escribir.',
    'legal.readinessOk': 'Todas las páginas recomendadas existen.',
    'kind.terms.title': 'Condiciones de uso',
    'kind.terms.why': 'El contrato entre la app y la persona que la usa. Todas las tiendas de apps lo piden; una tienda o una herramienta de pago no puede prescindir de él.',
    'kind.privacy.title': 'Aviso de privacidad',
    'kind.privacy.why': 'Qué datos personales maneja la app, por qué, cuánto tiempo, quién más los ve y cómo llegar a quien responde por ello (art. 13 del RGPD).',
    'kind.imprint.title': 'Aviso legal',
    'kind.imprint.why': 'Quién está detrás de esta app: nombre, dirección, contacto, registro mercantil si lo hay.',
    'kind.refunds.title': 'Devoluciones y desistimiento',
    'kind.refunds.why': 'El derecho de desistimiento de 14 días y cómo funciona una devolución, para una app que vende algo.',
    'kind.accessibility.title': 'Declaración de accesibilidad',
    'kind.accessibility.why': 'Cómo cumple la app los requisitos de accesibilidad. La ley europea de accesibilidad lo pide al comercio electrónico.',
    'kind.cookies.title': 'Cookies y almacenamiento del navegador',
    'kind.cookies.why': 'Qué guarda la app en el navegador y por qué, cuando guarda algo más de lo que su funcionamiento exige.',
    'kind.support.title': 'Soporte',
    'kind.support.why': 'Cómo llegar a quien responde por la app.',
    'chip.pages': '{n} páginas legales siguen por escribir',
    'frame.updated': 'Publicado por {who} para la app “{app}”. Actualizado {date}.',
    'frame.footer': 'Esta página la escribe y publica el dueño de la app, que responde por la app y por lo que dice esta página. El nodo donde corre tiene sus propios términos, que cubren el nodo y no esta app.',
    'audit.title': 'Qué pasó',
    'audit.intro': 'Un registro solo de añadir. Las filas se escriben cuando las cosas pasan y nunca se reescriben.',
    'audit.empty': 'Todavía no hay registros.',
    'audit.loadFailed': 'El registro no se pudo leer.',
    'audit.twoHands': 'Este registro lo abren dos manos: el organismo nombra la app en su espacio de filas, y tú apruebas el permiso organism:rows al iniciar sesión.',
    'audit.more': 'Mostrar {n} más',
    'feedback.title': 'Deja tu opinión',
    'feedback.topic': 'Tema',
    'feedback.message': 'Mensaje',
    'feedback.contact': 'Cómo contactarte (opcional)',
    'feedback.send': 'Enviar',
    'feedback.sent': 'Gracias. Tu mensaje llegó.',
    'feedback.failed': 'No se pudo enviar.',
    'feedback.messageRequired': 'Hace falta un mensaje.',
    'reviewer.line': 'Revisado por {name}, que responde por esta app.',
    'reviewer.lifts': 'Una revisión con nombre levanta la etiqueta visible de contenido de IA donde la ley lo permite; el aviso de que interactúas con una IA no se levanta nunca.',
    'reviewer.law': 'Reglamento europeo de IA, artículo 50',
    'marks.title': 'Marcas en la app servida',
    'marks.badge': 'La insignia “publica tu propia app”',
    'marks.badgeOn': 'Se muestra en la app servida.',
    'marks.badgeOff': 'Oculta.',
    'marks.install': 'La oferta de instalación del navegador',
    'marks.installOn': 'Se ofrece en la app servida.',
    'marks.installOff': 'Oculta.',
    'marks.turnOn': 'Activar',
    'marks.turnOff': 'Desactivar',
    'marks.ownerOnly': 'Estos interruptores pertenecen al dueño de la app.',
    'marks.saveFailed': 'El cambio no se aplicó.',
  },
};

/**
 * The commercial components' lookup: the host may override any key by defining
 * `commercial.<key>` through i18n.use(); otherwise this dictionary answers in the platform
 * language, falling back to English, then to the key.
 * @param {string} key
 * @param {Record<string, any>} [vars]
 * @returns {string}
 */
export function tc(key, vars) {
  const hosted = i18n.t('commercial.' + key, vars);
  if (hosted !== 'commercial.' + key) return hosted;
  const lang = i18n.lang();
  const table = /** @type {Record<string, string>} */ (
    (STRINGS[/** @type {'en'|'fi'|'es'} */ (lang)] || STRINGS.en));
  const text = table[key] || STRINGS.en[key] || key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, function (whole, name) {
    return vars[name] == null ? whole : String(vars[name]);
  });
}
