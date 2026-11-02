/**
 * @file atelier/fingerprint-i18n.js
 * @description The words of the fingerprint (fingerprint.js) in the kit's three languages: the six
 *   kinds of text, the four marks, the six axes' two ends, the twelve zone names of the three default
 *   views, and the lines around them. Each language is written in that language. A host overrides any
 *   key by defining it under the `fingerprint.` prefix in i18n.use().
 * @structure STRINGS (en/fi/es) · tf(key, vars) — host override first, then this dictionary
 * @usage
 *   import { tf } from './fingerprint-i18n.js';
 *   tf('genre.F');   // a host overrides it as i18n 'fingerprint.genre.F'
 * @version-history
 *   v0.69.0 — 2026-11-02 — Initial (wish-aineiston-sormenj-lki-millaista-aineisto-on-yhdell-silm-ykse).
 */
import { i18n } from './i18n.js';

const STRINGS = {
  en: {
    'genre.F': 'Fact', 'genre.A': 'Analysis', 'genre.M': 'Opinion', 'genre.O': 'Instruction', 'genre.P': 'Decision or plan', 'genre.K': 'Narrative',
    'mark.+': 'source given', 'mark.~': 'a person or meeting stands behind it', 'mark.?': 'no grounds', 'mark.x': 'contradicted or replaced',
    'axis.fakta.lo': 'Opinion', 'axis.fakta.hi': 'Fact', 'axis.fakta.short': 'Fact',
    'axis.konkr.lo': 'Abstract', 'axis.konkr.hi': 'Concrete', 'axis.konkr.short': 'Concrete',
    'axis.aika.lo': 'Past', 'axis.aika.hi': 'Future', 'axis.aika.short': 'Future',
    'axis.toim.lo': 'Describes', 'axis.toim.hi': 'Directs action', 'axis.toim.short': 'Action',
    'axis.yks.lo': 'Overview', 'axis.yks.hi': 'Detail', 'axis.yks.short': 'Detail',
    'axis.varm.lo': 'Guess', 'axis.varm.hi': 'Certain', 'axis.varm.short': 'Certain',
    'zone.konkr|fakta.0': 'Principles and theory', 'zone.konkr|fakta.1': 'Measured fact', 'zone.konkr|fakta.2': 'Views and visions', 'zone.konkr|fakta.3': 'Examples and experience',
    'zone.aika|toim.0': 'Lessons and fixes', 'zone.aika|toim.1': 'Plans and tasks', 'zone.aika|toim.2': 'History and reporting', 'zone.aika|toim.3': 'Forecast and vision',
    'zone.yks|varm.0': 'Settled overview', 'zone.yks|varm.1': 'Precise knowledge', 'zone.yks|varm.2': 'General estimate', 'zone.yks|varm.3': 'Seeming precision',
    'grid.konkr|fakta': 'What it is', 'grid.aika|toim': 'Where it points', 'grid.yks|varm': 'How precise, how certain', 'grid.own': 'Your own view',
    'zoneJoin': '{a} and {b}',
    'barcode': 'Sections', 'trust': 'Can it be trusted', 'leaning': 'Leaning', 'topics': 'Topics', 'kind': 'Kind',
    'profiledBy': 'Profiled by {model} on {date}', 'truncated': 'from the first {n} characters',
    'words': '{n} words', 'certainty': 'certainty {p} %', 'topic': 'Topic: {name}', 'share': 'share {p} %', 'sectionsOf': 'Sections: {list}',
    'x': 'X', 'y': 'Y', 'seal': 'Fingerprint',
    'empty': 'This item has no fingerprint yet.', 'emptyHint': 'It is made when the profile step is on.',
  },
  fi: {
    'genre.F': 'Fakta', 'genre.A': 'Analyysi', 'genre.M': 'Mielipide', 'genre.O': 'Ohje', 'genre.P': 'Päätös tai suunnitelma', 'genre.K': 'Kertomus',
    'mark.+': 'lähde mukana', 'mark.~': 'ihminen tai kokous takana', 'mark.?': 'ei perustetta', 'mark.x': 'ristiriidassa tai kumottu',
    'axis.fakta.lo': 'Mielipide', 'axis.fakta.hi': 'Fakta', 'axis.fakta.short': 'Fakta',
    'axis.konkr.lo': 'Abstrakti', 'axis.konkr.hi': 'Konkreettinen', 'axis.konkr.short': 'Konkr.',
    'axis.aika.lo': 'Mennyt', 'axis.aika.hi': 'Tuleva', 'axis.aika.short': 'Tuleva',
    'axis.toim.lo': 'Kuvaileva', 'axis.toim.hi': 'Ohjaa toimintaan', 'axis.toim.short': 'Toiminta',
    'axis.yks.lo': 'Yleiskuva', 'axis.yks.hi': 'Yksityiskohta', 'axis.yks.short': 'Tarkkuus',
    'axis.varm.lo': 'Arvaus', 'axis.varm.hi': 'Varma', 'axis.varm.short': 'Varmuus',
    'zone.konkr|fakta.0': 'Periaatteet ja teoria', 'zone.konkr|fakta.1': 'Mitattu tieto', 'zone.konkr|fakta.2': 'Näkemykset ja visiot', 'zone.konkr|fakta.3': 'Esimerkit ja kokemukset',
    'zone.aika|toim.0': 'Opit ja korjaukset', 'zone.aika|toim.1': 'Suunnitelma ja tehtävät', 'zone.aika|toim.2': 'Historia ja raportointi', 'zone.aika|toim.3': 'Ennuste ja visio',
    'zone.yks|varm.0': 'Vakiintunut yleiskuva', 'zone.yks|varm.1': 'Tarkka tieto', 'zone.yks|varm.2': 'Yleinen arvio', 'zone.yks|varm.3': 'Näennäinen tarkkuus',
    'grid.konkr|fakta': 'Mitä se on', 'grid.aika|toim': 'Mihin se suuntaa', 'grid.yks|varm': 'Kuinka tarkka, kuinka varma', 'grid.own': 'Oma nelikenttä',
    'zoneJoin': '{a} ja {b}',
    'barcode': 'Osiot', 'trust': 'Voiko luottaa', 'leaning': 'Painopiste', 'topics': 'Aiheet', 'kind': 'Laji',
    'profiledBy': 'Profiloinut {model}, {date}', 'truncated': 'luettu ensimmäiset {n} merkkiä',
    'words': '{n} sanaa', 'certainty': 'varmuus {p} %', 'topic': 'Aihe: {name}', 'share': 'osuus {p} %', 'sectionsOf': 'Osiot: {list}',
    'x': 'X', 'y': 'Y', 'seal': 'Sormenjälki',
    'empty': 'Tällä aineistolla ei ole vielä sormenjälkeä.', 'emptyHint': 'Sormenjälki tehdään, kun profiilivaihe on päällä.',
  },
  es: {
    'genre.F': 'Hecho', 'genre.A': 'Análisis', 'genre.M': 'Opinión', 'genre.O': 'Instrucción', 'genre.P': 'Decisión o plan', 'genre.K': 'Relato',
    'mark.+': 'fuente indicada', 'mark.~': 'lo respalda una persona o una reunión', 'mark.?': 'sin fundamento', 'mark.x': 'contradicho o sustituido',
    'axis.fakta.lo': 'Opinión', 'axis.fakta.hi': 'Hecho', 'axis.fakta.short': 'Hecho',
    'axis.konkr.lo': 'Abstracto', 'axis.konkr.hi': 'Concreto', 'axis.konkr.short': 'Concreto',
    'axis.aika.lo': 'Pasado', 'axis.aika.hi': 'Futuro', 'axis.aika.short': 'Futuro',
    'axis.toim.lo': 'Describe', 'axis.toim.hi': 'Orienta a la acción', 'axis.toim.short': 'Acción',
    'axis.yks.lo': 'Visión general', 'axis.yks.hi': 'Detalle', 'axis.yks.short': 'Detalle',
    'axis.varm.lo': 'Suposición', 'axis.varm.hi': 'Seguro', 'axis.varm.short': 'Seguridad',
    'zone.konkr|fakta.0': 'Principios y teoría', 'zone.konkr|fakta.1': 'Datos medidos', 'zone.konkr|fakta.2': 'Opiniones y visiones', 'zone.konkr|fakta.3': 'Ejemplos y experiencias',
    'zone.aika|toim.0': 'Lecciones y correcciones', 'zone.aika|toim.1': 'Planes y tareas', 'zone.aika|toim.2': 'Historia e informes', 'zone.aika|toim.3': 'Previsión y visión',
    'zone.yks|varm.0': 'Visión consolidada', 'zone.yks|varm.1': 'Conocimiento preciso', 'zone.yks|varm.2': 'Estimación general', 'zone.yks|varm.3': 'Precisión aparente',
    'grid.konkr|fakta': 'Qué es', 'grid.aika|toim': 'Hacia dónde apunta', 'grid.yks|varm': 'Cuán preciso, cuán seguro', 'grid.own': 'Vista propia',
    'zoneJoin': '{a} y {b}',
    'barcode': 'Secciones', 'trust': '¿Es fiable?', 'leaning': 'Orientación', 'topics': 'Temas', 'kind': 'Tipo',
    'profiledBy': 'Perfilado por {model} el {date}', 'truncated': 'de los primeros {n} caracteres',
    'words': '{n} palabras', 'certainty': 'seguridad {p} %', 'topic': 'Tema: {name}', 'share': 'proporción {p} %', 'sectionsOf': 'Secciones: {list}',
    'x': 'X', 'y': 'Y', 'seal': 'Huella',
    'empty': 'Este elemento aún no tiene huella.', 'emptyHint': 'Se crea cuando el paso de perfil está activado.',
  },
};

/** The key list per language, for a parity test. */
export const FINGERPRINT_KEYS = {
  en: Object.keys(STRINGS.en), fi: Object.keys(STRINGS.fi), es: Object.keys(STRINGS.es),
};

/**
 * A word of the fingerprint: the host's own `fingerprint.<key>` first, then this dictionary in the
 * kit's language, then English, then the key itself.
 * @param {string} key - without the `fingerprint.` prefix
 * @param {Record<string, any>} [vars]
 * @returns {string}
 */
export function tf(key, vars) {
  const hosted = i18n.t('fingerprint.' + key, vars);
  if (hosted !== 'fingerprint.' + key) return hosted;
  const lang = i18n.lang();
  const table = /** @type {Record<string, string>} */ (
    (STRINGS[/** @type {'en'|'fi'|'es'} */ (lang)] || STRINGS.en));
  const text = table[key] || /** @type {Record<string, string>} */ (STRINGS.en)[key] || key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, function (whole, name) {
    return vars[name] == null ? whole : String(vars[name]);
  });
}
